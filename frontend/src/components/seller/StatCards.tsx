/**
 * StatCards — the two aura-gradient cards at the top of Seller Account
 * (Figma 787:39): "Payouts Remaining" (tappable) and "Lifetime Earnings" with
 * a per-month breakdown, plus the outlined "Manage Listings" button.
 * Amounts count up from $0 on the UI thread.
 */

import React from 'react';
import { ImageBackground, StyleSheet, Text, View } from 'react-native';

import { CustomFonts } from '@/src/constants/theme';
import CountUp from '@/src/components/activity/CountUp';
import PressableCard from '@/src/components/activity/PressableCard';
import { CARD_GAP, CARD_W } from '@/src/components/activity/layout';
import { type Earnings } from '@/src/utils/activity';

import auraGradient from '@/assets/images/profilePage/aura_gradient.png';

const COL_W = (CARD_W - CARD_GAP) / 2;
const RADIUS = COL_W * 0.22;
const BORDER = Math.max(2, CARD_W * 0.008);

/** Big-number font that shrinks as the figure gets longer so it never clips. */
function amountFont(value: number | null): number {
  const decimals = value !== null && Math.round(value * 100) % 100 !== 0;
  const len = value === null ? 3 : `$${value.toFixed(decimals ? 2 : 0)}`.length;
  const ratio = len <= 4 ? 0.27 : len <= 6 ? 0.21 : len <= 8 ? 0.16 : 0.125;
  return COL_W * ratio;
}

type Props = {
  earnings: Earnings | null;
  hasListings: boolean;
  onPayoutsPress: () => void;
  onManagePress: () => void;
};

export default function StatCards({ earnings, onPayoutsPress, onManagePress }: Props) {
  const remaining = earnings ? earnings.remaining : null;
  const lifetime = earnings ? earnings.lifetime : null;

  return (
    <View style={styles.row}>
      <View style={styles.col}>
        <PressableCard
          onPress={onPayoutsPress}
          accessibilityLabel='Payouts remaining. Opens payout details.'
          style={styles.payoutsWrap}
        >
          <ImageBackground
            source={auraGradient}
            resizeMode='cover'
            style={styles.payouts}
            imageStyle={{ borderRadius: RADIUS - BORDER }}
          >
            <CountUp value={remaining} style={{ ...styles.amount, fontSize: amountFont(remaining) }} />
            <Text style={styles.label}>Payouts Remaining</Text>
          </ImageBackground>
        </PressableCard>

        <PressableCard
          onPress={onManagePress}
          accessibilityLabel='Manage listings'
          style={styles.manage}
        >
          <Text style={styles.manageText}>Manage Listings</Text>
        </PressableCard>
      </View>

      <View style={[styles.col, styles.lifetimeWrap]}>
        <ImageBackground
          source={auraGradient}
          resizeMode='cover'
          style={styles.lifetime}
          imageStyle={{ borderRadius: RADIUS - BORDER }}
        >
          <CountUp value={lifetime} style={{ ...styles.amount, fontSize: amountFont(lifetime) }} />
          <Text style={styles.label}>Lifetime Earnings</Text>

          <View style={styles.months}>
            {earnings && earnings.months.length === 0 && (
              <Text style={styles.monthLabel}>No earnings yet</Text>
            )}
            {earnings?.months.map((m) => (
              <View key={m.key} style={styles.monthRow}>
                <Text style={styles.monthAmount}>
                  ${m.amount.toFixed(Math.round(m.amount * 100) % 100 === 0 ? 0 : 2)}
                </Text>
                <Text style={styles.monthLabel} numberOfLines={1}>
                  {m.label}
                </Text>
              </View>
            ))}
          </View>
        </ImageBackground>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: CARD_GAP, alignItems: 'stretch' },
  col: { width: COL_W },
  lifetimeWrap: {
    borderWidth: BORDER,
    borderColor: '#000',
    borderRadius: RADIUS,
    overflow: 'hidden',
  },
  payoutsWrap: {
    borderWidth: BORDER,
    borderColor: '#000',
    borderRadius: RADIUS,
    overflow: 'hidden',
  },
  payouts: {
    height: COL_W * 0.8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: COL_W * 0.06,
  },
  lifetime: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: COL_W * 0.1,
    paddingHorizontal: COL_W * 0.08,
  },
  manage: {
    marginTop: CARD_GAP,
    height: COL_W * 0.28,
    borderRadius: 999,
    borderWidth: BORDER,
    borderColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: COL_W * 0.09,
    color: '#000',
  },
  amount: {
    fontFamily: CustomFonts.BevellierMedium,
    color: '#000',
    textAlign: 'center',
    includeFontPadding: false,
  },
  label: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: COL_W * 0.075,
    color: '#000',
    marginTop: COL_W * 0.01,
    textAlign: 'center',
  },
  months: { alignSelf: 'stretch', marginTop: COL_W * 0.12, gap: COL_W * 0.05 },
  monthRow: { flexDirection: 'row', alignItems: 'baseline', gap: COL_W * 0.06 },
  monthAmount: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: COL_W * 0.12,
    color: '#000',
  },
  monthLabel: {
    flexShrink: 1,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: COL_W * 0.07,
    color: '#000',
  },
});
