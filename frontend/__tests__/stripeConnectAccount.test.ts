/**
 * Payout setup: the app no longer writes profiles.stripe_account_id itself.
 *
 * The backend's create-connect-account stores the id (service_role), and
 * 20261116180000_security_hardening.sql stops clients from changing it, so a
 * client write here would be redundant at best and, if it ever sent a
 * different value, refused.
 *
 * WHAT THESE PIN
 *   * fetchStripeAccountId returns the backend's account id and never touches
 *     the profiles table;
 *   * a failed backend call still reports failure (null), so the caller shows
 *     its "Couldn't set up payouts" alert.
 */
process.env.EXPO_PUBLIC_IP = 'example.ngrok.app';

jest.mock('../src/utils/supabase', () => ({
  supabase: { auth: { getSession: jest.fn() }, from: jest.fn() },
}));

import { supabase } from '../src/utils/supabase';
import { stripe } from '../src/utils/stripe';

const getSession = supabase.auth.getSession as jest.Mock;
const from = supabase.from as jest.Mock;

const respond = (status: number, body: any = {}) => {
  (globalThis as any).fetch = jest.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }));
};

beforeEach(() => {
  jest.clearAllMocks();
  getSession.mockResolvedValue({
    data: { session: { access_token: 'jwt', user: { id: 'u1' } } },
    error: null,
  });
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  (console.log as jest.Mock).mockRestore();
});

describe('stripe.fetchStripeAccountId', () => {
  it('returns the backend-created account id without writing the profile', async () => {
    respond(200, { account_id: 'acct_123' });

    await expect(stripe.fetchStripeAccountId()).resolves.toBe('acct_123');

    const [url, init] = (globalThis as any).fetch.mock.calls[0];
    expect(url).toBe('https://example.ngrok.app/api/stripe/create-connect-account');
    expect(init.headers.Authorization).toBe('Bearer jwt');
    expect(from).not.toHaveBeenCalled();
  });

  it('reports a backend failure as null', async () => {
    respond(500, { error: 'boom' });

    await expect(stripe.fetchStripeAccountId()).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
});
