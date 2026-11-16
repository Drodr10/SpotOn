/**
 * Regression test for the Profile screen's endless refetch loop.
 *
 * The bug: Profile passed an inline arrow to useFocusEffect. useFocusEffect
 * re-runs whenever its callback's identity changes, so it re-ran after every
 * render; each run fetched vehicles, in-progress reservations and a listings
 * count, set state, re-rendered, and ran again (~290 requests/s while Profile
 * was open). The fix memoises the callback with useCallback(..., [userId]).
 *
 * WHAT THESE PIN
 *   * after mount and a long settle period, the vehicles query, the listings
 *     count query and the in-progress reservations call have each run a small,
 *     bounded number of times (once from the initial profile load, once from
 *     the focus effect) — and the counts stop growing.
 *   * verified to FAIL when the useCallback wrapper is removed (counts climb
 *     with every settle cycle) and PASS with it in place.
 *
 * WHAT THESE DO NOT COVER
 *   * real navigation focus/blur. The useFocusEffect mock below treats the
 *     screen as permanently focused; it does not test "refetch on refocus".
 *   * anything visual, or the edit/avatar/payout/delete flows on the screen.
 *   * the real Supabase client or backend — both are mocked at the module
 *     boundary.
 */
import { act, render } from '@testing-library/react-native';

import ProfilePage from '@/src/app/Profile';
import { supabase } from '@/src/utils/supabase';
import { api } from '@/src/utils/api';

const USER = '11111111-1111-4111-8111-111111111111';

// The mock must behave like the real hook for this test to mean anything.
// expo-router's useFocusEffect (from @react-navigation/native) runs the effect
// while the screen is focused and RE-RUNS it whenever the callback's identity
// changes — effectively useEffect(cb, [cb]). That identity check is exactly
// what turned an inline callback into a loop. A simpler mock that only calls
// the callback once on mount would pass with or without the bug.
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
    useFocusEffect: (effect: () => void | (() => void)) => {
      React.useEffect(() => effect(), [effect]);
    },
  };
});

// Every query returns a FRESH array/object per call, as the network would, so
// setState never bails out on referential equality and the bug can show.
//
// Circuit breaker: past MOCK_CALL_CAP calls a query never resolves. Without it the
// buggy version loops forever inside act() and the test dies on a 5s timeout
// instead of a readable count assertion. The cap is far above the expected
// count (<= 2), so it never affects a passing run.
const MOCK_CALL_CAP = 25;
jest.mock('@/src/utils/supabase', () => {
  const calls: Record<string, number> = {};
  const resultFor = (table: string) => {
    if (table === 'profiles') {
      return {
        data: {
          id: '11111111-1111-4111-8111-111111111111',
          full_name: 'Test User',
          email: 'test@example.com',
          rating_avg: 5,
          created_at: '2026-01-01T00:00:00Z',
          avatar_url: null,
          stripe_account_id: null,
          payouts_enabled: false,
        },
        error: null,
      };
    }
    if (table === 'listings') return { data: null, count: 0, error: null };
    return { data: [], error: null };
  };
  const from = jest.fn((table: string) => {
    calls[table] = (calls[table] ?? 0) + 1;
    const result = (): Promise<any> =>
      calls[table] > MOCK_CALL_CAP ? new Promise(() => {}) : Promise.resolve(resultFor(table));
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      single: result,
      then: (resolve: any, reject: any) => result().then(resolve, reject),
    };
    return builder;
  });
  return {
    supabase: {
      from,
      __calls: calls,
      auth: {
        getClaims: jest.fn(async () => ({
          data: { claims: { sub: '11111111-1111-4111-8111-111111111111' } },
          error: null,
        })),
        signOut: jest.fn(),
        updateUser: jest.fn(),
      },
      storage: { from: jest.fn() },
    },
  };
});

jest.mock('@/src/utils/api', () => ({
  api: {
    getInProgressReservations: jest.fn(() => {
      const n = (jest.requireMock('@/src/utils/api') as any).api.getInProgressReservations.mock.calls.length;
      return n > MOCK_CALL_CAP ? new Promise(() => {}) : Promise.resolve([]);
    }),
    deleteAccount: jest.fn(),
  },
}));

jest.mock('@/src/utils/stripe', () => ({
  stripe: {
    fetchStripeAccountId: jest.fn(),
    fetchStripeAccountLink: jest.fn(),
    syncAccount: jest.fn(),
  },
}));

jest.mock('@/src/utils/haptics', () => ({
  triggerLightHaptic: jest.fn(),
  withLightHaptic: (fn: any) => fn,
}));

// Child components are irrelevant to the fetch loop and pull in reanimated,
// worklets and their own data fetching (MenuBar), so they are stubbed out.
jest.mock('@/src/components/MenuBar', () => ({ MENU_BAR_HEIGHT: 80 }));
jest.mock('@/src/components/PillMenu', () => ({
  __esModule: true,
  default: () => null,
  PillMenuBackdrop: () => null,
  pillMenuHostStyleForRows: () => ({}),
}));
jest.mock('@/src/components/ProfilePageComponents/ReservationInfoCard', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn(), openBrowserAsync: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

const tableCalls = (supabase as any).__calls as Record<string, number>;
const reservationCalls = api.getInProgressReservations as jest.Mock;

// One "tick": let every pending promise resolve and every resulting render and
// effect flush. With the bug, each tick triggers another full round of fetches.
const settle = async (ticks: number) => {
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

beforeEach(() => {
  for (const key of Object.keys(tableCalls)) delete tableCalls[key];
  reservationCalls.mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('Profile fetches vehicles, listings and reservations a bounded number of times, not in a loop', async () => {
  const screen = await render(<ProfilePage />);

  await settle(30);

  // Sanity: the screen actually loaded, so a zero count can't pass vacuously.
  expect(tableCalls.profiles).toBe(1);
  expect(tableCalls.vehicles).toBeGreaterThanOrEqual(1);
  expect(reservationCalls).toHaveBeenCalledWith(USER);

  // Once from loadProfile + once from the focus effect.
  expect(tableCalls.vehicles).toBeLessThanOrEqual(2);
  expect(tableCalls.listings).toBeLessThanOrEqual(2);
  expect(reservationCalls.mock.calls.length).toBeLessThanOrEqual(2);

  // And they stay put: a loop would keep climbing.
  const snapshot = {
    vehicles: tableCalls.vehicles,
    listings: tableCalls.listings,
    reservations: reservationCalls.mock.calls.length,
  };
  await settle(30);
  expect({
    vehicles: tableCalls.vehicles,
    listings: tableCalls.listings,
    reservations: reservationCalls.mock.calls.length,
  }).toEqual(snapshot);

  await screen.unmount();
});
