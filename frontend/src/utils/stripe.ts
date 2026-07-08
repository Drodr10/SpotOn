import { supabase } from "./supabase";
const API_IP = process.env.EXPO_PUBLIC_IP ? `https://${process.env.EXPO_PUBLIC_IP}/api` : "nulled";

export interface StripePaymentSheetParams {
    paymentIntent: string;
    customerSessionClientSecret: string;
    customer: string;
    reservationId: string;
}

export interface BookingPaymentArgs {
    listing_id: string;
    renter_id: string;
    vehicle_id: string;
    start_time: string; // ISO 8601
    end_time: string;   // ISO 8601
}

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
 * Atomically reserve the slot and start a platform-held payment. The backend
 * creates the reservation (pending_payment) before returning the sheet, so a
 * charge can never exist without a reservation. Funds are held on SpotOn's
 * balance and transferred to the seller after the session ends + onboarding.
 */
const createBookingPayment = async (args: BookingPaymentArgs) : Promise <StripePaymentSheetParams | null> => {
    console.log(`Attempting to create booking payment @ ${API_IP}/stripe/create-booking-payment`)
    const { data: { session } } = await supabase.auth.getSession();

    const resp = await fetch(`${API_IP}/stripe/create-booking-payment`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "true",
            "Authorization": `Bearer ${session?.access_token}`
        },
        body: JSON.stringify(args)
    })

    if (!resp.ok) {
        const detail = await resp.text().catch(() => '');
        console.log(`Error creating booking payment (${resp.status}): ${detail}`);
        return null;
    }

    const { paymentIntent, customerSessionClientSecret, customer, reservationId } = await resp.json();
    console.log("Created booking payment");

    return { paymentIntent, customerSessionClientSecret, customer, reservationId };
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

export const stripe = { getKey, createBookingPayment, fetchStripeAccountId, fetchStripeAccountLink, userHasStripeAccount }
