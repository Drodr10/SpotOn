-- Profiles privacy: close two holes in public.profiles that date back to the
-- original schema (20260421001633_remote_schema.sql).
--
-- HOLE A: any signed-in user could change their LOGIN email without confirming it.
--   Trigger on_profile_email_update (AFTER UPDATE OF email ON public.profiles)
--   ran handle_update_user_email(), a SECURITY DEFINER function that copied
--   profiles.email into auth.users.email. profiles_manage_own lets every user
--   update their own profiles row, so a plain
--     supabase.from('profiles').update({ email: 'x@y.z' })
--   rewrote the address they sign in with and receive password resets at,
--   skipping Supabase's confirmation email. The sync ran the wrong way.
--
-- HOLE B: anyone, signed in or not, could read every column of every profile.
--   profiles_select_public was FOR SELECT USING (true) with no role, so the anon
--   key alone could list every user's email, expo_push_token (lets anyone send
--   them push notifications), stripe_account_id and payouts_enabled.
--
-- THE FIX
--   1. Drop on_profile_email_update and handle_update_user_email(). Sync the
--      right way round instead: on_auth_user_email_update (AFTER UPDATE OF email
--      ON auth.users) copies a CONFIRMED login email into profiles.email. Auth
--      only writes auth.users.email after the confirmation link is clicked
--      (until then the new address sits in new_email), so the copy never runs
--      ahead of confirmation. Signup is unchanged: on_auth_user_created /
--      handle_new_user() still copies the email on INSERT.
--      A soft-deleted user (deleted_at set) is skipped so the backend's account
--      deletion tombstone stays. A unique clash on profiles.email (a stale copy
--      held by another row) is logged as a WARNING and skipped rather than
--      failing the auth update, i.e. the user's email change itself.
--   2. profiles.email is now server-maintained. Clients (roles anon /
--      authenticated) may no longer change it; anything else (service_role
--      backend, postgres, the auth sync above) may. Without this, a user could
--      park someone else's address in their own row and that person's signup
--      would then fail on profiles_email_key.
--   3. One-off backfill of profiles.email from auth.users, because until now
--      nothing in the database copied a confirmed change across.
--   4. Drop profiles_select_public. Your own row stays fully readable and
--      updatable through profiles_manage_own (minus the email column, above).
--      Other users are read through get_public_profiles(uuid[]), which returns
--      only id, full_name and avatar_url, the only fields the app shows about
--      other people (Messages inbox + blocked list, Chat header, conversation
--      owner name, Activity renter name). rating_avg is not shown for others
--      anywhere, so it is not exposed.
--      An RPC rather than a view: a SECURITY DEFINER view is flagged by the
--      Supabase advisor, and a SECURITY INVOKER view would still need a row
--      policy exposing every column. EXECUTE is granted to authenticated only.
--      No signed-out screen shows another user's name: listings/search read
--      no profile data, and messaging and bookings need a session.
--      Nothing else in the schema reads other users' profiles under RLS. No
--      policy, view or SECURITY INVOKER function references public.profiles;
--      the only function that does is handle_new_user (SECURITY DEFINER). The
--      foreign keys to profiles(id) are checked without RLS. The backend uses
--      the service_role key, which bypasses RLS.
--
-- NOT AUTO-DEPLOYED. Merging this file does not change the hosted database;
-- apply it by hand (SQL editor or `supabase db push`).
--
-- RELEASE ORDER: the app build that calls get_public_profiles (Messages, Chat,
-- utils/conversations.ts, utils/activity.ts via utils/publicProfiles.ts) needs
-- this migration, so apply it BEFORE shipping that build. Without it the RPC
-- does not exist and other users show as "Unknown"/"Owner"/"Renter".
-- Applying it affects builds ALREADY in users' hands: their direct
-- from('profiles') reads of OTHER users will return no rows from then on. Other
-- people's names and avatars show as placeholders ("Unknown", "Owner",
-- "Renter", default avatar) in Messages, Chat and Activity until users update.
-- Their own profile, payouts and push registration keep working. An old
-- build's Profile screen may also try to write a changed profiles.email once
-- and log an error. That write is now refused and is harmless. Plan the
-- release so the new build is out (or forced) around the time this is applied.

BEGIN;

-- ── 1. Email sync: auth.users → profiles (never the other way) ─────────────
DROP TRIGGER IF EXISTS on_profile_email_update ON public.profiles;
DROP FUNCTION IF EXISTS public.handle_update_user_email();

CREATE OR REPLACE FUNCTION public.sync_profile_email_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.email IS NULL
     OR NEW.email IS NOT DISTINCT FROM OLD.email
     OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    UPDATE public.profiles
       SET email = NEW.email
     WHERE id = NEW.id
       AND email IS DISTINCT FROM NEW.email;
  EXCEPTION WHEN unique_violation THEN
    -- Never block the login-email change itself over the copy.
    RAISE WARNING 'profiles.email not synced for %: % already used by another profile',
      NEW.id, NEW.email;
  END;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.sync_profile_email_from_auth() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sync_profile_email_from_auth() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_email_update ON auth.users;
CREATE TRIGGER on_auth_user_email_update
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_email_from_auth();

-- ── 2. Clients may not write profiles.email ────────────────────────────────
-- current_user is the API role for client requests (anon / authenticated);
-- it is service_role for the backend and postgres inside the sync above.
CREATE OR REPLACE FUNCTION public.guard_profile_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email
     AND current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'profiles.email is read-only; change your email through Supabase Auth'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_profile_email() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_profile_email ON public.profiles;
CREATE TRIGGER guard_profile_email
  BEFORE UPDATE OF email ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_email();

-- ── 3. Backfill stale copies (skip any that would clash on the unique key) ──
UPDATE public.profiles p
   SET email = u.email
  FROM auth.users u
 WHERE u.id = p.id
   AND u.email IS NOT NULL
   AND u.deleted_at IS NULL
   AND p.email IS DISTINCT FROM u.email
   AND NOT EXISTS (SELECT 1 FROM public.profiles q WHERE q.email = u.email);

-- ── 4. Other users: public fields only, via RPC ────────────────────────────
DROP POLICY IF EXISTS profiles_select_public ON public.profiles;

CREATE OR REPLACE FUNCTION public.get_public_profiles(p_ids uuid[])
RETURNS TABLE (id uuid, full_name text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id, p.full_name, p.avatar_url
  FROM public.profiles p
  WHERE p.id = ANY (p_ids);
$$;

ALTER FUNCTION public.get_public_profiles(uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_public_profiles(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO authenticated, service_role;

COMMIT;
