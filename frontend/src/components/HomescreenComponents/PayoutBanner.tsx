import { useCallback, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, Alert, Dimensions } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import { CustomFonts } from '@/src/constants/theme';
import { supabase } from '@/src/utils/supabase';
import { stripe } from '@/src/utils/stripe';
import { api } from '@/src/utils/api';
import { triggerLightHaptic } from '@/src/utils/haptics';
import { BANNER_SIDE_MARGIN, BANNER_RADIUS, BANNER_HEIGHT, BANNER_H_PAD } from './bannerStyle';

const { width: screenWidth } = Dimensions.get('window');
const SIDE_MARGIN = BANNER_SIDE_MARGIN;
const RADIUS = BANNER_RADIUS;
const H_PAD = BANNER_H_PAD;

/**
 * Home-screen prompt that appears only when the signed-in seller has earned
 * money that is still held on the platform and they haven't set up payouts yet.
 * Tapping it launches Stripe's hosted onboarding (deferred KYC/bank setup).
 */
export default function PayoutBanner() {
  const [userId, setUserId] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [payoutsEnabled, setPayoutsEnabled] = useState(true);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data: profile } = await supabase
      .from('profiles')
      .select('payouts_enabled')
      .eq('id', user.id)
      .single();
    setPayoutsEnabled(!!profile?.payouts_enabled);

    const { total } = await api.getPendingPayout(user.id);
    setPending(total);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleSetup = async () => {
    if (!userId || loading) return;
    triggerLightHaptic();
    setLoading(true);
    try {
      const accountId = await stripe.fetchStripeAccountId(userId);
      if (!accountId) {
        Alert.alert('Error', 'Could not create a payouts account. Please try again later.');
        return;
      }
      const url = await stripe.fetchStripeAccountLink(userId);
      if (!url) {
        Alert.alert('Error', 'Could not generate an onboarding link. Please try again.');
        return;
      }
      await WebBrowser.openBrowserAsync(url);
      // Backstop the webhook: sync payout status from Stripe on return, then refresh.
      await stripe.syncAccount(userId);
      await load(); // refresh state after they return
    } catch (error: any) {
      Alert.alert('Onboarding Error', error?.message ?? 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  // Nothing owed, or payouts already set up → no prompt.
  if (payoutsEnabled || pending <= 0) return null;

  return (
    <View style={{ marginHorizontal: SIDE_MARGIN, marginBottom: screenWidth * 0.05 }}>
      <TouchableOpacity style={styles.container} activeOpacity={0.85} onPress={handleSetup} disabled={loading}>
        <View style={styles.textCol}>
          <Text style={styles.title}>You have ${pending.toFixed(2)} waiting</Text>
          <Text style={styles.subtitle}>Set up payouts to get paid</Text>
        </View>
        {loading
          ? <ActivityIndicator color="#000000" />
          : <Text style={styles.cta}>Set up →</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F4F4F4',
    borderRadius: RADIUS,
    minHeight: BANNER_HEIGHT,
    paddingHorizontal: H_PAD,
    paddingVertical: screenWidth * 0.03,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  textCol: {
    flexShrink: 1,
    paddingRight: 12,
  },
  title: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: screenWidth * 0.042,
    color: '#000000',
  },
  subtitle: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.033,
    color: 'rgba(0,0,0,0.85)',
    marginTop: 2,
  },
  cta: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: screenWidth * 0.038,
    color: '#000000',
  },
});
