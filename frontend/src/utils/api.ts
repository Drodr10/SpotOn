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
            "Authorization": `Bearer ${session.access_token}`,
            "ngrok-skip-browser-warning": "true"
        },
        body: JSON.stringify(body)
    });
}

const getActiveReservation = async (userId: string) => {
    console.log("Fetching active reservation...")
    const resp = await fetch(`https://${API_IP}/api/reservations/${userId}`, {
        headers: { "ngrok-skip-browser-warning": "true" }
    });
    const data = await resp.json();

    if (!resp.ok) {
        console.log("Failed to fetch active reservation.");
        return null;
    }
    
    for (const reservation of data) {
        const endTime = new Date(reservation.end_time);
        console.log(`Reservation ${reservation.id} ends at ${endTime}, now is ${new Date()}`)

        if (new Date() < endTime) {
            const { data: listingData, error } = await supabase.from("listings").select("*").eq("id", reservation.listing_id).single();
            if (error) {
                console.log(error)
                return null;
            }

            return { listingData, endTime };
        }
    }
    return null;
}

const getReservations = async (userId: string) => {
    console.log("Fetching all user  reservations...")
    const resp = await fetch(`https://${API_IP}/api/reservations/${userId}`, {
        headers: { "ngrok-skip-browser-warning": "true" }
    });
    const data = await resp.json();
    if (!resp.ok)
        return null;
    
    const listings = [];

    for (const reservation of data) {
        const { data: listingData, error } = await supabase.from("listings").select("*").eq("id", reservation.listing_id).single();
        if (error) {
            console.log(error)
            return null;
        }
        listings.push({ listingData, end_time: new Date(reservation.end_time) });
    }
    
    console.log(data);
    return listings;
}

export const api = { reserveSpot, getActiveReservation, getReservations }