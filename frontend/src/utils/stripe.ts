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

const fetchPaymentSheetParams = async (price: number, listerId: string) => {
    console.log(`Attempting to fetch payment sheet @ ${API_IP}/stripe/payment-sheet`)

    const body = {
        price,
        listerId
    };

    const resp = await fetch(`${API_IP}/stripe/payment-sheet`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "true"
        },
        
        body: JSON.stringify({ price, listerId })
    })

    if (!resp.ok) { return null; }

    const { paymentIntent, customerSessionClientSecret, customer } = await resp.json();
    console.log("Fetched payment sheet");

    return { paymentIntent, customerSessionClientSecret, customer };
}

export const stripe = { getKey, fetchPaymentSheetParams, }
