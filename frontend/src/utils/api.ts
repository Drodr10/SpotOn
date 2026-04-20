import { supabase } from "./supabase"
const API_IP = process.env.EXPO_PUBLIC_IP ?? "nulled";


const reserveSpot = async (listing_id: string, price: number, renter_id: string, start_time: number, end_time: number, ) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session)
        return;

    const body = { 
        listing_id: listing_id,
        renter_id: renter_id,
        start_time: new Date(start_time).toISOString(),
        end_time: new Date(end_time).toISOString(),
        total_price: price
    };
    const resp = await fetch(`https://${API_IP}/api/reservations`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify(body)
    });
}

export const api = { reserveSpot }