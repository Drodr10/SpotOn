type SupabaseClientLike = {
  from: (table: string) => any;
};

function getDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function fetchListingsAround(
  supabaseClient: SupabaseClientLike,
  centerLat: number,
  centerLng: number,
  radiusMiles = 5,
) {
  const latDelta = 0.0724;
  const lngDelta = 0.0724 / Math.cos((centerLat * Math.PI) / 180);

  const chain = supabaseClient.from('listings');
  const result = await chain
    .select('*')
    .eq('is_active', true)
    .gte('latitude', centerLat - latDelta)
    .lte('latitude', centerLat + latDelta)
    .gte('longitude', centerLng - lngDelta)
    .lte('longitude', centerLng + lngDelta);

  const { data, error } = result as { data: any[] | null; error: any };
  if (error) throw error;
  const rows = data ?? [];

  const withDistance = rows
    .map((l: any) => ({ ...l, distance: getDistanceMiles(centerLat, centerLng, l.latitude, l.longitude) }))
    .filter((l: any) => l.distance <= radiusMiles)
    .sort((a: any, b: any) => a.distance - b.distance);

  return withDistance;
}

export default fetchListingsAround;
