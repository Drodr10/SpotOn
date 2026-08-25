/**
 * Tests for the account-deletion API helper (App Store Guideline 5.1.1(v)).
 *
 * WHAT THESE PIN
 *   * a missing EXPO_PUBLIC_IP is an ERROR, never a success. The screen signs
 *     the user out on a 'deleted' result, so a silent no-op here would report
 *     that an account was deleted while it still existed. This is the one that
 *     matters most.
 *   * 409 is its own outcome and carries the server's reasons through verbatim.
 *     Collapsing it into 'error' would show the user "can't delete yet" with no
 *     explanation of why or what to do.
 *   * the request is authenticated and targets the session's own user id.
 *
 * WHAT THESE DO NOT COVER
 *   The Alert/sign-out sequencing in Profile.tsx — that needs a component
 *   renderer this project does not currently set up.
 */
jest.mock('../src/utils/supabase', () => ({
  supabase: { auth: { getSession: jest.fn() } },
}));

import { supabase } from '../src/utils/supabase';
import { api } from '../src/utils/api';

const USER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'jwt-token';

const getSession = supabase.auth.getSession as jest.Mock;

const respond = (status: number, body: any = {}) => {
  (global as any).fetch = jest.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }));
};

beforeEach(() => {
  process.env.EXPO_PUBLIC_IP = 'example.ngrok.app';
  getSession.mockResolvedValue({
    data: { session: { access_token: TOKEN, user: { id: USER } } },
    error: null,
  });
});

describe('api.deleteAccount', () => {
  it('reports an unreachable server as an error, never as a deletion', async () => {
    delete process.env.EXPO_PUBLIC_IP;
    respond(200);

    const result = await api.deleteAccount();

    expect(result.status).toBe('error');
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('treats an empty EXPO_PUBLIC_IP as unset', async () => {
    process.env.EXPO_PUBLIC_IP = '';
    respond(200);

    expect((await api.deleteAccount()).status).toBe('error');
  });

  it('returns deleted on 200', async () => {
    respond(200, { deleted: true });

    expect(await api.deleteAccount()).toEqual({ status: 'deleted' });
  });

  it('does not treat a redirect or a 204 as a deletion', async () => {
    // A tunnel or proxy sitting in front of the API can answer 302 with a login
    // page, and 204 is not what this endpoint returns on success. Accepting any
    // non-4xx would sign the user out while the account still existed.
    for (const status of [204, 302]) {
      respond(status);
      expect((await api.deleteAccount()).status).not.toBe('deleted');
    }
  });

  it('sends an authenticated DELETE for the session user', async () => {
    respond(200);

    await api.deleteAccount();

    const [url, init] = (global as any).fetch.mock.calls[0];
    expect(url).toBe(`https://example.ngrok.app/api/profiles/${USER}`);
    expect(init.method).toBe('DELETE');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('passes the blocking reasons through verbatim on 409', async () => {
    const reasons = [
      "You have 2 booking(s) that haven't finished yet. You can delete your account once they end, or cancel them first.",
      'You have earnings from 1 booking(s) that have not been paid out yet. Deleting now would forfeit them.',
    ];
    respond(409, { error: "Your account can't be deleted yet.", reasons, code: 'deletion_blocked' });

    const result = await api.deleteAccount();

    expect(result).toEqual({ status: 'blocked', reasons });
  });

  it('does not report blocked when the server sends no reasons', async () => {
    respond(409, { error: "Your account can't be deleted yet." });

    const result = await api.deleteAccount();

    expect(result.status).toBe('error');
  });

  it('surfaces the server message on 500 rather than a raw status', async () => {
    respond(500, { error: 'Could not delete your account. Please try again.' });

    expect(await api.deleteAccount()).toEqual({
      status: 'error',
      message: 'Could not delete your account. Please try again.',
    });
  });

  it('does not claim deletion when the response body is unparseable', async () => {
    (global as any).fetch = jest.fn(async () => ({
      status: 502,
      ok: false,
      json: async () => {
        throw new Error('not json');
      },
    }));

    const result = await api.deleteAccount();

    expect(result.status).toBe('error');
    expect((result as any).message).toContain('502');
  });

  it('reports a network failure instead of throwing', async () => {
    (global as any).fetch = jest.fn(async () => {
      throw new Error('Network request failed');
    });

    expect(await api.deleteAccount()).toEqual({
      status: 'error',
      message: 'Network request failed',
    });
  });

  it('refuses without a session, so a signed-out tap cannot hit the API', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    respond(200);

    expect((await api.deleteAccount()).status).toBe('error');
    expect((global as any).fetch).not.toHaveBeenCalled();
  });
});
