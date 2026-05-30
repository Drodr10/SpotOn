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
