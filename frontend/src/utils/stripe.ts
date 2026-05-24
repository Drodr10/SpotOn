import { supabase } from "./supabase";
const API_IP = process.env.EXPO_PUBLIC_IP ? `https://${process.env.EXPO_PUBLIC_IP}/api` : "nulled";

export interface StripePaymentSheetParams {
    paymentIntent: string;
    customerSessionClientSecret: string;
    customer: string;
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

const fetchPaymentSheetParams = async (price: number, lister_id: string) : Promise <StripePaymentSheetParams | null>=> {
    console.log(`Attempting to fetch payment sheet @ ${API_IP}/stripe/payment-sheet`)
    const { data: { session } } = await supabase.auth.getSession();

    const resp = await fetch(`${API_IP}/stripe/payment-sheet`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "true",
            "Authorization": `Bearer ${session?.access_token}`
        },
        
        body: JSON.stringify({ price, lister_id })
    })

    if (!resp.ok) { return null; }

    const { paymentIntent, customerSessionClientSecret, customer } = await resp.json();
    console.log("Fetched payment sheet");

    return { paymentIntent, customerSessionClientSecret, customer };
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

export const stripe = { getKey, fetchPaymentSheetParams, fetchStripeAccountId, fetchStripeAccountLink, userHasStripeAccount }
