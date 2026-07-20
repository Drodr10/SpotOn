/**
 * ReservationInfoCard — Figma 493:9
 *
 * Compact reservation card used on the Profile page and the new
 * Your Reservations / Your Seller Account screens. The price pill and the
 * navigation-arrow circle both use the aura_gradient asset as their
 * background instead of the legacy yellow fill.
 */

import React, { useEffect, useState } from 'react';
import {
  Image,
  ImageBackground,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { CustomFonts } from '@/src/constants/theme';

import auraGradient from '@/assets/images/profilePage/aura_gradient.png';

export type ReservationCardVariant = 'current' | 'past' | 'listing';

export interface ReservationInfoCardProps {
  address: string;
  /** Required for variant === 'current'. */
  endTime?: Date | null;
  /** Required for variant === 'past'. */
  startTime?: Date | null;
  /** Dollar amount shown in the pill. Hidden when null/undefined. */
  totalPrice?: number | null;
  /** Listing photo shown along the bottom of the card. */
  photoUrl?: string | null;
  /** Override the timer/secondary line — used by the past/listing variants. */
  secondaryLineOverride?: string;
  /** When set, renders inside the aura-gradient pill in place of totalPrice. */
  pillLabel?: string;
  /** Hides the nav-arrow pill entirely. */
  hideNavArrow?: boolean;
  variant?: ReservationCardVariant;
  /** Card width — defaults to a sensible per-context value. */
  width?: number;
}

function formatTimeRemaining(endTime: Date): string {
  const diff = endTime.getTime() - Date.now();
  if (diff <= 0) return 'Reservation has ended.';
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  const secs = Math.floor((diff % 60_000) / 1000);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins} min`);
  if (days === 0 && hours === 0) parts.push(`${secs}s`);
  return `${parts.join(' ')} remaining till your parking expires.`;
}

function formatPastDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatPastTime(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatPastDateRange(start: Date, end: Date): string {
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    return `${formatPastDate(start)} • ${formatPastTime(start)} - ${formatPastTime(end)}`;
  }
  return `${formatPastDate(start)} ${formatPastTime(start)} - ${formatPastDate(end)} ${formatPastTime(end)}`;
}

function openMaps(address: string) {
  const encoded = encodeURIComponent(address);
  const url = Platform.select({
    ios: `maps://maps.apple.com/?q=${encoded}`,
    android: `geo:0,0?q=${encoded}`,
    default: `https://www.google.com/maps/search/?api=1&query=${encoded}`,
  })!;
  Linking.openURL(url);
}

export default function ReservationInfoCard({
  address,
  endTime,
  startTime,
  totalPrice,
  photoUrl,
  secondaryLineOverride,
  pillLabel,
  hideNavArrow,
  variant = 'current',
  width: widthOverride,
}: ReservationInfoCardProps) {
  const { width: screenWidth } = useWindowDimensions();

  const W = widthOverride ?? screenWidth * 0.86;
  const RADIUS = W * 0.085;
  const PAD = W * 0.05;
  const ADDR_FONT = W * 0.052;
  const META_FONT = W * 0.034;
  const PILL_FONT = W * 0.040;
  const PILL_H_PAD = W * 0.04;
  const PILL_V_PAD = W * 0.018;
  const ARROW_SIZE = W * 0.10;
  const PHOTO_HEIGHT = W * 0.42;
  const BORDER_WIDTH = Math.max(2, W * 0.008);

  const [timeLeft, setTimeLeft] = useState<string>(() =>
    variant === 'current' && endTime ? formatTimeRemaining(endTime) : '',
  );

  useEffect(() => {
    if (variant !== 'current' || !endTime) return;
    setTimeLeft(formatTimeRemaining(endTime));
    const id = setInterval(() => setTimeLeft(formatTimeRemaining(endTime)), 1000);
    return () => clearInterval(id);
  }, [variant, endTime]);

  const secondaryLine =
    secondaryLineOverride ??
    (variant === 'current'
      ? timeLeft
      : variant === 'past' && startTime && endTime
        ? formatPastDateRange(startTime, endTime)
        : '');

  return (
    <View
      style={[
        styles.card,
        {
          width: W,
          borderRadius: RADIUS,
          borderWidth: BORDER_WIDTH,
          padding: PAD,
        },
      ]}
    >
      {/* Address + nav-arrow row */}
      <View style={styles.headerRow}>
        <Text
          style={[styles.address, { fontSize: ADDR_FONT, marginRight: PAD }]}
          numberOfLines={1}
        >
          {address}
        </Text>
        {!hideNavArrow && (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => openMaps(address)}
            style={{ borderRadius: ARROW_SIZE / 2, overflow: 'hidden' }}
          >
            <ImageBackground
              source={auraGradient}
              style={{
                width: ARROW_SIZE,
                height: ARROW_SIZE,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              imageStyle={{ borderRadius: ARROW_SIZE / 2 }}
              resizeMode="cover"
            >
              <Ionicons name="navigate" size={ARROW_SIZE * 0.46} color="#000" />
            </ImageBackground>
          </TouchableOpacity>
        )}
      </View>

      {/* Price / rate pill (aura gradient bg) */}
      {(pillLabel != null || totalPrice != null) && (
        <View style={{ marginTop: PAD * 0.5, alignSelf: 'flex-start', borderRadius: 999, overflow: 'hidden' }}>
          <ImageBackground
            source={auraGradient}
            style={{
              paddingHorizontal: PILL_H_PAD,
              paddingVertical: PILL_V_PAD,
            }}
            imageStyle={{ borderRadius: 999 }}
            resizeMode="cover"
          >
            <Text style={[styles.priceText, { fontSize: PILL_FONT }]}>
              {pillLabel ?? `$${(totalPrice as number).toFixed(2)}`}
            </Text>
          </ImageBackground>
        </View>
      )}

      {/* Secondary line — countdown / date range / custom subtitle */}
      {!!secondaryLine && (
        <Text style={[styles.secondary, { fontSize: META_FONT, marginTop: PAD * 0.6 }]}>
          {secondaryLine}
        </Text>
      )}

      {/* Listing image */}
      {!!photoUrl && (
        <Image
          source={{ uri: photoUrl }}
          style={{
            width: '100%',
            height: PHOTO_HEIGHT,
            marginTop: PAD * 0.6,
            borderRadius: RADIUS * 0.4,
          }}
          resizeMode="cover"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(220, 219, 216, 0.80)',
    borderColor: '#000000',
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  address: {
    flex: 1,
    fontFamily: CustomFonts.SwitzerSemibold,
    color: '#000000',
  },
  priceText: {
    fontFamily: CustomFonts.BevellierMedium,
    color: '#000000',
  },
  secondary: {
    fontFamily: CustomFonts.SwitzerLight,
    color: '#000000',
  },
});
