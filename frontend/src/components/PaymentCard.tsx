import { useRef, useState } from 'react'
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Alert,
    Animated,
    Dimensions,
    Easing,
    Image,
    Modal,
} from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {  useStripe } from "@stripe/stripe-react-native"
import { stripe } from "../utils/stripe"

import { supabase } from '@/src/utils/supabase';
import { triggerLightHaptic, withLightHaptic } from '@/src/utils/haptics';
import { CustomFonts } from '../constants/theme';
import spotonLogoCircle from '../../assets/images/spotonlogocircle.png';

const { height: SCREEN_H } = Dimensions.get('window');

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
    const insets = useSafeAreaInsets();
    const [submitting, setSubmitting] = useState<boolean>(false);

    // "Slot is being checked out by someone else" card popup.
    const [showUnavailable, setShowUnavailable] = useState<boolean>(false);
    const [unavailableMsg, setUnavailableMsg] = useState<string>('');
    const popupAnim = useRef(new Animated.Value(SCREEN_H)).current;
    const backdropAnim = useRef(new Animated.Value(0)).current;

    const openUnavailable = (message: string) => {
        setUnavailableMsg(message);
        popupAnim.setValue(SCREEN_H);
        setShowUnavailable(true);
        Animated.parallel([
            Animated.spring(popupAnim, { toValue: 0, damping: 14, stiffness: 130, mass: 1, useNativeDriver: true }),
            Animated.timing(backdropAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        ]).start();
    };

    const closeUnavailable = () => {
        Animated.parallel([
            Animated.spring(popupAnim, { toValue: SCREEN_H, damping: 14, stiffness: 130, mass: 1, useNativeDriver: true }),
            Animated.timing(backdropAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
        ]).start(() => setShowUnavailable(false));
    };

    const handleReserve = async () => {
        if (submitting || externalDisabled || !vehicleId) return;
        triggerLightHaptic();
        setSubmitting(true);

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                Alert.alert('Sign in required', 'No active user session. Please sign in again.');
                return;
            }

            const reservationStart = startTime?.getTime() ?? Date.now();
            const reservationEnd = endTime?.getTime() ?? reservationStart + 3600 * hours * 1000;

            // 1) Acquire the slot hold + create the PaymentIntent.
            const result = await stripe.createBookingPayment({
                listing_id: listingId,
                renter_id: user.id,
                vehicle_id: vehicleId,
                start_time: new Date(reservationStart).toISOString(),
                end_time: new Date(reservationEnd).toISOString(),
            });

            if (result.status === 'unavailable') {
                openUnavailable(result.message);
                return;
            }
            if (result.status === 'error') {
                Alert.alert('Booking failed', result.message);
                return;
            }

            const { params } = result;

            // 2) Prepare the Stripe sheet.
            const { error: initError } = await initPaymentSheet({
                merchantDisplayName: "SpotOn",
                customerId: params.customer,
                customerSessionClientSecret: params.customerSessionClientSecret,
                paymentIntentClientSecret: params.paymentIntent,
                allowsDelayedPaymentMethods: true,
                returnURL: 'spoton://stripe-redirect',
            });
            if (initError) {
                await stripe.releaseHold(params.holdId);
                Alert.alert(`Error: ${initError.code}`, initError.message);
                return;
            }

            // 3) Present it. Backing out releases the hold immediately.
            const { error: payError } = await presentPaymentSheet();
            if (payError) {
                await stripe.releaseHold(params.holdId);
                if (payError.code !== 'Canceled') {
                    Alert.alert(`Error: ${payError.code}`, payError.message);
                }
                return;
            }

            // 4) Paid. Finalize immediately (creates the reservation + releases
            //    the hold) so it exists before we land in chat; the webhook is an
            //    idempotent backstop. If finalize fails, DO NOT navigate to chat —
            //    the reservation doesn't exist yet and we need the user to see it.
            const finalized = await stripe.finalizeBooking(params.paymentIntent);
            if (!finalized.ok) {
                Alert.alert(
                    'Payment succeeded, booking not confirmed',
                    `${finalized.message ?? 'unknown error'}\n\nYour card was charged but the reservation could not be created. Please contact support with this message before rebooking.`,
                );
                return;
            }
            if (onPaymentSuccess) {
                onPaymentSuccess({ listingId, price, hours });
            } else {
                router.push('./Homescreen');
            }
        } finally {
            setSubmitting(false);
        }
    }

    const disabled = submitting || !!externalDisabled || !vehicleId;
    const W = Dimensions.get('window').width;

    return (
        <View style={styles.container}>
            <TouchableOpacity
                disabled={disabled}
                onPress={handleReserve}
                style={[styles.button, disabled && styles.buttonDisabled]}
            >
                <Text style={styles.text}>{ submitting ? "Loading..." : `Reserve For $${price.toFixed(2)}` }</Text>
            </TouchableOpacity>

            {/* Slot-in-checkout card — same design/animation as the rate popups. */}
            <Modal visible={showUnavailable} transparent animationType="none" onRequestClose={closeUnavailable}>
                <Animated.View style={[styles.popupBackdrop, { opacity: backdropAnim }]}>
                    <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeUnavailable} />
                </Animated.View>

                <Animated.View
                    style={[
                        styles.popupCard,
                        {
                            bottom: W * 0.05 + insets.bottom,
                            paddingTop: W * 0.055,
                            paddingBottom: W * 0.045,
                            paddingHorizontal: W * 0.06,
                            borderRadius: W * 0.07,
                            transform: [{ translateY: popupAnim }],
                        },
                    ]}
                >
                    <Image
                        source={spotonLogoCircle}
                        style={[styles.popupLogo, { width: W * 0.075, height: W * 0.075, top: W * 0.05, right: W * 0.06 }]}
                        resizeMode="contain"
                    />

                    <Text style={[styles.popupTitle, { fontSize: W * 0.055, marginBottom: W * 0.03, marginTop: W * 0.005 }]}>
                        Spot in checkout
                    </Text>
                    <Text style={[styles.popupBody, { fontSize: W * 0.036, lineHeight: W * 0.052, marginBottom: W * 0.055 }]}>
                        {unavailableMsg || "Someone's checking out this spot right now. If they don't finish in a few minutes, it'll open back up — hang tight and try again."}
                    </Text>

                    <TouchableOpacity
                        style={[styles.popupButton, { height: W * 0.12, borderRadius: W * 0.06 }]}
                        onPress={withLightHaptic(closeUnavailable)}
                        activeOpacity={0.8}
                    >
                        <Text style={[styles.popupButtonText, { fontSize: W * 0.04 }]}>Got it</Text>
                    </TouchableOpacity>
                </Animated.View>
            </Modal>
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
        },

        // ── Slot-in-checkout popup (mirrors the create-listing rate popups) ──
        popupBackdrop: {
            ...StyleSheet.absoluteFillObject,
            backgroundColor: 'rgba(0,0,0,0.45)',
        },
        popupCard: {
            position: 'absolute',
            left: 16,
            right: 16,
            backgroundColor: '#000',
            zIndex: 20,
            elevation: 12,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.35,
            shadowRadius: 16,
        },
        popupLogo: {
            position: 'absolute',
            opacity: 0.9,
            zIndex: 1,
        },
        popupTitle: {
            fontFamily: CustomFonts.BevellierMedium,
            color: '#fff',
        },
        popupBody: {
            fontFamily: CustomFonts.SwitzerLight,
            color: 'rgba(255,255,255,0.75)',
        },
        popupButton: {
            backgroundColor: 'rgba(255,255,255,0.12)',
            alignItems: 'center',
            justifyContent: 'center',
        },
        popupButtonText: {
            fontFamily: CustomFonts.SwitzerSemibold,
            color: '#fff',
        },
    });
