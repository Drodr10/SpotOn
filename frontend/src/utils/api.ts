import { supabase } from "./supabase"

const API_IP = process.env.EXPO_PUBLIC_IP ?? "nulled";

export type ListingForCard = {
    id: string;
    owner_id: string;
    address: string;
    price_per_hour: number | null;
    photo_url: string;
    hourly_rate?: number | null;
    daily_rate?: number | null;
    weekly_rate?: number | null;
    monthly_rate?: number | null;
};

export type ActiveReservation = {
    id: string;
    listingData: ListingForCard;
    end_time: Date;
    start_time: Date;
    total_price: number | null;
    status: string | null;
    listingUnavailable: boolean;
    vehicleSummary?: {
        make: string;
        model: string;
        color: string;
        licensePlate?: string;
    } | null;
};

const PLACEHOLDER_LISTING = (listingId: string): ListingForCard => ({
    id: listingId,
    owner_id: '',
    address: 'Listing unavailable',
    price_per_hour: null,
    photo_url: '',
});

/**
 * Create a reservation directly in Supabase. RLS policy
 * `reservations_renter_insert` enforces auth.uid() === renter_id, so the
 * authenticated session must be active. Returns the inserted row or throws.
 */
const reserveSpot = async (
    listing_id: string,
    price: number,
    renter_id: string,
    vehicle_id: string,
    start_time: number,
    end_time: number,
) => {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
        throw new Error(`reserveSpot: no active session (${sessionError?.message ?? 'session null'})`);
    }
    if (session.user.id !== renter_id) {
        throw new Error(`reserveSpot: renter_id ${renter_id} does not match session user ${session.user.id}`);
    }

    const payload = {
        listing_id,
        renter_id,
        vehicle_id,
        start_time: new Date(start_time).toISOString(),
        end_time:   new Date(end_time).toISOString(),
        total_price: price,
    };

    const { data, error } = await supabase
        .from('reservations')
        .insert(payload)
        .select()
        .single();

    if (error || !data) {
        console.error('[reserveSpot] insert failed', error, payload);
        throw new Error(`reserveSpot insert failed: ${error?.message ?? 'unknown error'}`);
    }

    // Fire-and-forget the Flask side effect (conversation RPC, server hooks).
    // Failures here must not block the reservation from showing on the homepage.
    if (API_IP !== 'nulled') {
        fetch(`https://${API_IP}/api/reservations/post-insert`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
                'ngrok-skip-browser-warning': 'true',
            },
            body: JSON.stringify({ reservation_id: data.id }),
        }).catch((err) => console.warn('[reserveSpot] post-insert hook failed', err));
    }

    return data;
};

const fetchListingForReservation = async (listing_id: string): Promise<{ listing: ListingForCard; unavailable: boolean }> => {
    const { data, error } = await supabase
        .from('listings')
        .select('id, owner_id, address, price_per_hour, photo_url, hourly_rate, daily_rate, weekly_rate, monthly_rate, is_active')
        .eq('id', listing_id)
        .maybeSingle();

    if (error || !data) {
        return { listing: PLACEHOLDER_LISTING(listing_id), unavailable: true };
    }
    return { listing: data as ListingForCard, unavailable: false };
};

/**
 * Fetch all not-yet-expired reservations for the user. Soonest-ending first.
 * Listings that have been deleted/deactivated are surfaced with placeholder
 * data so the user still sees their active reservation.
 */
const getActiveReservations = async (userId: string): Promise<ActiveReservation[] | null> => {
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('reservations')
        .select('id, listing_id, start_time, end_time, total_price, status')
        .eq('renter_id', userId)
        .gt('end_time', now)
        .order('end_time', { ascending: true });

    if (error) {
        console.warn('[getActiveReservations] query error', error);
        return null;
    }
    if (!data || data.length === 0) return [];

    const results: ActiveReservation[] = [];
    for (const r of data) {
        const { listing, unavailable } = await fetchListingForReservation(r.listing_id);
        results.push({
            id:                  r.id,
            listingData:         listing,
            start_time:          new Date(r.start_time),
            end_time:            new Date(r.end_time),
            total_price:         r.total_price as number | null,
            status:              r.status as string | null,
            listingUnavailable:  unavailable,
            vehicleSummary:      null,
        });
    }
    return results;
};

/**
 * Backwards-compatible single-active-reservation helper. Returns the
 * soonest-ending active reservation, or null if there is none.
 */
const getActiveReservation = async (userId: string) => {
    const list = await getActiveReservations(userId);
    if (!list || list.length === 0) return null;
    const first = list[0];
    return { listingData: first.listingData, endTime: first.end_time };
};

