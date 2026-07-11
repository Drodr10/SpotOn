import { supabase } from "./supabase";
const API_IP = process.env.EXPO_PUBLIC_IP ? `https://${process.env.EXPO_PUBLIC_IP}/api` : "nulled";

export interface StripePaymentSheetParams {
    paymentIntent: string;
    customerSessionClientSecret: string;
    customer: string;
    holdId: string;
}

export interface BookingPaymentArgs {
    listing_id: string;
    renter_id: string;
    vehicle_id: string;
    start_time: string; // ISO 8601
    end_time: string;   // ISO 8601
}

/**
 * Result of attempting to start checkout.
 *  - ok:        hold acquired + PaymentIntent created; present the sheet.
 *  - unavailable: someone else is checking out / already booked this slot.
 *  - error:     anything else (network, pricing, server).
 */
export type BookingPaymentResult =
    | { status: 'ok'; params: StripePaymentSheetParams }
    | { status: 'unavailable'; message: string }
    | { status: 'error'; message: string };

const getKey = async () : Promise<string | null> => {
    const resp = await fetch(`${API_IP}/stripe/key`, {
        method: "GET",
        headers: { "ngrok-skip-browser-warning": "true" }
    });
    if (!resp.ok)
        return null;

    const data = await resp.json();
    return data.publishableKey;
}

/**
 * Hold-and-confirm checkout — call this only when the renter presses Reserve.
 * The backend acquires a short-lived slot hold and creates a platform-held
 * PaymentIntent. The reservation row itself is created by the webhook once
 * payment succeeds, so backing out of the sheet leaves nothing behind.
 * A `slot_unavailable` (409) means another renter is mid-checkout for the slot.
 */
const createBookingPayment = async (args: BookingPaymentArgs) : Promise<BookingPaymentResult> => {
    console.log(`Attempting to create booking payment @ ${API_IP}/stripe/create-booking-payment`)
    const { data: { session } } = await supabase.auth.getSession();

    let resp: Response;
    try {
        resp = await fetch(`${API_IP}/stripe/create-booking-payment`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "ngrok-skip-browser-warning": "true",
                "Authorization": `Bearer ${session?.access_token}`
            },
            body: JSON.stringify(args)
        });
    } catch (e: any) {
        return { status: 'error', message: e?.message ?? 'Network request failed' };
    }

    if (!resp.ok) {
        const body = await resp.json().catch(() => ({} as any));
        console.log(`Error creating booking payment (${resp.status}): ${JSON.stringify(body)}`);
        if (resp.status === 409 && body?.code === 'slot_unavailable') {
            return { status: 'unavailable', message: body?.error ?? 'This spot is being booked right now.' };
        }
        return { status: 'error', message: body?.error ?? `Request failed (${resp.status})` };
    }

    const { paymentIntent, customerSessionClientSecret, customer, holdId } = await resp.json();
    console.log("Created booking payment");
    return { status: 'ok', params: { paymentIntent, customerSessionClientSecret, customer, holdId } };
}

/**
 * Create the reservation immediately after the payment sheet reports success.
 * Idempotent with the webhook (whichever runs first wins). Pass the PaymentIntent
 * client secret; the id is derived from it. Returns true if the reservation now
 * exists. Best-effort — the webhook is the backstop if this call fails.
 */
const finalizeBooking = async (paymentIntentClientSecret: string): Promise<{ ok: boolean; message?: string }> => {
    const paymentIntentId = paymentIntentClientSecret.split('_secret')[0];
    const { data: { session } } = await supabase.auth.getSession();
    try {
        const resp = await fetch(`${API_IP}/stripe/finalize-booking`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "ngrok-skip-browser-warning": "true",
                "Authorization": `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({ payment_intent_id: paymentIntentId }),
        });
        if (!resp.ok) {
            const body = await resp.json().catch(() => ({} as any));
            const message = body?.error ?? `Request failed (${resp.status})`;
            console.log(`finalize-booking failed (${resp.status}): ${JSON.stringify(body)}`);
            return { ok: false, message };
        }
        return { ok: true };
    } catch (e: any) {
        console.log('finalize-booking network error', e);
        return { ok: false, message: e?.message ?? 'Network request failed' };
    }
}

/** Free a checkout hold immediately (renter dismissed the Stripe sheet). */
const releaseHold = async (holdId: string | null | undefined): Promise<void> => {
    if (!holdId) return;
    const { data: { session } } = await supabase.auth.getSession();
    try {
        await fetch(`${API_IP}/stripe/release-hold`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "ngrok-skip-browser-warning": "true",
                "Authorization": `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({ hold_id: holdId }),
        });
    } catch {
        // Best-effort; the sweep will expire it anyway.
    }
}

const fetchStripeAccountId = async (user_id: string): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession();

    console.log(`Attempting to create stripe account for user ${user_id}...`)

    const resp = await fetch(`${API_IP}/stripe/create-connect-account`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "true",
            "Authorization": `Bearer ${session?.access_token}`
        },

        body: JSON.stringify({ user_id })
    });

    if (!resp.ok) { 
        console.log("Error fetching stripe account ID for user " + user_id);
        return null;
    }

    const { account_id } = await resp.json();
    const { error } = await supabase.from("profiles").update({ stripe_account_id: account_id}).eq("id", user_id);

    if (error) {
        console.log("Error saving stripe account ID for user " + user_id);
        return null;
    }
    console.log("Successfully saved Stripe account ID for user " + user_id)

    return account_id;
}

const fetchStripeAccountLink = async (user_id: string): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession();

    const resp = await fetch(`${API_IP}/stripe/create-account-link`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "true",
            "Authorization": `Bearer ${session?.access_token}`
        },
        
        body: JSON.stringify({ user_id })
    });

    if (!resp.ok) {
        console.log("Error fetching stripe account link for user " + user_id);
        return null;
    }

    const { account_link_url } = await resp.json();
    return account_link_url;
}

//checks if user has an existing stripe connect account.
const userHasStripeAccount = async (userId: string): Promise<boolean> => {
  const { data, error } = await supabase.from('profiles').select('stripe_account_id').eq('id', userId).single();

  if (error) {
    console.error('Error checking for Stripe account:', error.message);
    return false;
  }

  return !!data?.stripe_account_id;
};

export const stripe = { getKey, createBookingPayment, finalizeBooking, releaseHold, fetchStripeAccountId, fetchStripeAccountLink, userHasStripeAccount }
