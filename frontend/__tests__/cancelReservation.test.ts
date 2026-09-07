/**
 * Tests for the renter-initiated cancellation API helper.
 *
 * WHAT THESE PIN
 *   * a missing EXPO_PUBLIC_IP is an ERROR, never a 'cancelled' result -- same
 *     reasoning as deleteAccount's sibling test: a silent no-op here would let
 *     the UI remove a booking from the list that was never actually cancelled
 *     or refunded server-side.
 *   * 409 is its own outcome ('blocked'), carrying the server's message
 *     through verbatim -- "cancel this booking" failing because the window
 *     passed or it's already cancelled needs to say why, not just "error".
 *   * the request is authenticated and sends reservation_id in the body.
 *
 * WHAT THESE DO NOT COVER
 *   The Alert/list-removal sequencing in PreviousReservations.tsx -- that
 *   needs a component renderer this project does not currently set up.
 */
jest.mock('../src/utils/supabase', () => ({
  supabase: { auth: { getSession: jest.fn() } },
}));

import { supabase } from '../src/utils/supabase';
import { api } from '../src/utils/api';

const TOKEN = 'jwt-token';
const RES_ID = 'r-cancel-1';

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
    data: { session: { access_token: TOKEN, user: { id: 'u1' } } },
    error: null,
  });
});

describe('api.cancelReservation', () => {
  it('reports an unreachable server as an error, never as a cancellation', async () => {
    delete process.env.EXPO_PUBLIC_IP;
    respond(200);

    const result = await api.cancelReservation(RES_ID);

    expect(result.status).toBe('error');
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('treats an empty EXPO_PUBLIC_IP as unset', async () => {
    process.env.EXPO_PUBLIC_IP = '';
    respond(200);

    expect((await api.cancelReservation(RES_ID)).status).toBe('error');
  });

  it('returns cancelled on 200', async () => {
    respond(200);

    expect(await api.cancelReservation(RES_ID)).toEqual({ status: 'cancelled' });
  });

  it('sends an authenticated POST with the reservation id', async () => {
    respond(200);

    await api.cancelReservation(RES_ID);

    const [url, init] = (global as any).fetch.mock.calls[0];
    expect(url).toBe('https://example.ngrok.app/api/stripe/cancel-reservation');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body)).toEqual({ reservation_id: RES_ID });
  });

  it('surfaces the server message on 409 as a blocked outcome, not an error', async () => {
    respond(409, { error: 'Bookings can only be cancelled at least 24 hours before they start' });

    const result = await api.cancelReservation(RES_ID);

    expect(result).toEqual({
      status: 'blocked',
      message: 'Bookings can only be cancelled at least 24 hours before they start',
    });
  });

  it('falls back to a generic message when 409 carries no error field', async () => {
    respond(409, {});

    const result = await api.cancelReservation(RES_ID);

    expect(result).toEqual({
      status: 'blocked',
      message: 'This reservation can no longer be cancelled.',
    });
  });

  it('surfaces the server message on a refund failure (502) as an error', async () => {
    respond(502, { error: 'Refund failed, please contact support' });

    expect(await api.cancelReservation(RES_ID)).toEqual({
      status: 'error',
      message: 'Refund failed, please contact support',
    });
  });

  it('does not claim cancellation when the response body is unparseable', async () => {
    (global as any).fetch = jest.fn(async () => ({
      status: 502,
      ok: false,
      json: async () => {
        throw new Error('not json');
      },
    }));

    const result = await api.cancelReservation(RES_ID);

    expect(result.status).toBe('error');
    expect((result as any).message).toContain('502');
  });

  it('reports a network failure instead of throwing', async () => {
    (global as any).fetch = jest.fn(async () => {
      throw new Error('Network request failed');
    });

    expect(await api.cancelReservation(RES_ID)).toEqual({
      status: 'error',
      message: 'Network request failed',
    });
  });

  it('refuses without a session, so a signed-out tap cannot hit the API', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    respond(200);

    expect((await api.cancelReservation(RES_ID)).status).toBe('error');
    expect((global as any).fetch).not.toHaveBeenCalled();
  });
});
