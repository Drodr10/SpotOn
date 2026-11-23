/**
 * Listing photos: upload to the `listing-photos` bucket and decide which stored
 * URLs other phones can actually load.
 *
 * Until Nov 2026 the bucket did not exist in production, so every upload failed
 * and CreateListing2 silently saved the host phone's local path
 * (file:///var/mobile/... or file:///data/user/0/...) as photo_url. No other
 * phone can open that, so search and the home slider showed blanks. Those rows
 * still exist; displayablePhotoUrl() hides them so the placeholder shows instead.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const LISTING_PHOTOS_BUCKET = 'listing-photos';

/**
 * Only http(s) URLs load on someone else's phone. Anything else (file://,
 * content://, ph://, empty) is a path on the host's device: treat as no photo.
 */
export function displayablePhotoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

/**
 * Objects live under <owner id>/ — the storage INSERT policy in
 * 20261116200000_listing_photos_bucket.sql only accepts the caller's own folder.
 */
export function listingPhotoPath(ownerId: string, now: number): string {
  return `${ownerId}/listing_${now}.jpg`;
}

/**
 * Upload a local photo and return its public URL. Throws on failure: saving the
 * local path instead (the old fallback) creates a listing nobody else can see.
 *
 * Uploads an ArrayBuffer, not a Blob — React Native Blobs from fetch(file://)
 * upload as 0 bytes through supabase-js. Profile.tsx does the same for avatars.
 */
export async function uploadListingPhoto(
  client: SupabaseClient,
  ownerId: string,
  localUri: string,
  now: number = Date.now(),
): Promise<string> {
  const response = await fetch(localUri);
  const body = await response.arrayBuffer();
  if (body.byteLength === 0) throw new Error('The photo file was empty.');

  const bucket = client.storage.from(LISTING_PHOTOS_BUCKET);
  const { data, error } = await bucket.upload(listingPhotoPath(ownerId, now), body, {
    contentType: 'image/jpeg',
  });
  if (error || !data) throw error ?? new Error('Upload failed.');

  const url = bucket.getPublicUrl(data.path).data.publicUrl;
  if (!displayablePhotoUrl(url)) throw new Error('Upload returned an unusable URL.');
  return url;
}
