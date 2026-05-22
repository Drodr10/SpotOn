import { useEffect, useState } from 'react'
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
import { router, useLocalSearchParams } from 'expo-router'

import {  useStripe } from "@stripe/stripe-react-native"
import { stripe } from "../utils/stripe"
import { api } from "../utils/api"

import { supabase } from '@/src/utils/supabase';
import { triggerLightHaptic } from '@/src/utils/haptics';
import { JwtPayload } from '@supabase/supabase-js';

type PaymentProps = {
    listingId: string;
    price: number;
    hours: number;
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

export default function PaymentCard ({ listingId, price, hours, startTime, endTime, disabled: externalDisabled, onPaymentSuccess } : PaymentProps) {
    const { initPaymentSheet, presentPaymentSheet } = useStripe();
    const [loading, setLoading] = useState<boolean>(true);
    const [claims, setClaims] = useState<JwtPayload>();
    const startMs = startTime?.getTime();
    const endMs = endTime?.getTime();
    
    const initializePaymentSheet = async () => {
        if (externalDisabled) return;
        setLoading(true);
        const {
            paymentIntent,
            customerSessionClientSecret,
            customer,
        } = await stripe.fetchPaymentSheetParams(price);

        const { error } = await initPaymentSheet({
            merchantDisplayName: "SpotOn",
            customerId: customer,
            customerSessionClientSecret: customerSessionClientSecret,
            paymentIntentClientSecret: paymentIntent,
            allowsDelayedPaymentMethods: true,
            returnURL: 'spoton://stripe-redirect',
            defaultBillingDetails: {
                name: "Diego Rodriguez"
            }
        });

        if(!error)
            setLoading(false);
        else {
            setLoading(false);
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

        if (!claims?.sub) {
            Alert.alert('Reservation Error', 'No active user session. Please sign in again.');
            return;
        }

        const reservationStart = startMs ?? Date.now();
        const reservationEnd = endMs ?? reservationStart + 3600 * hours * 1000;
        try {
            await api.reserveSpot(listingId, price, claims.sub, reservationStart, reservationEnd);
        } catch (e: any) {
            console.error('[PaymentCard] reservation insert failed', e);
            Alert.alert('Reservation Error', e?.message ?? 'Could not save your reservation. Please contact support.');
            return;
        }

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
    }, [price, hours, startMs, endMs]);
    
    useEffect(() => {
        supabase.auth.getClaims().then(async (resp) => {
        const {data, error} = resp;

        if (error || !data) {
            console.log("Error in finding matching user ID: " + (error ? error : "Data error"));
            return;
        }
        setClaims(data.claims);
        const { data: profileData, error: profileError } =  await supabase.from('profiles').select('*').eq('id', data.claims.sub).single();

        if (profileError || !profileData) {
            console.log("Error in retriving user profile data: " + (profileError ? profileError : "Data error"));
            return;
        }
        });
  }, []);
    

    return (
        <View style={styles.container}>
            <TouchableOpacity
                disabled={loading || !!externalDisabled}
                onPress={openPaymentSheet}
                style={[styles.button, (loading || externalDisabled) && styles.buttonDisabled]}
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
