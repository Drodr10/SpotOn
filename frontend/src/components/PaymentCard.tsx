import { useEffect, useRef, useState } from 'react'
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Alert
} from 'react-native'
import { router } from 'expo-router'

import {  useStripe } from "@stripe/stripe-react-native"
import { stripe } from "../utils/stripe"

import { supabase } from '@/src/utils/supabase';
import { triggerLightHaptic } from '@/src/utils/haptics';

type PaymentProps = {
    listingId: string;
    listerId: string;
    price: number;
    hours: number;
    vehicleId?: string | null;
    startTime?: Date;
    endTime?: Date;
    disabled?: boolean;
    /**
     * Optional success hook. When provided, REPLACES the default navigation
     * to the home screen — the caller is responsible for navigating. The
     * payload includes the same fields PaymentCard already knows about so
     * the caller can build a confirmation message etc.
     */
    onPaymentSuccess?: (info: { listingId: string; price: number; hours: number }) => void;
}

export default function PaymentCard ({ listingId, listerId, price, hours, vehicleId, startTime, endTime, disabled: externalDisabled, onPaymentSuccess } : PaymentProps) {
    const { initPaymentSheet, presentPaymentSheet } = useStripe();
    const [loading, setLoading] = useState<boolean>(true);
    const [ready, setReady] = useState<boolean>(false);
    // Guards against duplicate reservation creation on re-init/strict-mode.
    const initKeyRef = useRef<string | null>(null);
    const startMs = startTime?.getTime();
    const endMs = endTime?.getTime();

    const initializePaymentSheet = async () => {
        if (externalDisabled || !vehicleId) return;

        const reservationStart = startMs ?? Date.now();
        const reservationEnd = endMs ?? reservationStart + 3600 * hours * 1000;
        const key = `${listingId}|${vehicleId}|${reservationStart}|${reservationEnd}`;
        if (initKeyRef.current === key) return; // already initialized for these params
        initKeyRef.current = key;

        setLoading(true);
        setReady(false);

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            setLoading(false);
            initKeyRef.current = null;
            Alert.alert('Sign in required', 'No active user session. Please sign in again.');
            return;
        }

        const params = await stripe.createBookingPayment({
            listing_id: listingId,
            renter_id: user.id,
            vehicle_id: vehicleId,
            start_time: new Date(reservationStart).toISOString(),
            end_time: new Date(reservationEnd).toISOString(),
        });

        if (!params) {
            setLoading(false);
            initKeyRef.current = null; // allow retry
            Alert.alert('Booking unavailable', 'This spot may already be booked for that time. Please try another slot.');
            return;
        }

        const { error } = await initPaymentSheet({
            merchantDisplayName: "SpotOn",
            customerId: params.customer,
            customerSessionClientSecret: params.customerSessionClientSecret,
            paymentIntentClientSecret: params.paymentIntent,
            allowsDelayedPaymentMethods: true,
            returnURL: 'spoton://stripe-redirect',
        });

        setLoading(false);
        if (!error) {
            setReady(true);
        } else {
            initKeyRef.current = null;
            Alert.alert(`Error: ${error.code}`, error.message);
        }
    }

    const openPaymentSheet = async () => {
        triggerLightHaptic();
        const { error } = await presentPaymentSheet();

        if (error) {
            if (error.code !== 'Canceled') {
                Alert.alert(`Error: ${error.code}`, error.message);
            }
            return;
        }

        // The reservation already exists server-side (created before the sheet);
        // payment_intent.succeeded webhook flips it to 'held'. Nothing to insert.
        Alert.alert('Payment Successful');
        if (onPaymentSuccess) {
            onPaymentSuccess({ listingId, price, hours });
        } else {
            router.push('./Homescreen');
        }
    }

    useEffect(() => {
        const timeout = setTimeout(() => {
            initializePaymentSheet();
        }, 500);
        return () => clearTimeout(timeout);
    }, [price, hours, startMs, endMs, vehicleId]);


    return (
        <View style={styles.container}>
            <TouchableOpacity
                disabled={loading || !ready || !!externalDisabled || !vehicleId}
                onPress={openPaymentSheet}
                style={[styles.button, (loading || !ready || externalDisabled || !vehicleId) && styles.buttonDisabled]}
            >
                <Text style={styles.text}>{ loading ? "Loading..." : `Reserve For $${price.toFixed(2)}` }</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
        container: {
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            width: "100%",
            marginTop: 4,
            marginBottom: 8,
        },
        button: {
            flex: 1,
            backgroundColor: "#000000",
            alignItems: "center",
            justifyContent: "center",
            width: "95%",
            paddingTop: 8,
            paddingLeft: 2,
            paddingRight: 2,
            paddingBottom: 8,
        },
        buttonDisabled: {
            backgroundColor: '#555555',
        },
        text: {
            color: "#ffffff",
            fontSize: 20,
            fontWeight: "bold",
        }
    });
