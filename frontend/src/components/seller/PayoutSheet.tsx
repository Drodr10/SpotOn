/**
 * PayoutSheet — opens from the "Payouts Remaining" card (Figma 787:115 note).
 *  - payouts not set up + money waiting  -> explains and launches Stripe onboarding
 *    (same flow as the home-screen PayoutBanner)
 *  - payouts set up                      -> explains money is sent after each booking ends
 */

import React, { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { CustomFonts } from '@/src/constants/theme';
import BottomSheet from '@/src/components/activity/BottomSheet';
import PressableCard from '@/src/components/activity/PressableCard';
import { SW } from '@/src/components/activity/layout';
import { stripe } from '@/src/utils/stripe';
import { money } from '@/src/utils/activity';

type Props = {
  visible: boolean;
  onClose: () => void;
  remaining: number;
  payoutsEnabled: boolean | null;
  /** Called after returning from Stripe so the page can re-check payout status. */
  onSetupReturned: () => void;
};

export default function PayoutSheet({
  visible,
  onClose,
  remaining,
  payoutsEnabled,
  onSetupReturned,
}: Props) {
  const [busy, setBusy] = useState(false);

  const setup = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const accountId = await stripe.fetchStripeAccountId();
      if (!accountId) {
        Alert.alert('Error', 'Could not create a payouts account. Please try again later.');
        return;
      }
      const url = await stripe.fetchStripeAccountLink();
      if (!url) {
        Alert.alert('Error', 'Could not generate an onboarding link. Please try again.');
        return;
      }
      await WebBrowser.openBrowserAsync(url);
      await stripe.syncAccount();
      onSetupReturned();
    } catch (err: any) {
      Alert.alert('Onboarding Error', err?.message ?? 'An unexpected error occurred.');
    } finally {
      setBusy(false);
    }
  };

  const needsSetup = payoutsEnabled === false && remaining > 0;

  let title: string;
  let body: string;
  if (remaining <= 0) {
    title = 'Nothing waiting right now';
    body =
      'When a booking on one of your spots finishes, your share is sent to your bank automatically. It will show up here while it’s on its way.';
  } else if (needsSetup) {
    title = `${money(remaining)} is waiting for you`;
    body =
      'Set up payouts once and we’ll send your earnings straight to your bank after each booking ends. Anything unclaimed is returned to the renter after 30 days.';
  } else {
    title = `${money(remaining)} on the way`;
    body =
      'This is sent to your account after each booking finishes. Bookings that haven’t ended yet are paid out once they do.';
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeightRatio={0.6}>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.text}>{body}</Text>

        {needsSetup ? (
          <PressableCard
            onPress={setup}
            disabled={busy}
            accessibilityLabel='Set up payouts'
            style={styles.cta}
          >
            {busy ? (
              <ActivityIndicator color='#fff' />
            ) : (
              <Text style={styles.ctaText}>Set up payouts</Text>
            )}
          </PressableCard>
        ) : (
          <PressableCard onPress={onClose} accessibilityLabel='Done' style={styles.cta}>
            <Text style={styles.ctaText}>Got it</Text>
          </PressableCard>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: SW * 0.08,
    paddingBottom: SW * 0.05,
  },
  title: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: SW * 0.055,
    color: '#fff',
    marginBottom: SW * 0.025,
  },
  text: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: SW * 0.037,
    lineHeight: SW * 0.054,
    color: 'rgba(255,255,255,0.78)',
    marginBottom: SW * 0.05,
  },
  cta: {
    height: SW * 0.12,
    borderRadius: SW * 0.06,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: SW * 0.04,
    color: '#fff',
  },
});
