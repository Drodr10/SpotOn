import geocodeQuery from '../src/utils/geocode';

global.fetch = jest.fn();

describe('geocodeQuery', () => {
  beforeEach(() => {
    (fetch as jest.Mock).mockReset();
  });

  it('returns lat/lon for valid nominatim response', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [{ lat: '28.5383', lon: '-81.3792' }],
    });

    const res = await geocodeQuery('Orlando');
    expect(res).toEqual({ lat: 28.5383, lon: -81.3792 });
  });

  it('returns null for empty results', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => [] });
    const res = await geocodeQuery('SomeUnknownPlaceThatDoesNotExist');
    expect(res).toBeNull();
  });

  it('returns null for non-ok response', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
    const res = await geocodeQuery('');
    expect(res).toBeNull();
  });
});
