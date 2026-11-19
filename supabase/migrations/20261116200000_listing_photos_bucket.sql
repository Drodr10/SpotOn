-- Create the listing-photos storage bucket. It never existed in production.
--
-- CreateListing2 has uploaded to `listing-photos` since #36, but no migration
-- created the bucket (20260825190000 assumed it existed). Production answers
-- "Bucket not found", so every upload failed and the app silently saved the
-- host phone's local file path as listings.photo_url. As of 2026-11-19 all 31
-- active listings have a file:// photo_url that no other phone can load — the
-- blank images in search and the home slider.
--
-- Same shape as avatars (20260603002952 + 20260825190000):
--   * public bucket: objects are served by /storage/v1/object/public/... without
--     consulting storage.objects policies, which is how getPublicUrl() works.
--   * NO select policy: a broad SELECT is what makes a bucket listable, and the
--     folder names are user ids.
--   * owners may insert/delete only inside their own <uid>/ folder. No update
--     policy: the app always writes a new file name.
--
-- Builds older than this PR upload to the bucket root (listing_<ts>.jpg), which
-- the insert policy rejects; they keep saving the local path exactly as today,
-- and the app hides those URLs. Existing rows are left alone; their photos only
-- ever existed on the hosts' phones and can't be recovered server-side.

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'listing-photos',
  'listing-photos',
  true,
  10 * 1024 * 1024,
  ARRAY['image/jpeg', 'image/png', 'image/heic', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public             = true,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Listing photo owner insert" ON storage.objects;
CREATE POLICY "Listing photo owner insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'listing-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Listing photo owner delete" ON storage.objects;
CREATE POLICY "Listing photo owner delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'listing-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND cmd = 'SELECT' AND qual LIKE '%listing-photos%'
  ) THEN
    RAISE EXCEPTION 'a SELECT policy on storage.objects makes listing-photos listable';
  END IF;
END $$;

COMMIT;