const hydrateReservationRows = async (rows: {
    id: string;
    listing_id: string;
    start_time: string;
    end_time: string;
    total_price: number | null;
    status: string | null;
}[]): Promise<ActiveReservation[]> => {
    const results: ActiveReservation[] = [];
    for (const r of rows) {
        const { listing, unavailable } = await fetchListingForReservation(r.listing_id);
        results.push({
            id:                  r.id,
            listingData:         listing,
            start_time:          new Date(r.start_time),
            end_time:            new Date(r.end_time),
            total_price:         r.total_price,
            status:              r.status,
            listingUnavailable:  unavailable,
            vehicleSummary:      null,
        });
    }
    return results;
};

/**
 * Reservations that have started but not yet ended (start_time <= now < end_time).
 * Soonest-ending first. Drives the MenuBar countdown timer — unlike
 * `getActiveReservations`, this excludes reservations that haven't started yet.
 */
const getInProgressReservations = async (userId: string): Promise<ActiveReservation[] | null> => {
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('reservations')
        .select('id, listing_id, start_time, end_time, total_price, status')
        .eq('renter_id', userId)
        .lte('start_time', now)
        .gt('end_time', now)
        .order('end_time', { ascending: true });

    if (error) {
        console.warn('[getInProgressReservations] query error', error);
        return null;
    }
    if (!data || data.length === 0) return [];
    return hydrateReservationRows(data);
};

/**
 * Soonest-ending in-progress reservation, or null if none. Use this (not
 * `getActiveReservation`) anywhere that should only reflect a reservation
 * that has actually started.
 */
const getInProgressReservation = async (userId: string) => {
    const list = await getInProgressReservations(userId);
    if (!list || list.length === 0) return null;
    const first = list[0];
    return { listingData: first.listingData, endTime: first.end_time };
};

/**
 * Reservations that have not started yet (start_time > now). Soonest-starting
 * first. Drives the Homescreen "reservation in ..." banner.
 */
const getUpcomingReservations = async (userId: string): Promise<ActiveReservation[] | null> => {
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('reservations')
        .select('id, listing_id, start_time, end_time, total_price, status')
        .eq('renter_id', userId)
        .gt('start_time', now)
        .order('start_time', { ascending: true });

    if (error) {
        console.warn('[getUpcomingReservations] query error', error);
        return null;
    }
    if (!data || data.length === 0) return [];
    return hydrateReservationRows(data);
};

/** Soonest-starting upcoming reservation, or null if none. */
const getUpcomingReservation = async (userId: string): Promise<ActiveReservation | null> => {
    const list = await getUpcomingReservations(userId);
    if (!list || list.length === 0) return null;
    return list[0];
};

/**
 * Full reservation history for the user (active + past), newest first.
 */
const getReservations = async (userId: string): Promise<ActiveReservation[] | null> => {
    const { data, error } = await supabase
        .from('reservations')
        .select('id, listing_id, start_time, end_time, total_price, status')
        .eq('renter_id', userId)
        .order('created_at', { ascending: false });

    if (error) {
        console.warn('[getReservations] query error', error);
        return null;
    }
    if (!data) return [];

    const results: ActiveReservation[] = [];
    for (const r of data) {
        const { listing, unavailable } = await fetchListingForReservation(r.listing_id);
        results.push({
            id:                 r.id,
            listingData:        listing,
            start_time:         new Date(r.start_time),
            end_time:           new Date(r.end_time),
            total_price:        r.total_price as number | null,
            status:             r.status as string | null,
            listingUnavailable: unavailable,
            vehicleSummary:     null,
        });
    }
    return results;
};

