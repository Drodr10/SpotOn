-- Profiles: other users see only public fields, and the login email can only
-- change through Supabase Auth (with its confirmation step).
--
-- Covers:
--   20261116160000_profiles_privacy.sql
--
-- Why this matters: before that migration the anon key could read every
-- user's email, push token and Stripe account id, and any signed-in user could
-- rewrite their own login email (skipping confirmation) by updating
-- profiles.email. These assertions are what stop either from coming back.
--
-- One transaction, rolled back at the end.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(32);

-- ── Fixtures (as postgres, bypassing RLS) ─────────────────────────────────
-- alice = 7777…, bob = 8888…, carol (soft-deleted later) = 9999…
-- handle_new_user creates each profile row from the auth insert.
INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data) VALUES
  ('77777777-7777-7777-7777-777777777777', 'pgtap-pp-alice@example.test', 'authenticated', 'authenticated', '{"full_name":"Alice Example"}'),
  ('88888888-8888-8888-8888-888888888888', 'pgtap-pp-bob@example.test',   'authenticated', 'authenticated', '{"full_name":"Bob Example"}'),
  ('99999999-9999-9999-9999-999999999999', 'pgtap-pp-carol@example.test', 'authenticated', 'authenticated', '{"full_name":"Carol Example"}');

UPDATE public.profiles
   SET avatar_url = 'https://example.test/alice.png',
       expo_push_token = 'ExponentPushToken[alice]',
       stripe_account_id = 'acct_alice',
       payouts_enabled = true
 WHERE id = '77777777-7777-7777-7777-777777777777';

UPDATE public.profiles
   SET expo_push_token = 'ExponentPushToken[bob]',
       stripe_account_id = 'acct_bob'
 WHERE id = '88888888-8888-8888-8888-888888888888';

-- ── Structure ─────────────────────────────────────────────────────────────
SELECT policies_are(
  'public', 'profiles',
  ARRAY['profiles_manage_own'],
  'profiles has only the owner policy (no public SELECT policy)'
);

SELECT hasnt_trigger('public', 'profiles', 'on_profile_email_update',
  'profiles no longer pushes email into auth.users');

SELECT hasnt_function('public', 'handle_update_user_email', ARRAY[]::text[],
  'handle_update_user_email() is gone');

SELECT has_trigger('auth', 'users', 'on_auth_user_email_update',
  'auth.users syncs a changed email into profiles');

SELECT has_trigger('auth', 'users', 'on_auth_user_created',
  'signup trigger is still in place');

SELECT is_definer('public', 'get_public_profiles', ARRAY['uuid[]'],
  'get_public_profiles is SECURITY DEFINER');

SELECT ok(
  (SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc
    WHERE oid = 'public.get_public_profiles(uuid[])'::regprocedure),
  'get_public_profiles pins an empty search_path'
);

SELECT is(
  pg_get_function_result('public.get_public_profiles(uuid[])'::regprocedure),
  'TABLE(id uuid, full_name text, avatar_url text)',
  'get_public_profiles returns only id, full_name, avatar_url'
);

SELECT ok(has_function_privilege('authenticated', 'public.get_public_profiles(uuid[])', 'EXECUTE'),
  'authenticated may call get_public_profiles');
SELECT ok(NOT has_function_privilege('anon', 'public.get_public_profiles(uuid[])', 'EXECUTE'),
  'anon may not call get_public_profiles');
SELECT ok(NOT has_function_privilege('authenticated', 'public.sync_profile_email_from_auth()', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.sync_profile_email_from_auth()', 'EXECUTE'),
  'client roles may not call sync_profile_email_from_auth');

-- ── As bob (authenticated), looking at alice ──────────────────────────────
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"88888888-8888-8888-8888-888888888888","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.profiles WHERE id = '77777777-7777-7777-7777-777777777777'),
  0, 'another user cannot read alice''s profile row');
SELECT is(
  (SELECT email FROM public.profiles WHERE id = '77777777-7777-7777-7777-777777777777'),
  NULL, 'another user cannot read alice''s email');
SELECT is(
  (SELECT expo_push_token FROM public.profiles WHERE id = '77777777-7777-7777-7777-777777777777'),
  NULL, 'another user cannot read alice''s push token');
SELECT is(
  (SELECT stripe_account_id FROM public.profiles WHERE id = '77777777-7777-7777-7777-777777777777'),
  NULL, 'another user cannot read alice''s Stripe account id');
SELECT is(
  (SELECT count(*)::int FROM public.profiles),
  1, 'a signed-in user sees exactly one profile row: their own');

SELECT results_eq(
  $$ SELECT id, full_name, avatar_url FROM public.get_public_profiles(
       ARRAY['77777777-7777-7777-7777-777777777777'::uuid,
             '00000000-0000-0000-0000-00000000dead'::uuid]) $$,
  $$ VALUES ('77777777-7777-7777-7777-777777777777'::uuid, 'Alice Example'::text,
             'https://example.test/alice.png'::text) $$,
  'get_public_profiles returns alice''s public fields and skips unknown ids'
);

