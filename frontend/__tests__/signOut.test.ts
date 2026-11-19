/**
 * Sign-out forgets this device's push token before ending the session.
 *
 * WHAT THESE PIN
 *   * the token is cleared (expo_push_token: null) on the signed-in user's own
 *     row, BEFORE auth.signOut runs (the update needs the session);
 *   * only when the row still holds THIS device's token (the match is in the
 *     UPDATE's WHERE), so signing out on one phone can't wipe another phone's
 *     registration; with no token for this device nothing is written;
 *   * a failed clear (error result, thrown error, or a request that never
 *     answers) never blocks sign-out;
 *   * with no session there is nothing to clear and no write is attempted.
 *
 * WHAT THESE DO NOT COVER
 *   The database side (that the column grant allows the write): that is
 *   supabase/tests/database/security_hardening.test.sql.
 */
jest.mock('../src/utils/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn(), signOut: jest.fn() },
    from: jest.fn(),
  },
}));
jest.mock('../src/utils/push', () => ({ getThisDevicePushToken: jest.fn() }));

import { supabase } from '../src/utils/supabase';
import { getThisDevicePushToken } from '../src/utils/push';
import { clearPushTokenForSignOut, signOutAndForgetDevice } from '../src/utils/signOut';

const USER = 'u-signout-1';
const DEVICE_TOKEN = 'ExponentPushToken[this-device]';
const deviceToken = getThisDevicePushToken as jest.Mock;
const getSession = supabase.auth.getSession as jest.Mock;
const signOut = supabase.auth.signOut as jest.Mock;
const from = supabase.from as jest.Mock;

let order: string[];
let updateArg: unknown;
let eqArgs: unknown[][];

// update(...).eq(...).eq(...): the query runs when the chain is awaited, so
// each .eq returns a thenable that is also chainable.
const stubUpdate = (result: () => Promise<any>) => {
  from.mockImplementation((table: string) => ({
    update: (patch: unknown) => {
      updateArg = { table, patch };
      const chain: any = {
        eq: (...args: unknown[]) => {
          eqArgs.push(args);
          return chain;
        },
        then: (resolve: any, reject: any) => {
          order.push('clear');
          return result().then(resolve, reject);
        },
      };
      return chain;
    },
  }));
};

beforeEach(() => {
  jest.clearAllMocks();
  order = [];
  updateArg = undefined;
  eqArgs = [];
  getSession.mockResolvedValue({ data: { session: { user: { id: USER } } }, error: null });
  deviceToken.mockResolvedValue(DEVICE_TOKEN);
  signOut.mockImplementation(async () => {
    order.push('signOut');
    return { error: null };
  });
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  (console.log as jest.Mock).mockRestore();
});

describe('signOutAndForgetDevice', () => {
  it('clears the push token on the user\'s own profile, then signs out', async () => {
    stubUpdate(async () => ({ error: null }));

    await signOutAndForgetDevice();

    expect(updateArg).toEqual({ table: 'profiles', patch: { expo_push_token: null } });
    // Own row AND only while it still holds this device's token.
    expect(eqArgs).toEqual([
      ['id', USER],
      ['expo_push_token', DEVICE_TOKEN],
    ]);
    expect(order).toEqual(['clear', 'signOut']);
  });

  it('does not clear anything when this device has no push token', async () => {
    // e.g. notifications never allowed here: this device never registered, so
    // whatever token the profile holds belongs to another device.
    deviceToken.mockResolvedValue(null);
    stubUpdate(async () => ({ error: null }));

    await signOutAndForgetDevice();

    expect(from).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('still signs out when looking up the device token throws', async () => {
    deviceToken.mockRejectedValue(new Error('expo push service down'));
    stubUpdate(async () => ({ error: null }));

    await signOutAndForgetDevice();

    expect(from).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('still signs out when the clear is refused', async () => {
    stubUpdate(async () => ({ error: { message: 'permission denied for table profiles' } }));

    await signOutAndForgetDevice();

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('still signs out when the clear throws', async () => {
    stubUpdate(async () => {
      throw new Error('Network request failed');
    });

    await signOutAndForgetDevice();

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('still signs out when the session lookup throws', async () => {
    getSession.mockRejectedValue(new Error('storage unavailable'));

    await signOutAndForgetDevice();

    expect(from).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('does not write anything without a session', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });

    await signOutAndForgetDevice();

    expect(from).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

describe('clearPushTokenForSignOut', () => {
  it('gives up on a device-token lookup that never answers', async () => {
    deviceToken.mockImplementation(() => new Promise(() => {}));
    stubUpdate(async () => ({ error: null }));

    const started = Date.now();
    await clearPushTokenForSignOut(20);

    expect(Date.now() - started).toBeLessThan(1000);
    expect(from).not.toHaveBeenCalled();
  });

  it('gives up on a request that never answers instead of blocking sign-out', async () => {
    stubUpdate(() => new Promise(() => {}));

    const started = Date.now();
    await clearPushTokenForSignOut(20);

    expect(Date.now() - started).toBeLessThan(1000);
    expect(order).toEqual(['clear']);
  });
});
