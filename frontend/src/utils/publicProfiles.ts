import { supabase } from './supabase';

/**
 * The fields of ANOTHER user's profile the app may show: name and avatar.
 *
 * Other users' rows in `profiles` are not readable directly (RLS only lets you
 * read your own row, which also holds email, push token and Stripe ids). Read
 * other people through the `get_public_profiles` RPC instead — see
 * supabase/migrations/20261116160000_profiles_privacy.sql. Your OWN row is
 * still read with `from('profiles')` as before.
 */
export type PublicProfile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

/** Public profiles for `ids`, keyed by id. Unknown ids are simply absent. */
export async function fetchPublicProfiles(
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, PublicProfile>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  const byId = new Map<string, PublicProfile>();
  if (unique.length === 0) return byId;

  const { data, error } = await supabase.rpc('get_public_profiles', { p_ids: unique });
  if (error) {
    console.log('[profiles] get_public_profiles failed', error.message);
    return byId;
  }
  for (const row of (data ?? []) as PublicProfile[]) byId.set(row.id, row);
  return byId;
}

/** Public profile for a single user, or null. */
export async function fetchPublicProfile(
  id: string | null | undefined,
): Promise<PublicProfile | null> {
  if (!id) return null;
  return (await fetchPublicProfiles([id])).get(id) ?? null;
}
