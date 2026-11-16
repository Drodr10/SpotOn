/**
 * Sign-out forgets this device's push token before ending the session.
 *
 * WHAT THESE PIN
 *   * the token is cleared (expo_push_token: null) on the signed-in user's own
 *     row, BEFORE auth.signOut runs (the update needs the session);
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

import { supabase } from '../src/utils/supabase';
import { clearPushTokenForSignOut, signOutAndForgetDevice } from '../src/utils/signOut';

const USER = 'u-signout-1';
const getSession = supabase.auth.getSession as jest.Mock;
const signOut = supabase.auth.signOut as jest.Mock;
const from = supabase.from as jest.Mock;

let order: string[];
let updateArg: unknown;
let eqArgs: unknown[];

const stubUpdate = (result: () => Promise<any>) => {
  from.mockImplementation((table: string) => ({
    update: (patch: unknown) => {
      updateArg = { table, patch };
      return {
        eq: (...args: unknown[]) => {
          eqArgs = args;
          order.push('clear');
          return result();
        },
      };
    },
  }));
};

beforeEach(() => {
  jest.clearAllMocks();
  order = [];
  updateArg = undefined;
  eqArgs = [];
  getSession.mockResolvedValue({ data: { session: { user: { id: USER } } }, error: null });
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
    expect(eqArgs).toEqual(['id', USER]);
    expect(order).toEqual(['clear', 'signOut']);
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
  it('gives up on a request that never answers instead of blocking sign-out', async () => {
    stubUpdate(() => new Promise(() => {}));

    const started = Date.now();
    await clearPushTokenForSignOut(20);

    expect(Date.now() - started).toBeLessThan(1000);
    expect(order).toEqual(['clear']);
  });
});
