/**
 * Activity — shared data + formatting for the renter "Activity" page, the host
 * "Seller Account" page and the "Activity Details" screen.
 *
 * Everything here is derived from real rows (`reservations`, `listings`,
 * `vehicles`). Nothing is estimated except the rate-tier label (see
 * `inferRateLabel`), which the reservation row does not store.
 *
 * Reservation lifecycle used throughout (see backend/services/payouts.py):
 *   status         pending -> confirmed (paid) -> completed | cancelled
 *   payout_status  pending_payment -> held -> payout_ready -> paid_out
 *                  held -> refunding -> refunded   (renter cancelled)
 *                  pending_payment -> cancelled    (abandoned checkout)
 */

import { Linking, Platform } from 'react-native';

import { supabase } from './supabase';
import { findOrCreateConversation } from './conversations';

// ─── Types ───────────────────────────────────────────────────────────────────

export type BookingRole = 'renter' | 'host';

/** active = in progress now, scheduled = not started, past = finished. */
export type BookingPhase = 'active' | 'scheduled' | 'past' | 'cancelled' | 'hidden';

export type BookingListing = {
  id: string;
  owner_id: string;
  address: string;
  photo_url: string | null;
  latitude: number | null;
  longitude: number | null;
  price_per_hour: number | null;
  hourly_rate: number | null;
  daily_rate: number | null;
  weekly_rate: number | null;
  monthly_rate: number | null;
  is_active: boolean | null;
  created_at: string | null;
};

export type Booking = {
  id: string;
  listingId: string;
  renterId: string;
  start: Date;
  end: Date;
  /** What the renter paid (subtotal + service fee). */
  totalPrice: number;
  /** SpotOn's service fee (paid by the renter on top of the host rate). */
  platformFee: number;
  /** What the host receives. */
  hostPayout: number;
  status: string;
  payoutStatus: string;
  vehicleId: string | null;
  /** null when the listing is deactivated/removed and no longer readable. */
  listing: BookingListing | null;
};

export type VehicleSummary = {
  make: string;
  model: string;
  color: string;
  licensePlate?: string | null;
};

// ─── Constants ───────────────────────────────────────────────────────────────

/** Mirrors backend CANCELLATION_WINDOW_HOURS_DEFAULT (payouts.py). The server stays the source of truth. */
export const CANCELLATION_WINDOW_HOURS = 24;

/**
 * Today an owner cannot SELECT their own deactivated listings (the only SELECT
 * policy on `listings` is `is_active = true`), and `reservations_parties_select`
 * resolves the owner through that same table. So deactivating a listing hides
 * its whole booking history from its owner. While this is false we only allow
 * removing listings that have never been booked. Flip to true once an owner
 * SELECT policy exists (see report) to relax that to "no upcoming bookings".
 */
export const OWNER_CAN_READ_INACTIVE_LISTINGS = false;

const BOOKING_COLUMNS =
  'id, listing_id, renter_id, start_time, end_time, total_price, platform_fee, host_payout, status, payout_status, vehicle_id';
const LISTING_COLUMNS =
  'id, owner_id, address, photo_url, latitude, longitude, price_per_hour, hourly_rate, daily_rate, weekly_rate, monthly_rate, is_active, created_at';

const PAID_STATUSES = new Set(['confirmed', 'paid', 'completed']);
const LIVE_PAYOUT_STATUSES = new Set(['held', 'payout_ready', 'paid_out']);

// ─── Row mapping ─────────────────────────────────────────────────────────────

type BookingRow = {
  id: string;
  listing_id: string;
  renter_id: string;
  start_time: string;
  end_time: string;
  total_price: number | string | null;
  platform_fee: number | string | null;
  host_payout: number | string | null;
  status: string | null;
  payout_status: string | null;
  vehicle_id: string | null;
};

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

function toBooking(row: BookingRow, listing: BookingListing | null): Booking {
  return {
    id: row.id,
    listingId: row.listing_id,
    renterId: row.renter_id,
    start: new Date(row.start_time),
    end: new Date(row.end_time),
    totalPrice: num(row.total_price),
    platformFee: num(row.platform_fee),
    hostPayout: num(row.host_payout),
    status: row.status ?? 'pending',
    payoutStatus: row.payout_status ?? 'pending_payment',
    vehicleId: row.vehicle_id,
    listing,
  };
}

async function loadListings(ids: string[]): Promise<Map<string, BookingListing>> {
  const map = new Map<string, BookingListing>();
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return map;
  const { data, error } = await supabase.from('listings').select(LISTING_COLUMNS).in('id', unique);
  if (error) throw new Error(error.message);
  for (const l of (data ?? []) as BookingListing[]) map.set(l.id, l);
  return map;
}

