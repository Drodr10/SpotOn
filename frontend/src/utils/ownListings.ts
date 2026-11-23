/**
 * Renter-facing listing feeds (search results/map, Home "Listings Near You")
 * hide the signed-in user's own listings: they can't book them (the server
 * refuses self-booking) and showing them reads as a bookable spot.
 */

/** Drops rows owned by `viewerId`. Signed out (null) → rows unchanged. */
export function withoutOwnListings<T extends { owner_id?: string | null }>(
  rows: readonly T[],
  viewerId: string | null | undefined,
): T[] {
  if (!viewerId) return [...rows];
  return rows.filter((row) => row.owner_id !== viewerId);
}

type ClaimsClient = {
  auth: {
    getClaims: () => Promise<{ data: { claims?: { sub?: string } } | null } | unknown>;
  };
};

/**
 * The signed-in user's id from the session claims, or null when signed out or
 * the lookup fails — a failure just means nothing is hidden.
 */
export async function getViewerId(client: ClaimsClient): Promise<string | null> {
  try {
    const res = (await client.auth.getClaims()) as
      | { data?: { claims?: { sub?: string } } | null }
      | null
      | undefined;
    return res?.data?.claims?.sub ?? null;
  } catch {
    return null;
  }
}
