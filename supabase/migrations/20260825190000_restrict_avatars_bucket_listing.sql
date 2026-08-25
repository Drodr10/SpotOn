-- Stop the avatars bucket from being listable.
--
-- Flagged by the Supabase advisor as public_bucket_allows_listing. The policy
-- dropped here was:
--
--   create policy "Avatar public read" on storage.objects
--     for select using ( bucket_id = 'avatars' );
--
-- A broad SELECT on storage.objects is not what makes a public bucket's URLs
-- work — it is what allows clients to LIST the bucket. And because the upload
-- policy keys paths on (storage.foldername(name))[1] = auth.uid()::text, every
-- filename in there is a user id. So the policy turned the bucket into a
-- user-id enumeration endpoint reachable with the publishable key that ships
-- inside the app.
--
-- Avatars keep working. A public bucket serves objects through
-- /storage/v1/object/public/... without consulting storage.objects policies at
-- all, and the app only ever reads avatars via getPublicUrl() (Profile.tsx:261)
-- — there is no .list() call anywhere in frontend/ or backend/.
--
-- The control case is already in production: `listing-photos` is public, read
-- the same way via getPublicUrl(), and has no SELECT policy in any migration.
-- Listing photos display correctly. This makes `avatars` match it.
--
-- The owner insert/update/delete policies are deliberately left alone: those
-- are what let a signed-in user manage their own avatar.

BEGIN;

DROP POLICY IF EXISTS "Avatar public read" ON storage.objects;

-- Fail loudly if this ever silently regresses, and confirm the two things that
-- keep avatars working are still true.
DO $$
DECLARE
  broad_select int;
  is_public    boolean;
BEGIN
  SELECT count(*) INTO broad_select
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND cmd = 'SELECT' AND qual LIKE '%avatars%';
  IF broad_select > 0 THEN
    RAISE EXCEPTION 'a SELECT policy on storage.objects still exposes the avatars bucket';
  END IF;

  SELECT public INTO is_public FROM storage.buckets WHERE id = 'avatars';
  IF is_public IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'avatars bucket is not public (is_public=%) — object URLs would break', is_public;
  END IF;
END $$;

COMMIT;
