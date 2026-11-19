-- Profiles, messages and conversations: clients can write only the columns the
-- app writes, and nothing that decides money, identity or moderation evidence.
--
-- Covers:
--   20261116180000_security_hardening.sql
--
-- Why this matters: before that migration a user could set their own
-- payouts_enabled / stripe_account_id / rating_avg, delete their profile row,
-- move a message into a conversation they are not part of (skipping the block
-- guard, which fires on INSERT only), rewrite or delete sent messages, delete a
-- whole conversation (cascading away both sides' messages), and re-point a
-- conversation's renter_id / owner_id.
--
-- One transaction, rolled back at the end.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(47);

-- ── Fixtures (as postgres, bypassing RLS) ─────────────────────────────────
-- alice = 5151…, bob = 5252…, carol = 5353… (handle_new_user creates profiles)
INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data) VALUES
  ('51515151-5151-5151-5151-515151515151', 'pgtap-sh-alice@example.test', 'authenticated', 'authenticated', '{"full_name":"Alice"}'),
  ('52525252-5252-5252-5252-525252525252', 'pgtap-sh-bob@example.test',   'authenticated', 'authenticated', '{"full_name":"Bob"}'),
  ('53535353-5353-5353-5353-535353535353', 'pgtap-sh-carol@example.test', 'authenticated', 'authenticated', '{"full_name":"Carol"}');

UPDATE public.profiles
   SET stripe_account_id = 'acct_alice', payouts_enabled = false,
       expo_push_token = 'ExponentPushToken[alice]'
 WHERE id = '51515151-5151-5151-5151-515151515151';

-- alice <-> bob, and bob <-> carol (alice is not part of the second one)
INSERT INTO public.conversations (id, renter_id, owner_id, last_message) VALUES
  ('d5d5d5d5-0000-0000-0000-000000000001', '51515151-5151-5151-5151-515151515151',
   '52525252-5252-5252-5252-525252525252', 'hi bob'),
  ('d5d5d5d5-0000-0000-0000-000000000002', '53535353-5353-5353-5353-535353535353',
   '52525252-5252-5252-5252-525252525252', 'hi bob, carol here');

INSERT INTO public.messages (id, conversation_id, sender_id, content) VALUES
  ('e5e5e5e5-0000-0000-0000-000000000001', 'd5d5d5d5-0000-0000-0000-000000000001',
   '51515151-5151-5151-5151-515151515151', 'hi bob');

-- ── Structure: profiles ───────────────────────────────────────────────────
SELECT ok(has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE'),
  'authenticated may update profiles.full_name');
SELECT ok(has_column_privilege('authenticated', 'public.profiles', 'avatar_url', 'UPDATE'),
  'authenticated may update profiles.avatar_url');
SELECT ok(has_column_privilege('authenticated', 'public.profiles', 'expo_push_token', 'UPDATE'),
  'authenticated may update profiles.expo_push_token');
SELECT ok(NOT has_column_privilege('authenticated', 'public.profiles', 'payouts_enabled', 'UPDATE'),
  'authenticated may not update profiles.payouts_enabled');
SELECT ok(NOT has_column_privilege('authenticated', 'public.profiles', 'rating_avg', 'UPDATE'),
  'authenticated may not update profiles.rating_avg');
SELECT ok(NOT has_column_privilege('authenticated', 'public.profiles', 'email', 'UPDATE'),
  'authenticated may not update profiles.email');
SELECT ok(NOT has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE'),
  'authenticated may not update profiles.id');
