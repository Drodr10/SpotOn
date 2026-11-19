/**
 * Launch routing decides signed-in vs signed-out from the session persisted on
 * the device, so an unreachable Supabase doesn't look like a sign-out.
 *
 * WHAT THESE PIN
 *   * a stored, unexpired session → signed in;
 *   * no stored session → signed out;
 *   * an expired session whose refresh failed on the NETWORK
 *     (AuthRetryableFetchError; supabase-js keeps the session) → signed in;
 *   * a refresh the server rejected (supabase-js drops the session) → signed out;
 *   * a getSession that hangs (slow server refreshing a stored session) → signed
 *     in after the timeout, never a blank launch screen.
 */
jest.mock('../src/utils/supabase', () => ({
  supabase: { auth: { getSession: jest.fn() } },
}));

import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { supabase } from '../src/utils/supabase';
import { hasPersistedSession } from '../src/utils/authLaunch';

const getSession = supabase.auth.getSession as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('hasPersistedSession', () => {
  it('is signed in with a stored session (no network involved)', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null });
    await expect(hasPersistedSession()).resolves.toBe(true);
  });

  it('is signed out with no stored session', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(hasPersistedSession()).resolves.toBe(false);
  });

  it('stays signed in when refreshing an expired session fails on the network', async () => {
    getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthRetryableFetchError('Network request failed', 0),
    });
    await expect(hasPersistedSession()).resolves.toBe(true);
  });

  it('stays signed in when getSession throws a network error', async () => {
    getSession.mockRejectedValue(new AuthRetryableFetchError('Network request failed', 0));
    await expect(hasPersistedSession()).resolves.toBe(true);
  });

  it('is signed out when the server rejected the refresh token', async () => {
    getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthApiError('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found'),
    });
    await expect(hasPersistedSession()).resolves.toBe(false);
  });

  it('is signed out when local storage itself fails', async () => {
    getSession.mockRejectedValue(new Error('storage unavailable'));
    await expect(hasPersistedSession()).resolves.toBe(false);
  });

  it('treats a hanging refresh as signed in after the timeout', async () => {
    getSession.mockImplementation(() => new Promise(() => {}));
    const started = Date.now();
    await expect(hasPersistedSession(20)).resolves.toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
