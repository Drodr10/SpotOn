import { supabase } from "./supabase"
const API_IP = process.env.EXPO_PUBLIC_IP ?? "nulled";

/**
 * Create a reservation via the Flask backend (needs server-side price verification
 * and the RPC that creates the associated conversation).
 */
const reserveSpot = async (
    listing_id: string,
    price: number,
    renter_id: string,
    start_time: number,
    end_time: number,
) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const body = {
        listing_id,
        renter_id,
        start_time: new Date(start_time).toISOString(),
        end_time: new Date(end_time).toISOString(),
        total_price: price,
    };
    const resp = await fetch(`https://${API_IP}/api/reservations`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
            "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const err = await resp.text().catch(() => '');
        console.warn('[reserveSpot] backend error', resp.status, err);
    }
};

/**
 * Fetch the user's active (not-yet-expired) reservation directly from Supabase,
 * using the authenticated session so the RLS policy resolves auth.uid() correctly.
 */
const getActiveReservation = async (userId: string) => {
    const { data, error } = await supabase
        .from('reservations')
        .select('*')
        .eq('renter_id', userId)
        .order('end_time', { ascending: false });

    if (error || !data) {
        console.warn('[getActiveReservation] query error', error);
        return null;
    }

    const now = new Date();
    for (const reservation of data) {
        const endTime = new Date(reservation.end_time);
        if (now < endTime) {
            const { data: listingData, error: listingError } = await supabase
                .from('listings')
                .select('*')
                .eq('id', reservation.listing_id)
                .single();

            if (listingError) {
                console.warn('[getActiveReservation] listing fetch error', listingError);
                // Return with minimal data so the timer still works even if listing is inactive.
                return { listingData: null, endTime };
            }
            return { listingData, endTime };
        }
    }
    return null;
};

/**
 * Fetch all reservations for the user directly from Supabase.
 * Uses the authenticated session so RLS passes.
 */
const getReservations = async (userId: string) => {
    const { data, error } = await supabase
        .from('reservations')
        .select('*')
        .eq('renter_id', userId)
        .order('created_at', { ascending: false });

    if (error || !data) {
        console.warn('[getReservations] query error', error);
        return null;
    }

    const results = [];
    for (const reservation of data) {
        const { data: listingData, error: listingError } = await supabase
            .from('listings')
            .select('*')
            .eq('id', reservation.listing_id)
            .single();

        if (listingError || !listingData) {
            // Listing may be inactive/deleted — skip rather than aborting the whole list.
            continue;
        }
        results.push({ listingData, end_time: new Date(reservation.end_time) });
    }
    return results;
};

export const api = { reserveSpot, getActiveReservation, getReservations };
