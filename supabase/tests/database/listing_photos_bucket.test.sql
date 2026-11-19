-- listing-photos bucket (20261116200000). Production never had it, so every
-- listing photo upload failed and the app saved the host phone's file:// path.
BEGIN;
SELECT plan(7);

SELECT is((SELECT public FROM storage.buckets WHERE id = 'listing-photos'), true,
  'listing-photos exists and is public (getPublicUrl works)');

SELECT is_empty($$
  SELECT 1 FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND cmd = 'SELECT' AND qual LIKE '%listing-photos%'
$$, 'no SELECT policy: the bucket cannot be listed (folder names are user ids)');

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'other@test.local');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

SELECT lives_ok($$
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('listing-photos', '11111111-1111-1111-1111-111111111111/listing_1.jpg', '11111111-1111-1111-1111-111111111111')
$$, 'a host can upload into their own folder');

SELECT throws_ok($$
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('listing-photos', '22222222-2222-2222-2222-222222222222/listing_1.jpg', '11111111-1111-1111-1111-111111111111')
$$, '42501', NULL, 'cannot upload into another user''s folder');

SELECT throws_ok($$
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('listing-photos', 'listing_1.jpg', '11111111-1111-1111-1111-111111111111')
$$, '42501', NULL, 'cannot upload to the bucket root (what pre-fix builds did)');

SELECT is_empty($$ SELECT 1 FROM storage.objects WHERE bucket_id = 'listing-photos' $$,
  'clients cannot list objects');

RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$
  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('listing-photos', 'anon/listing_1.jpg')
$$, '42501', NULL, 'signed-out clients cannot upload');

SELECT * FROM finish();
ROLLBACK;
