import fetchListingsAround from '../src/utils/listings';

function makeSupabaseMock(data: any[]) {
  const chain: any = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.gte = jest.fn(() => chain);
  chain.lte = jest.fn(() => chain);
  // make the chain awaitable — resolve to { data, error }
  chain.then = (resolve: any, reject: any) => Promise.resolve({ data, error: null }).then(resolve, reject);
  const client = { from: jest.fn(() => chain) };
  return client;
}

describe('fetchListingsAround', () => {
  it('filters listings by 5-mile radius and sorts by distance', async () => {
    const centerLat = 28.5383;
    const centerLng = -81.3792;
    const data = [
      { id: 'a', latitude: 28.540, longitude: -81.380 }, // near
      { id: 'b', latitude: 29.6516, longitude: -82.3248 }, // far (Gainesville)
      { id: 'c', latitude: 28.550, longitude: -81.400 }, // near-ish
    ];

    const supabase = makeSupabaseMock(data);
    const res = await fetchListingsAround(supabase, centerLat, centerLng, 5);
    expect(res.map((r: any) => r.id)).toEqual(['a', 'c']);
    // distances should be ascending
    expect(res[0].distance).toBeLessThanOrEqual(res[1].distance);
  });
});
