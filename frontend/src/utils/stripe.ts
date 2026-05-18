import { supabase } from "./supabase";
const API_IP = process.env.EXPO_PUBLIC_IP ? `https://${process.env.EXPO_PUBLIC_IP}/api` : "nulled";

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

const fetchPaymentSheetParams = async (price: number, listingId: string) => {
    console.log(`Attempting to fetch payment sheet @ ${API_IP}/stripe/payment-sheet`)
    const resp = await fetch(`${API_IP}/stripe/payment-sheet`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "true"
        },
        
        body: JSON.stringify({ price, listingId })
    })

    if (!resp.ok) { return null; }

    const {paymentIntent, customerSessionClientSecret, customer } = await resp.json();
    console.log("Fetched payment sheet");

    return { paymentIntent, customerSessionClientSecret, customer };
}

const handleCreateConnectAccount = async (email: string, user_id: string ): Promise<string | null> => {
    console.log('Attempting to create Stripe onboarding link for user:', user_id);
    try {
        const resp = await fetch(`${API_IP}/stripe/create-connect-account`, {
            method: 'POST',
            headers: {
                "Content-Type": "application/json",
                "ngrok-skip-browser-warning": "true"
            },
            body: JSON.stringify({ email, user_id })
        });
 
        if (!resp.ok) {
            const errorData = await resp.json();
            console.error('Failed to create stripe connect account link:', errorData.error);
            return null;
        }
 
        const { url } = await resp.json();
        return url;
    } catch (error) {
        console.error('An unexpected error occurred while creating connect account link:', error);
        return null;
    }
 }

const createStripeProduct = async (name: string, description: string, price: number, stripeId: string, listingId: string): Promise<any | null> => {
    console.log('Attempting to create stripe product for listing');
    try {
        const resp = await fetch(`${API_IP}/stripe/create-product`, {
            method: 'POST',
            headers: {
                "Content-Type": "application/json",
                "ngrok-skip-browser-warning": "true"
            },
            body: JSON.stringify({ name, description, price, stripeId, listingId })
        });

        if (!resp.ok) {
            const errorData = await resp.json();
            console.error('Failed to create stripe product:', errorData.error);
            return null;
        }

        return await resp.json();
    } catch (error) {
        console.error('An unexpected error occurred while creating stripe product:', error);
        return null;
    }
}

export const stripe = { getKey, fetchPaymentSheetParams, handleCreateConnectAccount, createStripeProduct }
