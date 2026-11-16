-- Security hardening: client write access to profiles, messages and
-- conversations is narrowed to exactly what the app does.
--
-- HOLE A (profiles): a user could rewrite the server-owned columns of their own
--   profile. profiles_manage_own is FOR ALL with "id = auth.uid()", and anon /
--   authenticated held table-wide INSERT/UPDATE/DELETE, so a plain
--     supabase.from('profiles').update({ payouts_enabled: true,
--       stripe_account_id: 'acct_someone_else', rating_avg: 5 })
--   was accepted. payouts_enabled + stripe_account_id are what the payout sweep
--   reads to decide whether, and where, to send a host's money; rating_avg is
--   meant to be computed. A user could also DELETE their own profile row
--   (orphaning listings/bookings behind the backend's account-deletion checks)
--   or INSERT one with arbitrary values.
--
-- HOLE B (messages): the UPDATE policy's WITH CHECK only said
--   sender_id = auth.uid(). A sender could therefore move one of their messages
--   into ANY conversation, including one they are not part of, or one with a
--   user who has blocked them: messages_block_guard fires on INSERT only, so the
--   move skipped it. They could also rewrite or delete what they had sent after
--   being reported, which destroys the evidence moderation relies on.
--
-- HOLE C (conversations): either participant could DELETE the conversation,
--   and messages.conversation_id is ON DELETE CASCADE, so the whole thread
--   (both sides' messages, the evidence for a report) went with it. UPDATE was
--   table-wide, so a participant could also rewrite renter_id / owner_id
--   (the policy only needs ONE of them to still be the caller) to drop a
--   thread into a stranger's inbox, or re-point reservation_id / status.
--
-- THE FIX
--   profiles: no client INSERT or DELETE (signup creates the row through
--     handle_new_user, SECURITY DEFINER, owned by postgres; account deletion is
--     the backend, service_role). Client UPDATE is limited to the columns the
--     app writes: full_name, avatar_url (Profile screen), expo_push_token
--     (utils/push.ts register, Profile sign-out clear) and stripe_account_id —
--     the last one ONLY to its current value. Builds already installed write
--     the account id the backend has just stored (utils/stripe.ts
--     fetchStripeAccountId) and treat an error there as "payout setup failed";
--     the guard_profile_stripe_account trigger lets that no-op through and
--     refuses any actual change. The new build no longer sends that write at
--     all: create-connect-account already persists the id (service_role).
--     email stays server-maintained (guard_profile_email, 20261116160000); it
--     is not in the column grant either, so a client write of it now fails on
--     the privilege check first with the same SQLSTATE (42501).
--   messages: no client UPDATE or DELETE (the app never edits or deletes a
--     message). The two now-inert policies are dropped so a future GRANT does
--     not silently revive them. INSERT is unchanged and still runs
--     messages_block_guard.
--   conversations: no client DELETE. UPDATE only on (last_message, updated_at),
--     which is all the app writes (Chat.tsx send, utils/conversations.ts). The
--     participants-only UPDATE policy stays, so those two columns are still
--     only writable on your own conversations. The DELETE policy is dropped.
--   All three: anon loses every write privilege (it had no policy anyway), and
--   TRUNCATE / REFERENCES / TRIGGER are revoked from both client roles, as
--   20261116170000 did for reservations.
--
-- WHY THIS IS SAFE
--   Grepped every from('profiles' | 'messages' | 'conversations') write in
--   frontend/src: profiles .update({ full_name }), .update({ avatar_url }),
--   .update({ expo_push_token }), .update({ stripe_account_id }) (removed in
--   this branch); messages .insert only; conversations .insert({ renter_id,
--   owner_id }) and .update({ last_message, updated_at }). No upserts, no
--   deletes. Reads are untouched (SELECT grants and SELECT policies stay).
--   The backend uses service_role, which these REVOKEs do not touch.
--   Realtime subscriptions only need SELECT.
--
-- NOT AUTO-DEPLOYED. Merging this file does not change the hosted database;
-- apply it by hand (SQL editor or `supabase db push`).
--
-- RELEASE ORDER: independent of the app build. Safe for builds already
-- installed: every write they make is still allowed (the stripe_account_id
-- write is a no-op re-write of the id the backend stored). Order relative to
-- 20261116160000 / 20261116170000 does not matter; none of them depends on
-- another. The new build's sign-out clears expo_push_token, which is allowed
-- with or without this migration, so build and migration can ship in either
-- order.

BEGIN;

-- ── profiles ───────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.profiles FROM anon, authenticated;

GRANT UPDATE (full_name, avatar_url, expo_push_token, stripe_account_id)
  ON public.profiles TO authenticated;

-- A client may re-write stripe_account_id with its current value (old builds
-- do exactly that after create-connect-account) but never change it.
-- current_user is the API role for client requests; it is service_role for
-- the backend, which keeps full control of the column.
CREATE OR REPLACE FUNCTION public.guard_profile_stripe_account()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.stripe_account_id IS DISTINCT FROM OLD.stripe_account_id
     AND current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'profiles.stripe_account_id is set by the server; use Set Up Payouts'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_profile_stripe_account() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_profile_stripe_account ON public.profiles;
CREATE TRIGGER guard_profile_stripe_account
  BEFORE UPDATE OF stripe_account_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_stripe_account();

-- ── messages ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS messages_conversation_participants_update ON public.messages;
DROP POLICY IF EXISTS messages_conversation_participants_delete ON public.messages;

REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.messages FROM anon, authenticated;
REVOKE INSERT ON public.messages FROM anon;

-- ── conversations ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS conversations_participants_delete ON public.conversations;

REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.conversations FROM anon, authenticated;
REVOKE INSERT ON public.conversations FROM anon;

GRANT UPDATE (last_message, updated_at) ON public.conversations TO authenticated;

COMMIT;
