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
import { JwtPayload } from '@supabase/supabase-js';

type PaymentProps = {
    listingId: string;
    price: number;
    hours: number;
}

export default function PaymentCard ({ listingId, price, hours } : PaymentProps) {
    const { initPaymentSheet, presentPaymentSheet } = useStripe();
    const [loading, setLoading] = useState<boolean>(true);
    const [claims, setClaims] = useState<JwtPayload>();
    
    const initializePaymentSheet = async () => {
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
            Alert.alert(`Error: ${error.code}`, error.message);
            console.log("Error creating payment sheet:", error);

        }
    }

    const openPaymentSheet = async () => {
        const { error } = await presentPaymentSheet();

        if (error) {
            if (error.code !== 'Canceled') {
                Alert.alert(`Error: ${error.code}`, error.message);
            }
        } else {
            Alert.alert("Payment Successful");
            await api.reserveSpot(listingId, price, claims!.sub, Date.now(), Date.now() + 3600 * hours * 1000);
            router.push('./Homescreen');
        }
    }

    useEffect(() => {
        const setupPayment = async () => {
            await initializePaymentSheet();
        };
        setupPayment();
    }, [price, hours]);
    
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
                disabled={loading}
                onPress={openPaymentSheet}
                style={[styles.button, loading && styles.buttonDisabled]}
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