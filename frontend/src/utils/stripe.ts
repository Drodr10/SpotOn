const API_IP = process.env.EXPO_PUBLIC_IP ?? "nulled";

const getKey = async () : Promise<string | null> => {
    const resp = await fetch(`https://${API_IP}/api/stripe/key`, {
        method: "GET",
        headers: { "ngrok-skip-browser-warning": "true" }
    });
    if (!resp.ok)
        return null;

    const data = await resp.json();
    return data.publishableKey;
}

const fetchPaymentSheetParams = async (price: number) => {
    console.log(`Attempting to fetch payment sheet @ https://${API_IP}/api/stripe/payment-sheet`)
    const resp = await fetch(`https://${API_IP}/api/stripe/payment-sheet`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "true"
        },
        body: JSON.stringify({ price})
    })
    const {paymentIntent, customerSessionClientSecret, customer } = await resp.json();
    console.log("Fetched payment sheet");
    return { paymentIntent, customerSessionClientSecret, customer };
}

export const stripe = { getKey, fetchPaymentSheetParams }
