-- One phone, one owner: a push token can only be on one profile at a time.
--
-- The hole
--   Booking and payout pushes go to profiles.expo_push_token. A token belongs
--   to a phone, not a person. When user A signs out and user B signs in on the
--   same phone, B's profile gets the token — but A's profile still has it too
--   unless A's sign-out managed to clear it (it can fail: no network, the app
--   killed mid-sign-out). A's booking notifications then arrive on B's phone.
--
-- The fix
--   claim_push_token(p_token): saves the token on the caller's profile and
--   removes it from every other profile, atomically. The app calls it when it
--   registers for push. Clients can't clear other users' rows themselves
--   (profiles_manage_own), so this needs SECURITY DEFINER; it only ever writes
--   the caller's row plus NULLs on rows that hold this exact token.
--
-- Why safe
--   Installed builds keep using a plain update of their own row (still
--   allowed by 20261116180000's column grant). The new build falls back to
--   that update if this function isn't deployed yet.
--
-- NOT AUTO-DEPLOYED: apply to the hosted project manually; any order relative
-- to the other 20261116 migrations.

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_push_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_token IS NULL OR length(btrim(p_token)) = 0 THEN
    RAISE EXCEPTION 'token required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
     SET expo_push_token = NULL
   WHERE expo_push_token = p_token
     AND id <> v_uid;

  UPDATE public.profiles
     SET expo_push_token = p_token
   WHERE id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_push_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_push_token(text) TO authenticated;

COMMIT;
