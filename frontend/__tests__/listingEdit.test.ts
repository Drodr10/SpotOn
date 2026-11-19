/**
 * Edit Listing helpers.
 *
 * WHAT THESE PIN
 *   * rates: blank = skipped (priced from the next tier), junk/zero/negative rejected, at least one rate
 *     required, and price_per_hour (legacy NOT NULL column that pricing falls
 *     back to as the hourly rate) derived like CreateListing2 does.
 *   * windowConflict: a new availability window may not leave out a paid,
 *     unfinished booking — reservations are never re-validated when the listing
 *     changes, so this is the only guard.
 */
jest.mock('../src/utils/supabase', () => ({ supabase: {} }));

import { parseRate, validateRates, windowConflict, rateInputsFrom } from '../src/utils/listingEdit';
import type { Booking } from '../src/utils/activity';

const blank = { hourly_rate: '', daily_rate: '', weekly_rate: '', monthly_rate: '' };

describe('parseRate', () => {
  it.each([
    ['', null],
    ['  ', null],
    ['3', 3],
    ['3.5', 3.5],
    ['$3.50', 3.5],
    ['.75', 0.75],
  ])('%p -> %p', (raw, expected) => expect(parseRate(raw)).toBe(expected));

  it.each(['abc', '3.555', '-2', '1e3', '3,50'])('rejects %p', (raw) =>
    expect(parseRate(raw)).toBe('invalid'),
  );
});

describe('validateRates', () => {
  it('requires at least one rate', () => {
    const r = validateRates(blank);
    expect(r.ok).toBe(false);
  });

  it('rejects zero and absurd values', () => {
    expect(validateRates({ ...blank, hourly_rate: '0' }).ok).toBe(false);
    expect(validateRates({ ...blank, hourly_rate: '20000' }).ok).toBe(false);
  });

  it('uses the hourly rate for price_per_hour when present', () => {
    const r = validateRates({ ...blank, hourly_rate: '3', daily_rate: '20' });
    expect(r).toEqual({
      ok: true,
      update: { hourly_rate: 3, daily_rate: 20, weekly_rate: null, monthly_rate: null, price_per_hour: 3 },
    });
  });

  it('derives price_per_hour from weekly like CreateListing2 (weekly / 168)', () => {
    const r = validateRates({ ...blank, weekly_rate: '50' });
    expect(r.ok && r.update.price_per_hour).toBe(0.3);
    expect(r.ok && r.update.hourly_rate).toBeNull();
  });

  it('refuses rates that would make short stays free (price_per_hour rounds to $0)', () => {
    // $3/month ÷ 720 h = $0.004/h → round2 → 0: pricing would bill short stays at $0.
    const r = validateRates({ ...blank, monthly_rate: '3' });
    expect(r.ok).toBe(false);
    // A realistic monthly-only spot is fine.
    expect(validateRates({ ...blank, monthly_rate: '300' }).ok).toBe(true);
  });

  it('round-trips existing listing values', () => {
    const inputs = rateInputsFrom({ hourly_rate: 3, daily_rate: null, weekly_rate: 50, monthly_rate: null });
    expect(inputs).toEqual({ hourly_rate: '3.00', daily_rate: '', weekly_rate: '50.00', monthly_rate: '' });
    expect(validateRates(inputs).ok).toBe(true);
  });
});

describe('windowConflict', () => {
  const NOW = new Date('2026-12-01T12:00:00Z').getTime();
  const booking = (start: string, end: string, extra: Partial<Booking> = {}): Booking => ({
    id: start,
    listingId: 'L',
    renterId: 'R',
    start: new Date(start),
    end: new Date(end),
    totalPrice: 10,
    platformFee: 1,
    hostPayout: 9,
    status: 'confirmed',
    payoutStatus: 'held',
    vehicleId: null,
    listing: null,
    ...extra,
  });
  const upcoming = booking('2026-12-10T10:00:00Z', '2026-12-10T12:00:00Z');

  it('allows a window that contains every upcoming booking', () => {
    expect(windowConflict([upcoming], new Date('2026-12-05'), new Date('2026-12-20'), NOW)).toBeNull();
  });

  it('allows clearing the window', () => {
    expect(windowConflict([upcoming], null, null, NOW)).toBeNull();
  });

  it('blocks an end date before an upcoming booking ends', () => {
    expect(windowConflict([upcoming], null, new Date('2026-12-10T11:00:00Z'), NOW)).toBe(upcoming);
  });

  it('blocks a start date after an upcoming booking starts', () => {
    expect(windowConflict([upcoming], new Date('2026-12-15'), null, NOW)).toBe(upcoming);
  });

  it('ignores finished, cancelled, refunded and unpaid bookings', () => {
    const past = booking('2026-11-01T10:00:00Z', '2026-11-01T12:00:00Z');
    const cancelled = booking('2026-12-10T10:00:00Z', '2026-12-10T12:00:00Z', { status: 'cancelled' });
    const refunded = booking('2026-12-10T10:00:00Z', '2026-12-10T12:00:00Z', { payoutStatus: 'refunded' });
    const unpaid = booking('2026-12-10T10:00:00Z', '2026-12-10T12:00:00Z', {
      status: 'pending',
      payoutStatus: 'pending_payment',
    });
    expect(
      windowConflict([past, cancelled, refunded, unpaid], new Date('2026-12-15'), new Date('2026-12-16'), NOW),
    ).toBeNull();
  });

  it('reports the earliest clashing booking', () => {
    const later = booking('2026-12-20T10:00:00Z', '2026-12-20T12:00:00Z');
    expect(windowConflict([later, upcoming], new Date('2026-12-25'), null, NOW)).toBe(upcoming);
  });
});
