/**
 * BookingCards — the two card shapes from the Figma Activity / Seller Account
 * frames:
 *   ActiveBookingCard  large outlined card: photo, countdown badge, address,
 *                      date line, price, optional action (746:16 / 787:90)
 *   CompactBookingRow  compact outlined row: thumbnail, address, date line and
 *                      a white price chip bleeding off the right edge (746:57)
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { CustomFonts } from '@/src/constants/theme';
import {
  bookingAddress,
  bookingPhase,
  formatBookingRange,
  formatCountdown,
  formatStartsIn,
  money,
  type Booking,
  type BookingRole,
} from '@/src/utils/activity';
import PressableCard from './PressableCard';
import { LiveLabel } from './RollingText';
import { CARD_W } from './layout';

const BORDER = Math.max(2, CARD_W * 0.008);
const RADIUS = CARD_W * 0.12;

/** What a card shows as its money figure: what the renter paid, or what the host earns. */
export function bookingAmount(b: Booking, role: BookingRole): number {
  return role === 'host' ? b.hostPayout : b.totalPrice;
}

function cardLabel(b: Booking, role: BookingRole, now: number): string {
  const phase = bookingPhase(b, now);
  const state =
    phase === 'cancelled' ? 'cancelled' : phase === 'past' ? 'finished' : phase === 'active' ? 'in progress' : 'scheduled';
  return `${bookingAddress(b)}, ${formatBookingRange(b.start, b.end)}, ${money(bookingAmount(b, role))}, ${state}`;
}

// ─── Thumbnail ───────────────────────────────────────────────────────────────

export function ListingThumb({
  uri,
  size,
  radius,
}: {
  uri: string | null | undefined;
  size: number;
  radius: number;
}) {
  if (!uri) {
    return (
      <View style={[styles.thumbFallback, { width: size, height: size, borderRadius: radius }]}>
        <Ionicons name='car-outline' size={size * 0.5} color='rgba(0,0,0,0.45)' />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size, borderRadius: radius, backgroundColor: 'rgba(0,0,0,0.08)' }}
      contentFit='cover'
      transition={200}
      accessibilityIgnoresInvertColors
    />
  );
}

// ─── Active / scheduled big card ─────────────────────────────────────────────

type ActiveProps = {
  booking: Booking;
  role: BookingRole;
  /** 'remaining' = live countdown to end; 'starts' = live "in 2d 3hr" until start. */
  badge: 'remaining' | 'starts';
  onPress: () => void;
  /** Host: opens a chat with the renter. */
  onMessage?: () => void;
  /** Renter: cancel pill (only passed when the cancellation window is open). */
  onCancel?: () => void;
  cancelling?: boolean;
  /** Current time (ms) from the screen's `useNow` — keeps render pure. */
  now: number;
};

export function ActiveBookingCard({
  booking,
  role,
  badge,
  onPress,
  onMessage,
  onCancel,
  cancelling,
  now,
}: ActiveProps) {
  const P = CARD_W * 0.04;
  const photoH = CARD_W * 0.44;
  const withSeconds = role === 'host';
  const amount = bookingAmount(booking, role);

  return (
    <PressableCard
      onPress={onPress}
      accessibilityLabel={cardLabel(booking, role, now)}
      style={[styles.card, { padding: P }]}
    >
      <View style={{ height: photoH }}>
        {booking.listing?.photo_url ? (
          <Image
            source={{ uri: booking.listing.photo_url }}
            style={[StyleSheet.absoluteFill, { borderRadius: RADIUS * 0.8 }]}
            contentFit='cover'
            transition={250}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.photoFallback, { borderRadius: RADIUS * 0.8 }]}>
            <Ionicons name='car-outline' size={photoH * 0.34} color='rgba(0,0,0,0.4)' />
          </View>
        )}
        <View style={[styles.badge, { top: photoH * 0.07, right: -P, height: CARD_W * 0.085 }]}>
          <LiveLabel
            style={styles.badgeText}
            getLabel={(now) =>
              badge === 'remaining'
                ? formatCountdown(booking.end.getTime() - now, withSeconds)
                : formatStartsIn(booking.start.getTime() - now)
            }
          />
        </View>
      </View>

      <Text style={styles.address} numberOfLines={1}>
        {bookingAddress(booking)}
      </Text>
      <Text style={styles.date} numberOfLines={1}>
        {formatBookingRange(booking.start, booking.end)}
      </Text>

      <View style={styles.priceRow}>
        <View style={styles.priceCol}>
          <Text style={styles.price}>{money(amount)}</Text>
          {role === 'host' && <Text style={styles.priceHint}>your payout</Text>}
        </View>

        {role === 'host' && onMessage ? (
          <PressableCard
            onPress={onMessage}
            hitSlop={8}
            accessibilityLabel='Message the renter'
            style={styles.msgCircle}
          >
            <Ionicons name='chatbubble-ellipses' size={CARD_W * 0.055} color='#FFFFFF' />
          </PressableCard>
        ) : onCancel ? (
          <PressableCard
            onPress={onCancel}
            disabled={cancelling}
            hitSlop={8}
            accessibilityLabel='Cancel reservation'
            style={styles.cancelPill}
          >
            <Text style={styles.cancelPillText}>{cancelling ? 'Cancelling…' : 'Cancel'}</Text>
          </PressableCard>
        ) : null}
      </View>
    </PressableCard>
  );
}

