-- claim_push_token (20261116190000): a push token lives on exactly one profile.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000000e1', 'pa@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000e2', 'pb@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000e3', 'pc@test.local', 'authenticated', 'authenticated');
INSERT INTO public.profiles (id, full_name, email) VALUES
  ('00000000-0000-4000-8000-0000000000e1', 'A', 'pa@test.local'),
  ('00000000-0000-4000-8000-0000000000e2', 'B', 'pb@test.local'),
  ('00000000-0000-4000-8000-0000000000e3', 'C', 'pc@test.local')
ON CONFLICT (id) DO NOTHING;
-- A signed out on the shared phone without clearing; C has an unrelated phone.
UPDATE public.profiles SET expo_push_token = 'ExponentPushToken[shared]' WHERE id = '00000000-0000-4000-8000-0000000000e1';
UPDATE public.profiles SET expo_push_token = 'ExponentPushToken[other]'  WHERE id = '00000000-0000-4000-8000-0000000000e3';

SELECT ok(NOT has_function_privilege('anon', 'public.claim_push_token(text)', 'EXECUTE'), 'anon cannot call claim_push_token');
SELECT ok(has_function_privilege('authenticated', 'public.claim_push_token(text)', 'EXECUTE'), 'signed-in users can call claim_push_token');
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'public.claim_push_token(text)'::regprocedure), true, 'runs as definer (needs to clear other rows)');
SELECT isnt((SELECT proconfig FROM pg_proc WHERE oid = 'public.claim_push_token(text)'::regprocedure), NULL, 'search_path is pinned');

-- B signs in on the shared phone.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
SELECT lives_ok($$SELECT public.claim_push_token('ExponentPushToken[shared]')$$, 'B claims the shared phone token');
RESET role;

SELECT is((SELECT expo_push_token FROM public.profiles WHERE id = '00000000-0000-4000-8000-0000000000e2'), 'ExponentPushToken[shared]', 'B now has the token');
SELECT is((SELECT expo_push_token FROM public.profiles WHERE id = '00000000-0000-4000-8000-0000000000e1'), NULL, 'A no longer has it, so A''s pushes stop reaching B''s phone');
SELECT is((SELECT expo_push_token FROM public.profiles WHERE id = '00000000-0000-4000-8000-0000000000e3'), 'ExponentPushToken[other]', 'unrelated tokens are untouched');

SELECT * FROM finish();
ROLLBACK;
