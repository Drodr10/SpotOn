/**
 * Tests for the device push-token helpers in utils/push.ts.
 *
 * WHAT THESE PIN
 *   * sign-out's token lookup uses the copy saved on the phone at registration,
 *     with NO permission check and NO network call — the automated security
 *     review's fail-open case (lookup fails → token never cleared → previous
 *     user's pushes keep arriving on a shared phone)
 *   * registration saves the token on the phone and claims it through the
 *     claim_push_token RPC (which strips it from other profiles), falling back
 *     to a plain profile update only when the RPC doesn't exist yet
 *
 * WHAT THESE DO NOT COVER
 *   The RPC itself (pgTAP: supabase/tests/database/push_token_claim.test.sql)
 *   and real Expo push delivery.
 */
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
};

const getPermissionsAsync = jest.fn();
const requestPermissionsAsync = jest.fn();
const getExpoPushTokenAsync = jest.fn();
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: (...a: unknown[]) => getPermissionsAsync(...a),
  requestPermissionsAsync: (...a: unknown[]) => requestPermissionsAsync(...a),
  getExpoPushTokenAsync: (...a: unknown[]) => getExpoPushTokenAsync(...a),
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'proj' } } } } }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const rpc = jest.fn();
const update = jest.fn();
const eq = jest.fn();
jest.mock('../src/utils/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ update: (...a: unknown[]) => { update(...a); return { eq: (...b: unknown[]) => eq(...b) }; } }),
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  },
}));

import { getThisDevicePushToken, readCachedPushToken, registerForPushNotifications } from '../src/utils/push';

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  getPermissionsAsync.mockResolvedValue({ status: 'granted' });
  getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
  rpc.mockResolvedValue({ error: null });
  eq.mockResolvedValue({ error: null });
});
afterEach(() => (console.log as jest.Mock).mockRestore());

it('uses the token saved on the phone without asking for permission or the network', async () => {
  store.set('spoton.pushToken', 'ExponentPushToken[saved]');
  getPermissionsAsync.mockResolvedValue({ status: 'denied' });
  getExpoPushTokenAsync.mockRejectedValue(new Error('offline'));

  await expect(getThisDevicePushToken()).resolves.toBe('ExponentPushToken[saved]');
  expect(getPermissionsAsync).not.toHaveBeenCalled();
  expect(getExpoPushTokenAsync).not.toHaveBeenCalled();
});

it('falls back to a live lookup when nothing is saved', async () => {
  await expect(getThisDevicePushToken()).resolves.toBe('ExponentPushToken[abc]');
});

it('registration saves the token on the phone and claims it via the RPC', async () => {
  await registerForPushNotifications();
  expect(readCachedPushToken()).toBe('ExponentPushToken[abc]');
  expect(rpc).toHaveBeenCalledWith('claim_push_token', { p_token: 'ExponentPushToken[abc]' });
  expect(update).not.toHaveBeenCalled();
});

it('falls back to a plain profile update when the database has no claim_push_token yet', async () => {
  rpc.mockResolvedValue({ error: { message: 'Could not find the function public.claim_push_token(p_token) in the schema cache' } });
  await registerForPushNotifications();
  expect(update).toHaveBeenCalledWith({ expo_push_token: 'ExponentPushToken[abc]' });
  expect(eq).toHaveBeenCalledWith('id', 'u1');
});

it('does not fall back on unrelated errors', async () => {
  rpc.mockResolvedValue({ error: { message: 'permission denied' } });
  await registerForPushNotifications();
  expect(update).not.toHaveBeenCalled();
});
