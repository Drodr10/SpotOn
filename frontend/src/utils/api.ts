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
        });
    }
    return results;
};

export const api = { reserveSpot, getActiveReservation, getActiveReservations, getReservations };