const getOwnerActiveBookings = async (ownerId: string): Promise<ActiveReservation[] | null> => {
    const { data: ownerListings, error: listingError } = await supabase
        .from('listings')
        .select('id')
        .eq('owner_id', ownerId)
        .eq('is_active', true);

    if (listingError) {
        console.warn('[getOwnerActiveBookings] listings query error', listingError);
        return null;
    }

    const listingIds = (ownerListings ?? []).map((l: { id: string }) => l.id);
    if (listingIds.length === 0) return [];

    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('reservations')
        .select('id, listing_id, start_time, end_time, total_price, status')
        .in('listing_id', listingIds)
        .lte('start_time', now)
        .gt('end_time', now)
        .order('end_time', { ascending: true });

    if (error) {
        console.warn('[getOwnerActiveBookings] reservations query error', error);
        return null;
    }
    if (!data || data.length === 0) return [];

    const results: ActiveReservation[] = [];
    for (const r of data) {
        const { listing, unavailable } = await fetchListingForReservation(r.listing_id);

        let vehicleSummary: ActiveReservation['vehicleSummary'] = null;
        try {
            const vehicleResp = await supabase.rpc('get_active_booking_vehicle_for_listing_owner', {
                p_reservation_id: r.id,
            });
            const row = vehicleResp.data?.[0];
            if (row) {
                vehicleSummary = {
                    make: row.make,
                    model: row.model,
                    color: row.color,
                    licensePlate: row.license_plate,
                };
            }
        } catch (vehicleError) {
            console.warn('[getOwnerActiveBookings] vehicle RPC error', vehicleError);
        }

        results.push({
            id:                 r.id,
            listingData:        listing,
            start_time:         new Date(r.start_time),
            end_time:           new Date(r.end_time),
            total_price:        r.total_price as number | null,
            status:             r.status as string | null,
            listingUnavailable: unavailable,
            vehicleSummary,
        });
    }

    return results;
};

/**
 * Total money a seller has earned but not yet been paid (funds held on the
 * platform balance), summed from reservations in 'held' or 'payout_ready'.
 * Drives the "You have $X waiting — set up payouts" home-screen banner.
 */
const getPendingPayout = async (ownerId: string): Promise<{ total: number; count: number }> => {
    const { data: ownerListings, error: listingError } = await supabase
        .from('listings')
        .select('id')
        .eq('owner_id', ownerId);

    if (listingError) {
        console.warn('[getPendingPayout] listings query error', listingError);
        return { total: 0, count: 0 };
    }
    const listingIds = (ownerListings ?? []).map((l: { id: string }) => l.id);
    if (listingIds.length === 0) return { total: 0, count: 0 };

    const { data, error } = await supabase
        .from('reservations')
        .select('host_payout, payout_status')
        .in('listing_id', listingIds)
        .in('payout_status', ['held', 'payout_ready']);

    if (error || !data) {
        console.warn('[getPendingPayout] reservations query error', error);
        return { total: 0, count: 0 };
    }
    const total = data.reduce((sum: number, r: { host_payout: number | null }) => sum + Number(r.host_payout ?? 0), 0);
    return { total, count: data.length };
};

export type AccountDeletionResult =
    | { status: 'deleted' }
    | { status: 'blocked'; reasons: string[] }
    | { status: 'error'; message: string };

/**
 * Delete the signed-in user's account (App Store Guideline 5.1.1(v)).
 *
 * The user id comes from the session rather than an argument: the backend
 * rejects a mismatch with 403 anyway, and a caller-supplied id is one more way
 * to get it wrong on the one screen where being wrong is unrecoverable.
 *
 * Every non-200 is reported. `reserveSpot` above skips its server hook when the
 * API is unreachable, which is harmless for a fire-and-forget side effect; doing
 * that here would sign the user out and report success while the account still
 * existed, so an unreachable API is an error, never a quiet no-op.
 */
const deleteAccount = async (): Promise<AccountDeletionResult> => {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
        return { status: 'error', message: 'You appear to be signed out. Please sign in and try again.' };
    }

    // Read the host here rather than using the module-level API_IP, so the
    // check and the URL can never disagree. Truthiness, not ??: an empty
    // EXPO_PUBLIC_IP is unset for our purposes.
    const host = process.env.EXPO_PUBLIC_IP;
    if (!host) {
        return { status: 'error', message: "Can't reach the server right now. Please try again later." };
    }

    let resp: Response;
    try {
        resp = await fetch(`https://${host}/api/profiles/${session.user.id}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
                'ngrok-skip-browser-warning': 'true',
            },
        });
    } catch (err: any) {
        return { status: 'error', message: err?.message ?? 'Network request failed.' };
    }

    if (resp.status === 200) return { status: 'deleted' };

    const body = await resp.json().catch(() => ({} as any));

    // 409 is an outcome, not a failure: the request was valid, the account just
    // is not deletable yet, and the reasons tell the user what to do about it.
    if (resp.status === 409 && Array.isArray(body?.reasons) && body.reasons.length) {
        return { status: 'blocked', reasons: body.reasons };
    }

    return { status: 'error', message: body?.error ?? `Request failed (${resp.status}).` };
};

export const api = {
    reserveSpot,
    getActiveReservation,
    getActiveReservations,
    getInProgressReservation,
    getInProgressReservations,
    getUpcomingReservation,
    getUpcomingReservations,
    getReservations,
    getOwnerActiveBookings,
    getPendingPayout,
    deleteAccount,
};
