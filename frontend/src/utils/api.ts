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

const getReservations = async (userId: string) => {
    console.log("Fetching active reservation...")
    const resp = await fetch(`https://${API_IP}/api/reservations/${userId}`);
    const data = await resp.json();
    
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

export const api = { reserveSpot, getReservations}