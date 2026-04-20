import { 
    View, 
    Text,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    Image,
    Button,
    Alert
} from 'react-native'
import { useState, useEffect } from 'react'

import { api } from "../../utils/api"

type CurrentListingCardProps = {
    userId: string;
}

type ActiveReservation = {
    listingData: {
        id: string;
        owner_id: string;
        address: string;
        price_per_hour: number;
        photo_url: string;
    },
    endTime: Date;
}

export default function CurrentListingCard({ userId }: CurrentListingCardProps) {
    const [activeReservation, setActiveReservation] = useState<ActiveReservation | null>(null);
    const fetchReservation = async () => {setActiveReservation(await api.getActiveReservation(userId))};
    const [loading, setLoading] = useState<boolean>(true);
    const [timeString, setTimeString] = useState<string>("");


    useEffect(() => {
        fetchReservation();
        setLoading(false);
    }, []);
    useEffect(() => {
        if (!activeReservation) return;

        const intervalId = setInterval(() => {
            const endTime = new Date(activeReservation.endTime);
            const now = new Date();
            const timeLeft = endTime.getTime() - now.getTime();

            if (timeLeft <= 0) {
                setActiveReservation(null);
                clearInterval(intervalId);
                return;
            }

            const hours = Math.floor(timeLeft / (1000 * 60 * 60));
            const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);

            let tstring = "";
            if (hours > 0) tstring += `${hours}h `;
            if (hours > 0 || minutes > 0) tstring += `${minutes}m `;
            tstring += `${seconds}s`;

            setTimeString(tstring);
        }, 1000);

        return () => clearInterval(intervalId);
    }, [activeReservation])

    if (loading) return (<View style={styles.container}><Text style={styles.headerText}>Loading...</Text></View>)

    return(
    <View style={styles.container}>

        {
        activeReservation ?
            <>
            <Text style={styles.headerText}>Active Reservation at:</Text>
            <Text style={styles.locationText}>{activeReservation.listingData.address}</Text>
            <Text style={styles.timeText}>{timeString}</Text>
            </>
        :
            <Text style={styles.headerText}>No active reservations.</Text>
        }
    </View>
    );
}

const styles = StyleSheet.create({
        container: {
            padding: 8,
            backgroundColor: 'rgba(0,0,0,0.25)',
            borderRadius: 25,
            fontWeight: "bold",
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            borderColor:"#000000",
            borderWidth: 1,
            gap: 8,
        },
        headerText: {
            fontSize: 16,
            fontWeight: "bold",
            color: "#ffffff",
            textAlign: 'center',
        },
        locationText: {
            fontSize: 24,
            color: "#ffffff",
            textAlign: 'center',
        },
        timeText: {
            fontSize: 48,
            fontWeight: "bold",
            textAlign: "center",
            color: "#ffffff"
        }
        
    });