export type GeocodeResult = { lat: number; lon: number } | null;

type GeocodeOptions = { signal?: AbortSignal | null; timeoutMs?: number };

const cache = new Map<string, GeocodeResult>();

export async function geocodeQuery(query: string, options: GeocodeOptions = {}): Promise<GeocodeResult> {
  if (!query || query.trim().length === 0) return null;
  const q = query.trim();
  if (cache.has(q)) return cache.get(q) ?? null;

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
    q,
  )}`;

  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;
  const timeoutMs = options.timeoutMs ?? 5000;

  // If caller didn't provide a signal, set up a timeout abort.
  let timeoutId: any = null;
  if (!options.signal) {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'SpotOn/1.0 (+https://example.com)' }, signal });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (Array.isArray(data) && data.length > 0) {
      const res = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      cache.set(q, res);
      return res;
    }
    cache.set(q, null);
    return null;
  } catch (e) {
    if ((e as any)?.name === 'AbortError') {
      // treat as no result
      return null;
    }
    throw e;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export default geocodeQuery;

/** The subset of expo-location's LocationGeocodedAddress we format. */
export type ReverseGeocodeParts = {
  streetNumber?: string | null;
  street?: string | null;
  name?: string | null;
  city?: string | null;
  region?: string | null;
};

const clean = (s: string | null | undefined): string => (typeof s === 'string' ? s.trim() : '');

/**
 * Formats a reverse-geocode result as "1201 Brickell Ave, Miami, FL".
 * The street number and street are one address line (space-joined); only the
 * line, city and region are comma-separated. Missing parts are skipped. With no
 * street at all, falls back to `name` (often a place or a full street line).
 * Returns '' when nothing usable is present.
 */
export function formatReverseGeocodeAddress(r: ReverseGeocodeParts | null | undefined): string {
  if (!r) return '';
  const street = clean(r.street);
  const line1 = street ? [clean(r.streetNumber), street].filter(Boolean).join(' ') : clean(r.name);
  const city = clean(r.city);
  const region = clean(r.region);
  return [line1, city, region]
    .filter(Boolean)
    // Drop a part that repeats the previous one (e.g. name === city).
    .filter((part, i, arr) => i === 0 || part !== arr[i - 1])
    .join(', ');
}