// ─── Compact row ─────────────────────────────────────────────────────────────

export function CompactBookingRow({
  booking,
  role,
  onPress,
  now,
}: {
  booking: Booking;
  role: BookingRole;
  onPress: () => void;
  /** Current time (ms) from the screen's `useNow` — keeps render pure. */
  now: number;
}) {
  const cancelled = bookingPhase(booking, now) === 'cancelled';
  const H = CARD_W * 0.255;
  const avatar = H * 0.5;
  const chipH = CARD_W * 0.085;
  const chipW = CARD_W * 0.27;

  return (
    <PressableCard
      onPress={onPress}
      accessibilityLabel={cardLabel(booking, role, now)}
      style={[styles.row, { height: H, borderRadius: Math.min(RADIUS, H / 2) }]}
    >
      <ListingThumb uri={booking.listing?.photo_url} size={avatar} radius={avatar / 2} />
      <View style={styles.rowText}>
        <Text style={styles.rowAddress} numberOfLines={1}>
          {bookingAddress(booking)}
        </Text>
        <Text style={[styles.rowDate, { marginRight: chipW * 0.9 }]} numberOfLines={1}>
          {formatBookingRange(booking.start, booking.end)}
        </Text>
      </View>
      <View
        style={[
          styles.chip,
          { height: chipH, minWidth: chipW, bottom: H * 0.17, borderTopLeftRadius: chipH / 2, borderBottomLeftRadius: chipH / 2 },
        ]}
      >
        <Text style={[styles.chipText, cancelled && styles.chipTextMuted]}>
          {cancelled ? 'Cancelled' : money(bookingAmount(booking, role))}
        </Text>
      </View>
    </PressableCard>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    borderRadius: RADIUS,
    borderWidth: BORDER,
    borderColor: '#000000',
    overflow: 'hidden',
  },
  photoFallback: {
    backgroundColor: 'rgba(0,0,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbFallback: {
    backgroundColor: 'rgba(0,0,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 999,
    borderBottomLeftRadius: 999,
    paddingLeft: CARD_W * 0.05,
    paddingRight: CARD_W * 0.07,
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: CARD_W * 0.046,
    color: '#000000',
  },
  address: {
    marginTop: CARD_W * 0.04,
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: CARD_W * 0.052,
    color: '#000000',
  },
  date: {
    marginTop: CARD_W * 0.012,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: CARD_W * 0.036,
    color: '#000000',
  },
  priceRow: {
    marginTop: CARD_W * 0.03,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  priceCol: { flexShrink: 1 },
  price: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: CARD_W * 0.085,
    color: '#000000',
  },
  priceHint: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: CARD_W * 0.03,
    color: 'rgba(0,0,0,0.6)',
    marginTop: -CARD_W * 0.005,
  },
  msgCircle: {
    width: CARD_W * 0.11,
    height: CARD_W * 0.11,
    borderRadius: CARD_W * 0.055,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelPill: {
    height: CARD_W * 0.095,
    paddingHorizontal: CARD_W * 0.06,
    borderRadius: 999,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelPillText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: CARD_W * 0.04,
    color: '#FFFFFF',
  },
  row: {
    width: CARD_W,
    borderWidth: BORDER,
    borderColor: '#000000',
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: CARD_W * 0.04,
    gap: CARD_W * 0.04,
  },
  rowText: { flex: 1, justifyContent: 'center' },
  rowAddress: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: CARD_W * 0.047,
    color: '#000000',
    paddingRight: CARD_W * 0.04,
  },
  rowDate: {
    marginTop: CARD_W * 0.012,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: CARD_W * 0.032,
    color: '#000000',
  },
  chip: {
    position: 'absolute',
    right: 0,
    backgroundColor: '#FFFFFF',
    paddingLeft: CARD_W * 0.05,
    paddingRight: CARD_W * 0.05,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipText: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: CARD_W * 0.044,
    color: '#000000',
  },
  chipTextMuted: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: CARD_W * 0.036,
    color: 'rgba(0,0,0,0.55)',
  },
});
