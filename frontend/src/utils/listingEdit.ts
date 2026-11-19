/**
 * Pure helpers for the Edit Listing screen: rate parsing/validation, the rate
 * columns to write, and the "would this availability change strand a booking"
 * check. Kept free of React/Supabase so they are unit-tested directly.
 */

import type { Booking } from './activity';

export type RateKey = 'hourly_rate' | 'daily_rate' | 'weekly_rate' | 'monthly_rate';
export const RATE_KEYS: RateKey[] = ['hourly_rate', 'daily_rate', 'weekly_rate', 'monthly_rate'];

export const RATE_LABELS: Record<RateKey, string> = {
  hourly_rate: 'Hourly',
  daily_rate: 'Daily',
  weekly_rate: 'Weekly',
  monthly_rate: 'Monthly',
};

/** Upper bound on any single rate; anything above is almost certainly a typo. */
export const MAX_RATE = 10_000;

export type RateInputs = Record<RateKey, string>;

export type RateUpdate = {
  hourly_rate: number | null;
  daily_rate: number | null;
  weekly_rate: number | null;
  monthly_rate: number | null;
  /**
   * Legacy NOT NULL column. The pricing engine (backend/utils/pricing.py) and the
   * DB rule reservation_validation_error both fall back to it as the hourly rate
   * when hourly_rate is null, so it must stay consistent with the real rates.
   * Derived the same way CreateListing2's buildRatePayload does.
   */
  price_per_hour: number;
};

export type RateValidation = { ok: true; update: RateUpdate } | { ok: false; message: string };

/** '' -> null (rate not offered); otherwise a positive number with at most 2 decimals. */
export function parseRate(raw: string): number | null | 'invalid' {
  const s = raw.trim().replace(/^\$/, '');
  if (s === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s) && !/^\.\d{1,2}$/.test(s)) return 'invalid';
  const n = Number(s);
  return Number.isFinite(n) ? n : 'invalid';
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function validateRates(inputs: RateInputs): RateValidation {
  const parsed = {} as Record<RateKey, number | null>;
  for (const k of RATE_KEYS) {
    const v = parseRate(inputs[k]);
    if (v === 'invalid') {
      return { ok: false, message: `${RATE_LABELS[k]} rate must be a dollar amount like 3 or 3.50.` };
    }
    if (v !== null && v <= 0) {
      return { ok: false, message: `${RATE_LABELS[k]} rate must be more than $0. Leave it blank to skip it.` };
    }
    if (v !== null && v > MAX_RATE) {
      return { ok: false, message: `${RATE_LABELS[k]} rate can’t be more than $${MAX_RATE.toLocaleString()}.` };
    }
    parsed[k] = v;
  }
  const { hourly_rate, daily_rate, weekly_rate, monthly_rate } = parsed;
  if (hourly_rate === null && daily_rate === null && weekly_rate === null && monthly_rate === null) {
    return { ok: false, message: 'Set at least one rate so renters can book this spot.' };
  }
  const price_per_hour = round2(
    hourly_rate ??
      (daily_rate !== null ? daily_rate / 24 : null) ??
      (weekly_rate !== null ? weekly_rate / 168 : null) ??
      (monthly_rate as number) / 720,
  );
  // price_per_hour is what pricing (and the DB rule) fall back to when
  // hourly_rate is blank, so a short stay is billed from it. A tiny long-stay
  // rate (e.g. $3/month) would round it to $0 — a free booking.
  if (price_per_hour < 0.01) {
    return {
      ok: false,
      message: 'These rates work out to less than 1¢ an hour. Raise them, or set an hourly rate.',
    };
  }
  return {
    ok: true,
    update: { hourly_rate, daily_rate, weekly_rate, monthly_rate, price_per_hour },
  };
}

export function rateInputsFrom(l: Partial<Record<RateKey, number | null>>): RateInputs {
  const fmt = (v: number | null | undefined) => (v == null ? '' : Number(v).toFixed(2));
  return {
    hourly_rate: fmt(l.hourly_rate),
    daily_rate: fmt(l.daily_rate),
    weekly_rate: fmt(l.weekly_rate),
    monthly_rate: fmt(l.monthly_rate),
  };
}

const PAID = new Set(['confirmed', 'paid', 'completed']);
const LIVE_PAYOUT = new Set(['held', 'payout_ready', 'paid_out']);

/**
 * A booking that hasn't finished yet and falls (partly) outside the proposed
 * window. Existing reservations are never re-validated when the listing's window
 * changes (the reservation trigger only fires on the reservation's own columns),
 * so without this check a host could quietly "un-offer" a slot someone paid for.
 * Returns the earliest such booking, or null if the new window is safe.
 */
export function windowConflict(
  bookings: Booking[],
  from: Date | null,
  until: Date | null,
  now: number,
): Booking | null {
  const outside = bookings
    .filter(
      (b) =>
        b.status !== 'cancelled' &&
        PAID.has(b.status) &&
        LIVE_PAYOUT.has(b.payoutStatus) &&
        b.end.getTime() > now,
    )
    .filter(
      (b) =>
        (from !== null && b.start.getTime() < from.getTime()) ||
        (until !== null && b.end.getTime() > until.getTime()),
    )
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  return outside[0] ?? null;
}