export async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ?? null;
}

// ─── Fetchers ────────────────────────────────────────────────────────────────

/** Every reservation the user made as a renter (raw — filter with `bookingPhase`). */
export async function fetchRenterBookings(userId: string): Promise<Booking[]> {
  const { data, error } = await supabase
    .from('reservations')
    .select(BOOKING_COLUMNS)
    .eq('renter_id', userId)
    .order('start_time', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as BookingRow[];
  const listings = await loadListings(rows.map((r) => r.listing_id));
  return rows.map((r) => toBooking(r, listings.get(r.listing_id) ?? null));
}

export type HostDashboard = {
  /** The host's active listings, newest first. */
  listings: BookingListing[];
  /** All reservations on those listings (raw — includes unpaid/cancelled rows, used for gating). */
  bookings: Booking[];
};

export async function fetchHostDashboard(ownerId: string): Promise<HostDashboard> {
  const { data: listingRows, error } = await supabase
    .from('listings')
    .select(LISTING_COLUMNS)
    .eq('owner_id', ownerId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const listings = (listingRows ?? []) as BookingListing[];
  if (listings.length === 0) return { listings, bookings: [] };

  const byId = new Map(listings.map((l) => [l.id, l]));
  const { data: resRows, error: resError } = await supabase
    .from('reservations')
    .select(BOOKING_COLUMNS)
    .in('listing_id', listings.map((l) => l.id))
    .order('start_time', { ascending: false });
  if (resError) throw new Error(resError.message);

  const bookings = ((resRows ?? []) as BookingRow[]).map((r) =>
    toBooking(r, byId.get(r.listing_id) ?? null),
  );
  return { listings, bookings };
}

/** One reservation by id (RLS limits this to its renter or the listing's owner). */
export async function fetchBookingById(id: string): Promise<Booking | null> {
  const { data, error } = await supabase
    .from('reservations')
    .select(BOOKING_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as BookingRow;
  const listings = await loadListings([row.listing_id]);
  return toBooking(row, listings.get(row.listing_id) ?? null);
}

/**
 * Vehicle that was used for a booking. Renters read their own vehicle row;
 * hosts only get it through the owner RPC, which the database restricts to the
 * booking's live window — so for hosts this is null outside it.
 */
export async function fetchBookingVehicle(
  booking: Booking,
  role: BookingRole,
): Promise<VehicleSummary | null> {
  try {
    if (role === 'renter') {
      if (!booking.vehicleId) return null;
      const { data } = await supabase
        .from('vehicles')
        .select('make, model, color, license_plate')
        .eq('id', booking.vehicleId)
        .maybeSingle();
      if (!data) return null;
      return {
        make: data.make,
        model: data.model,
        color: data.color,
        licensePlate: data.license_plate,
      };
    }
    const { data } = await supabase.rpc('get_active_booking_vehicle_for_listing_owner', {
      p_reservation_id: booking.id,
    });
    const row = data?.[0];
    if (!row) return null;
    return { make: row.make, model: row.model, color: row.color, licensePlate: row.license_plate };
  } catch (err) {
    console.warn('[activity] vehicle lookup failed', err);
    return null;
  }
}

export async function fetchPayoutsEnabled(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('profiles')
    .select('payouts_enabled')
    .eq('id', userId)
    .maybeSingle();
  return !!data?.payouts_enabled;
}

// ─── Phases / grouping ───────────────────────────────────────────────────────

export function bookingPhase(
  b: Pick<Booking, 'status' | 'payoutStatus' | 'start' | 'end'>,
  now: number,
): BookingPhase {
  if (b.status === 'cancelled') {
    // A refunded booking is a real cancellation; payout_status 'cancelled' is an abandoned checkout.
    return b.payoutStatus === 'refunded' || b.payoutStatus === 'refunding' ? 'cancelled' : 'hidden';
  }
  if (!PAID_STATUSES.has(b.status) || b.payoutStatus === 'pending_payment') return 'hidden';
  if (b.end.getTime() <= now) return 'past';
  if (b.start.getTime() <= now) return 'active';
  return 'scheduled';
}

export type GroupedBookings = {
  active: Booking[];
  scheduled: Booking[];
  /** Finished + cancelled, most recent first. */
  past: Booking[];
};

export function groupBookings(bookings: Booking[], now: number): GroupedBookings {
  const active: Booking[] = [];
  const scheduled: Booking[] = [];
  const past: Booking[] = [];
  for (const b of bookings) {
    const phase = bookingPhase(b, now);
    if (phase === 'active') active.push(b);
    else if (phase === 'scheduled') scheduled.push(b);
    else if (phase === 'past' || phase === 'cancelled') past.push(b);
  }
  active.sort((a, b) => a.end.getTime() - b.end.getTime());
  scheduled.sort((a, b) => a.start.getTime() - b.start.getTime());
  past.sort((a, b) => b.end.getTime() - a.end.getTime());
  return { active, scheduled, past };
}

export function canCancelBooking(b: Booking, role: BookingRole, now: number): boolean {
  if (role !== 'renter') return false;
  if (!PAID_STATUSES.has(b.status) || b.payoutStatus !== 'held') return false;
  return b.start.getTime() - now >= CANCELLATION_WINDOW_HOURS * 3_600_000;
}

// ─── Host earnings ───────────────────────────────────────────────────────────

export type MonthlyEarning = { key: string; label: string; amount: number };

export type Earnings = {
  /** host_payout not yet transferred (payout_status held | payout_ready). */
  remaining: number;
  /** host_payout earned from finished bookings (paid out, or ended and awaiting transfer). */
  lifetime: number;
  /** The two most recent months with earnings, oldest first. */
  months: MonthlyEarning[];
};

export function computeEarnings(bookings: Booking[], now: number): Earnings {
  let remainingCents = 0;
  let lifetimeCents = 0;
  const monthCents = new Map<string, { label: string; cents: number }>();

  for (const b of bookings) {
    const phase = bookingPhase(b, now);
    if (phase === 'hidden' || phase === 'cancelled') continue;
    const cents = Math.round(b.hostPayout * 100);
    const awaiting = b.payoutStatus === 'held' || b.payoutStatus === 'payout_ready';
    if (awaiting) remainingCents += cents;

    const earned = b.payoutStatus === 'paid_out' || (awaiting && b.end.getTime() <= now);
    if (!earned) continue;
    lifetimeCents += cents;
    const key = `${b.end.getFullYear()}-${String(b.end.getMonth() + 1).padStart(2, '0')}`;
    const prev = monthCents.get(key);
    monthCents.set(key, {
      label: b.end.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      cents: (prev?.cents ?? 0) + cents,
    });
  }

  const months = Array.from(monthCents.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(-2)
    .map(([key, v]) => ({ key, label: v.label, amount: v.cents / 100 }));

  return { remaining: remainingCents / 100, lifetime: lifetimeCents / 100, months };
}

// ─── Listing removal ─────────────────────────────────────────────────────────

/** Returns a user-facing reason the listing can't be removed right now, or null if it can. */
export function listingRemovalBlock(
  listingId: string,
  bookings: Booking[],
  now: number,
): string | null {
  const mine = bookings.filter((b) => b.listingId === listingId && b.status !== 'cancelled');
  if (mine.some((b) => b.payoutStatus === 'pending_payment' && b.status === 'pending')) {
    return 'A renter is in the middle of booking this spot. Try again in a few minutes.';
  }
  const live = mine.filter(
    (b) => PAID_STATUSES.has(b.status) && LIVE_PAYOUT_STATUSES.has(b.payoutStatus),
  );
  const upcoming = live.filter((b) => b.end.getTime() > now);
  if (upcoming.length > 0) {
    return upcoming.length === 1
      ? 'This spot has a booking that has not finished yet. You can remove it once that is over.'
      : `This spot has ${upcoming.length} bookings that have not finished yet. You can remove it once they are over.`;
  }
  if (!OWNER_CAN_READ_INACTIVE_LISTINGS && live.length > 0) {
    return 'This spot has booking history. Removing it would hide those bookings and their earnings from your account, so it stays for now.';
  }
  return null;
}

/** Fresh check used right before deactivating, so a stale screen can't remove a booked spot. */
export async function fetchListingBookings(listingId: string): Promise<Booking[]> {
  const { data, error } = await supabase
    .from('reservations')
    .select(BOOKING_COLUMNS)
    .eq('listing_id', listingId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as BookingRow[]).map((r) => toBooking(r, null));
}

/**
 * Soft-removes a listing (is_active = false) through the existing RLS policy
 * `listings_owner_update`. Returns false if no row changed (RLS denial).
 */
export async function deactivateListing(listingId: string, ownerId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('listings')
    .update({ is_active: false })
    .eq('id', listingId)
    .eq('owner_id', ownerId)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

// ─── Messaging ───────────────────────────────────────────────────────────────

/** Find-or-create the renter/host conversation for a booking. */
export async function getChatTarget(
  booking: Booking,
  role: BookingRole,
): Promise<{ conversationId: string; otherUserName: string }> {
  const ownerId = booking.listing?.owner_id;
  if (!ownerId) throw new Error('This listing is no longer available to message about.');
  const convo = await findOrCreateConversation(booking.renterId, ownerId);
  if (role === 'renter') {
    return { conversationId: convo.conversationId, otherUserName: convo.ownerName };
  }
  const { data } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', booking.renterId)
    .maybeSingle();
  return {
    conversationId: convo.conversationId,
    otherUserName: (data?.full_name as string | null) || 'Renter',
  };
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export const money = (n: number) => `$${n.toFixed(2)}`;

export function bookingAddress(b: Booking): string {
  return b.listing?.address ?? 'Listing unavailable';
}

function fmtDay(d: Date): string {
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "Jul 30 • 10:22 AM - 4:22 PM" (or both dates when it spans days). */
export function formatBookingRange(start: Date, end: Date): string {
  if (start.toDateString() === end.toDateString()) {
    return `${fmtDay(start)} • ${fmtTime(start)} - ${fmtTime(end)}`;
  }
  return `${fmtDay(start)}, ${fmtTime(start)} - ${fmtDay(end)}, ${fmtTime(end)}`;
}

/**
 * Countdown label: "2hr 31 min" (renter) or "2hr 31 min 42 sec" (host, seconds
 * always on unless days remain). Under an hour both show seconds.
 */
export function formatCountdown(ms: number, withSeconds: boolean): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}hr` : `${d}d`;
  if (h > 0) return withSeconds ? `${h}hr ${m} min ${s} sec` : `${h}hr ${m} min`;
  return `${m} min ${s} sec`;
}

export function formatStartsIn(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return h > 0 ? `in ${d}d ${h}hr` : `in ${d}d`;
  if (h > 0) return `in ${h}hr ${m} min`;
  return `in ${Math.max(1, m)} min`;
}

export function formatVehicle(v: VehicleSummary, withPlate: boolean): string {
  const base = `${v.make} ${v.model} ${v.color}`.replace(/\s+/g, ' ').trim();
  return withPlate && v.licensePlate ? `${base} • ${v.licensePlate}` : base;
}

/** Service fee as a whole-number percent of the host rate, from stored amounts. */
export function feePercent(b: Booking): number | null {
  if (b.hostPayout <= 0 || b.platformFee <= 0) return null;
  return Math.round((b.platformFee / b.hostPayout) * 100);
}

/**
 * The reservation row doesn't store which rate tier was billed, so this mirrors
 * the server's selection (backend/utils/pricing.py) from the stay length and the
 * fee percent (15% = hourly/daily, 7% = weekly/monthly) — the fee is stored, so
 * it disambiguates short vs long stays even if listing rates changed later.
 */
export function inferRateLabel(b: Booking): string {
  const hours = (b.end.getTime() - b.start.getTime()) / 3_600_000;
  const days = hours / 24;
  const pct = feePercent(b);
  const l = b.listing;
  const longStay = pct != null ? pct <= 10 : days >= 7;
  if (longStay) {
    return days / 7 >= 4 && (l?.monthly_rate != null || l == null) ? 'Monthly' : 'Weekly';
  }
  const hourly = l?.hourly_rate ?? l?.price_per_hour ?? null;
  if (hourly == null && l?.daily_rate != null) return 'Daily';
  if (days >= 1 && l?.daily_rate != null && hourly != null && hourly * 24 >= l.daily_rate) {
    return 'Daily';
  }
  return days >= 1 && hourly == null ? 'Daily' : 'Hourly';
}

// ─── Linking helpers ─────────────────────────────────────────────────────────

export function openInMaps(address: string) {
  const encoded = encodeURIComponent(address);
  const url = Platform.select({
    ios: `maps://maps.apple.com/?q=${encoded}`,
    android: `geo:0,0?q=${encoded}`,
    default: `https://www.google.com/maps/search/?api=1&query=${encoded}`,
  })!;
  Linking.openURL(url).catch(() => {});
}

/** Same support email + body the previous reservations page used. */
export function openIssueEmail(b: Booking) {
  const subject = `Issue with reservation ${b.id}`;
  const body =
    `Reservation ID: ${b.id}\n` +
    `Address: ${bookingAddress(b)}\n` +
    `Start: ${b.start.toLocaleString()}\n` +
    `End: ${b.end.toLocaleString()}\n\n` +
    `Describe what went wrong:\n`;
  const url =
    `mailto:team.spotonapp@gmail.com` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;
  Linking.openURL(url).catch(() => {});
}