SELECT ok(NOT has_table_privilege('authenticated', 'public.profiles', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.profiles', 'DELETE'),
  'authenticated may not insert or delete profiles');
SELECT ok(NOT has_any_column_privilege('anon', 'public.profiles', 'UPDATE')
      AND NOT has_any_column_privilege('anon', 'public.profiles', 'INSERT')
      AND NOT has_table_privilege('anon', 'public.profiles', 'DELETE'),
  'anon may not write profiles at all');
SELECT ok(NOT has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE')
      AND NOT has_table_privilege('anon', 'public.profiles', 'TRUNCATE'),
  'client roles may not truncate profiles');
SELECT has_trigger('public', 'profiles', 'guard_profile_stripe_account',
  'profiles has the stripe_account_id guard');
SELECT has_trigger('public', 'profiles', 'guard_profile_email',
  'the email guard from 20261116160000 is still in place');

-- ── Structure: messages / conversations ───────────────────────────────────
SELECT policies_are('public', 'messages',
  ARRAY['messages_conversation_participants_select', 'messages_conversation_participants_insert'],
  'messages keeps only the participants SELECT and INSERT policies');
SELECT ok(NOT has_any_column_privilege('authenticated', 'public.messages', 'UPDATE'),
  'authenticated may not update any messages column');
SELECT ok(NOT has_table_privilege('authenticated', 'public.messages', 'DELETE'),
  'authenticated may not delete messages');
SELECT ok(NOT has_table_privilege('anon', 'public.messages', 'INSERT')
      AND NOT has_any_column_privilege('anon', 'public.messages', 'UPDATE')
      AND NOT has_table_privilege('anon', 'public.messages', 'DELETE'),
  'anon may not write messages');
SELECT ok(has_table_privilege('authenticated', 'public.messages', 'INSERT'),
  'authenticated may still insert messages');

SELECT policies_are('public', 'conversations',
  ARRAY['conversations_participants_select', 'conversations_participants_insert',
        'conversations_participants_update'],
  'conversations has no DELETE policy');
SELECT ok(has_column_privilege('authenticated', 'public.conversations', 'last_message', 'UPDATE')
      AND has_column_privilege('authenticated', 'public.conversations', 'updated_at', 'UPDATE'),
  'authenticated may update conversations.last_message and updated_at');
SELECT ok(NOT has_column_privilege('authenticated', 'public.conversations', 'renter_id', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.conversations', 'owner_id', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.conversations', 'reservation_id', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.conversations', 'status', 'UPDATE'),
  'authenticated may not update conversation participants, reservation_id or status');
SELECT ok(NOT has_table_privilege('authenticated', 'public.conversations', 'DELETE')
      AND NOT has_table_privilege('anon', 'public.conversations', 'DELETE'),
  'client roles may not delete conversations');

-- ── As alice (authenticated) ──────────────────────────────────────────────
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"51515151-5151-5151-5151-515151515151","role":"authenticated"}';

-- profiles: the money columns
SELECT throws_ok(
  $$ UPDATE public.profiles SET payouts_enabled = true
      WHERE id = '51515151-5151-5151-5151-515151515151' $$,
  '42501', NULL, 'alice cannot turn on her own payouts_enabled');
SELECT throws_ok(
  $$ UPDATE public.profiles SET stripe_account_id = 'acct_attacker'
      WHERE id = '51515151-5151-5151-5151-515151515151' $$,
  '42501', NULL, 'alice cannot change her stripe_account_id');
SELECT throws_ok(
  $$ UPDATE public.profiles SET rating_avg = 5
      WHERE id = '51515151-5151-5151-5151-515151515151' $$,
  '42501', NULL, 'alice cannot set her own rating_avg');
SELECT throws_ok(
  $$ DELETE FROM public.profiles WHERE id = '51515151-5151-5151-5151-515151515151' $$,
  '42501', NULL, 'alice cannot delete her profile row');
SELECT throws_ok(
  $$ INSERT INTO public.profiles (id, full_name, email)
     VALUES ('51515151-5151-5151-5151-515151515151', 'Dup', 'pgtap-sh-dup@example.test') $$,
  '42501', NULL, 'alice cannot insert a profile row');

-- profiles: what the app does
SELECT lives_ok(
  $$ UPDATE public.profiles SET full_name = 'Alice B', avatar_url = 'https://example.test/a.png'
      WHERE id = '51515151-5151-5151-5151-515151515151' $$,
  'alice can still update her name and avatar');
SELECT lives_ok(
  $$ UPDATE public.profiles SET expo_push_token = 'ExponentPushToken[alice2]'
      WHERE id = '51515151-5151-5151-5151-515151515151' $$,
  'alice can still register a push token');
SELECT lives_ok(
  $$ UPDATE public.profiles SET expo_push_token = NULL
      WHERE id = '51515151-5151-5151-5151-515151515151' $$,
  'alice can clear her push token (sign-out)');
SELECT lives_ok(
  $$ UPDATE public.profiles SET stripe_account_id = 'acct_alice'
      WHERE id = '51515151-5151-5151-5151-515151515151' $$,
  'an installed build''s no-op re-write of the backend-stored stripe_account_id still succeeds');
SELECT results_eq(
  $$ SELECT full_name, expo_push_token, stripe_account_id, payouts_enabled
       FROM public.profiles WHERE id = '51515151-5151-5151-5151-515151515151' $$,
  $$ VALUES ('Alice B'::text, NULL::text, 'acct_alice'::text, false) $$,
  'allowed writes took effect, refused ones did not');

-- messages: move / edit / delete
SELECT throws_ok(
  $$ UPDATE public.messages SET conversation_id = 'd5d5d5d5-0000-0000-0000-000000000002'
      WHERE id = 'e5e5e5e5-0000-0000-0000-000000000001' $$,
  '42501', NULL, 'alice cannot move her message into a conversation she is not in');
SELECT throws_ok(
  $$ UPDATE public.messages SET content = 'I never said that'
      WHERE id = 'e5e5e5e5-0000-0000-0000-000000000001' $$,
  '42501', NULL, 'alice cannot rewrite a sent message');
SELECT throws_ok(
  $$ DELETE FROM public.messages WHERE id = 'e5e5e5e5-0000-0000-0000-000000000001' $$,
  '42501', NULL, 'alice cannot delete a sent message');
SELECT lives_ok(
  $$ INSERT INTO public.messages (conversation_id, sender_id, content)
     VALUES ('d5d5d5d5-0000-0000-0000-000000000001', '51515151-5151-5151-5151-515151515151', 'still here') $$,
  'alice can still send a message in her own conversation');

-- conversations
SELECT lives_ok(
  $$ UPDATE public.conversations SET last_message = 'still here', updated_at = now()
      WHERE id = 'd5d5d5d5-0000-0000-0000-000000000001' $$,
  'alice can update last_message/updated_at on her conversation');
SELECT throws_ok(
  $$ UPDATE public.conversations SET owner_id = '53535353-5353-5353-5353-535353535353'
      WHERE id = 'd5d5d5d5-0000-0000-0000-000000000001' $$,
  '42501', NULL, 'alice cannot re-point a conversation at another user');
SELECT throws_ok(
  $$ UPDATE public.conversations SET status = 'archived'
      WHERE id = 'd5d5d5d5-0000-0000-0000-000000000001' $$,
  '42501', NULL, 'alice cannot change a conversation''s status');
SELECT throws_ok(
  $$ DELETE FROM public.conversations WHERE id = 'd5d5d5d5-0000-0000-0000-000000000001' $$,
  '42501', NULL, 'alice cannot delete a conversation');
UPDATE public.conversations SET last_message = 'hijacked'
 WHERE id = 'd5d5d5d5-0000-0000-0000-000000000002';
SELECT lives_ok(
  $$ INSERT INTO public.conversations (renter_id, owner_id)
     VALUES ('51515151-5151-5151-5151-515151515151', '53535353-5353-5353-5353-535353535353') $$,
  'alice can still start a conversation');

-- ── As anon ───────────────────────────────────────────────────────────────
SET LOCAL role anon;
SET LOCAL "request.jwt.claims" = '{"role":"anon"}';

SELECT throws_ok(
  $$ UPDATE public.profiles SET payouts_enabled = true $$,
  '42501', NULL, 'anon cannot update profiles');
SELECT throws_ok(
  $$ INSERT INTO public.messages (conversation_id, sender_id, content)
     VALUES ('d5d5d5d5-0000-0000-0000-000000000001', '51515151-5151-5151-5151-515151515151', 'x') $$,
  '42501', NULL, 'anon cannot insert messages');

-- ── Back to postgres: what actually happened ──────────────────────────────
RESET role;
RESET "request.jwt.claims";

SELECT results_eq(
  $$ SELECT conversation_id, content FROM public.messages
      WHERE id = 'e5e5e5e5-0000-0000-0000-000000000001' $$,
  $$ VALUES ('d5d5d5d5-0000-0000-0000-000000000001'::uuid, 'hi bob'::text) $$,
  'alice''s original message is untouched, in its original conversation');
SELECT results_eq(
  $$ SELECT id, last_message FROM public.conversations
      WHERE id IN ('d5d5d5d5-0000-0000-0000-000000000001', 'd5d5d5d5-0000-0000-0000-000000000002')
      ORDER BY id $$,
  $$ VALUES ('d5d5d5d5-0000-0000-0000-000000000001'::uuid, 'still here'::text),
            ('d5d5d5d5-0000-0000-0000-000000000002'::uuid, 'hi bob, carol here'::text) $$,
  'alice updated her own conversation; RLS kept her out of bob and carol''s');

-- The backend (service_role) keeps full control of the server-owned columns.
SET LOCAL role service_role;
SELECT lives_ok(
  $$ UPDATE public.profiles
        SET stripe_account_id = 'acct_alice_new', payouts_enabled = true
      WHERE id = '51515151-5151-5151-5151-515151515151' $$,
  'service_role can still set stripe_account_id and payouts_enabled');
RESET role;

-- Signup: handle_new_user is SECURITY DEFINER (owned by postgres), so the
-- profile row is still created although no client role may INSERT one.
SELECT is_definer('public', 'handle_new_user', ARRAY[]::text[],
  'handle_new_user is SECURITY DEFINER');
INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data) VALUES
  ('54545454-5454-5454-5454-545454545454', 'pgtap-sh-dan@example.test', 'authenticated', 'authenticated', '{"full_name":"Dan"}');
SELECT results_eq(
  $$ SELECT full_name, email FROM public.profiles WHERE id = '54545454-5454-5454-5454-545454545454' $$,
  $$ VALUES ('Dan'::text, 'pgtap-sh-dan@example.test'::text) $$,
  'signup (handle_new_user) still creates the profile');

SELECT * FROM finish();
ROLLBACK;