-- Own row: still fully readable, and the non-email columns still writable.
SELECT results_eq(
  $$ SELECT email, expo_push_token, stripe_account_id FROM public.profiles
      WHERE id = '88888888-8888-8888-8888-888888888888' $$,
  $$ VALUES ('pgtap-pp-bob@example.test'::text, 'ExponentPushToken[bob]'::text, 'acct_bob'::text) $$,
  'bob reads his own private columns'
);

SELECT lives_ok(
  $$ UPDATE public.profiles
        SET full_name = 'Bobby', avatar_url = 'https://example.test/bob.png',
            expo_push_token = 'ExponentPushToken[bob2]'
      WHERE id = '88888888-8888-8888-8888-888888888888' $$,
  'bob can still update his own name, avatar and push token'
);
SELECT is(
  (SELECT full_name FROM public.profiles WHERE id = '88888888-8888-8888-8888-888888888888'),
  'Bobby', 'own-row update took effect');

UPDATE public.profiles SET full_name = 'Hacked'
 WHERE id = '77777777-7777-7777-7777-777777777777';
SELECT is(
  (SELECT full_name FROM public.get_public_profiles(ARRAY['77777777-7777-7777-7777-777777777777'::uuid])),
  'Alice Example', 'bob cannot update alice''s profile');

SELECT throws_ok(
  $$ UPDATE public.profiles SET email = 'pgtap-pp-takeover@example.test'
      WHERE id = '88888888-8888-8888-8888-888888888888' $$,
  '42501', NULL,
  'a client cannot write profiles.email'
);

-- ── As anon ───────────────────────────────────────────────────────────────
SET LOCAL role anon;
SET LOCAL "request.jwt.claims" = '{"role":"anon"}';

SELECT is((SELECT count(*)::int FROM public.profiles), 0, 'anon reads no profile rows');
SELECT is(
  (SELECT email FROM public.profiles WHERE id = '77777777-7777-7777-7777-777777777777'),
  NULL, 'anon cannot read alice''s email');
SELECT throws_ok(
  $$ SELECT * FROM public.get_public_profiles(ARRAY['77777777-7777-7777-7777-777777777777'::uuid]) $$,
  '42501', NULL,
  'anon cannot call get_public_profiles'
);

-- ── Back to postgres: email sync direction ────────────────────────────────
RESET role;
RESET "request.jwt.claims";

SELECT is(
  (SELECT email::text FROM auth.users WHERE id = '88888888-8888-8888-8888-888888888888'),
  'pgtap-pp-bob@example.test',
  'bob''s login email is unchanged by his profiles.email attempt'
);

-- What Auth does once a change is confirmed.
UPDATE auth.users SET email = 'pgtap-pp-bob-new@example.test'
 WHERE id = '88888888-8888-8888-8888-888888888888';
SELECT is(
  (SELECT email FROM public.profiles WHERE id = '88888888-8888-8888-8888-888888888888'),
  'pgtap-pp-bob-new@example.test',
  'a confirmed auth.users email change is copied into profiles.email'
);

-- A clash with another profile's (stale) copy must not block the auth change.
UPDATE public.profiles SET email = 'pgtap-pp-stale@example.test'
 WHERE id = '77777777-7777-7777-7777-777777777777';
SELECT lives_ok(
  $$ UPDATE auth.users SET email = 'pgtap-pp-stale@example.test'
      WHERE id = '99999999-9999-9999-9999-999999999999' $$,
  'auth email change still succeeds when profiles.email would clash'
);
SELECT is(
  (SELECT email FROM public.profiles WHERE id = '99999999-9999-9999-9999-999999999999'),
  'pgtap-pp-carol@example.test',
  'the clashing copy is skipped, carol''s profile keeps its email'
);

-- Account deletion: the backend (service_role) tombstones the profile, then
-- Auth soft-deletes the user and obfuscates its email. The tombstone stays.
SET LOCAL role service_role;
SELECT lives_ok(
  $$ UPDATE public.profiles
        SET full_name = 'Deleted user', email = 'deleted+99999999@spoton.invalid'
      WHERE id = '99999999-9999-9999-9999-999999999999' $$,
  'the backend (service_role) can still tombstone profiles.email'
);
RESET role;
UPDATE auth.users SET email = 'obfuscated-carol', deleted_at = now()
 WHERE id = '99999999-9999-9999-9999-999999999999';
SELECT is(
  (SELECT email FROM public.profiles WHERE id = '99999999-9999-9999-9999-999999999999'),
  'deleted+99999999@spoton.invalid',
  'a soft delete does not overwrite the deletion tombstone'
);

-- Signup still copies name + email into a new profile.
INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data) VALUES
  ('12121212-1212-1212-1212-121212121212', 'pgtap-pp-dan@example.test', 'authenticated', 'authenticated', '{"full_name":"Dan Example"}');
SELECT results_eq(
  $$ SELECT full_name, email FROM public.profiles WHERE id = '12121212-1212-1212-1212-121212121212' $$,
  $$ VALUES ('Dan Example'::text, 'pgtap-pp-dan@example.test'::text) $$,
  'signup (handle_new_user) still creates the profile with the email'
);

SELECT * FROM finish();
ROLLBACK;
