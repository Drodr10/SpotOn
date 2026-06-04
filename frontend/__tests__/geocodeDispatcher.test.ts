import GeocodeDispatcher from '../src/utils/geocodeDispatcher';
import type { GeocodeResult } from '../src/utils/geocode';

jest.useFakeTimers();

describe('GeocodeDispatcher', () => {
  it('returns result for single query after debounce', async () => {
    const mockGeocode = jest.fn(async (q: string) => {
      // simulate async delay
      await new Promise((r) => setTimeout(r, 100));
      return { lat: 1, lon: 2 } as GeocodeResult;
    });

    const d = new GeocodeDispatcher(mockGeocode, 200);
    const p = d.search('A');
    // advance debounce
    jest.advanceTimersByTime(200);
    // now advance geocode delay
    jest.advanceTimersByTime(100);
    const res = await p;
    expect(res).toEqual({ lat: 1, lon: 2 });
  });

  it('only resolves the latest query when multiple fired rapidly', async () => {
    const mockGeocode = jest.fn(async (q: string) => {
      // delay depends on query to simulate different arrival times
      const delay = q === 'first' ? 300 : 50;
      await new Promise((r) => setTimeout(r, delay));
      return q === 'first' ? { lat: 1, lon: 1 } : { lat: 9, lon: 9 };
    });

    const d = new GeocodeDispatcher(mockGeocode, 200);
    const p1 = d.search('first');
    // before debounce fires, user types again
    jest.advanceTimersByTime(100);
    const p2 = d.search('second');

    // advance to cause debounce for second and run timers
    jest.advanceTimersByTime(200);
    // run any pending timers (including geocode internal setTimeout)
    jest.runOnlyPendingTimers();
    // allow microtasks to flush
    await Promise.resolve();
    const res2 = await p2;
    const res1 = await p1;

    // p2 should have result, p1 should be null because superseded
    expect(res2).toEqual({ lat: 9, lon: 9 });
    expect(res1).toBeNull();
  });

  it('cancel prevents result from resolving', async () => {
    const mockGeocode = jest.fn(async (q: string) => {
      await new Promise((r) => setTimeout(r, 100));
      return { lat: 5, lon: 5 } as GeocodeResult;
    });

    const d = new GeocodeDispatcher(mockGeocode, 200);
    const p = d.search('x');
    jest.advanceTimersByTime(100);
    // cancel before debounce fires
    d.cancel();
    // advance timers past debounce and geocode
    jest.advanceTimersByTime(200);
    jest.runOnlyPendingTimers();
    await Promise.resolve();
    const res = await p;
    expect(res).toBeNull();
  });
});
