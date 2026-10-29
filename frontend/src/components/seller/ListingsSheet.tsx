/**
 * ListingsSheet — "Your listings currently on the marketplace" (Figma 787:122).
 *
 * Each row swipes left (UI-thread pan, 1:1 tracking, rubber-band at the limit):
 *  - a pink delete area is revealed; crossing the threshold ticks a selection
 *    haptic (and ticks again if you pull back), releasing past it asks for
 *    confirmation, then deactivates the listing (listings.is_active = false via
 *    the existing owner-update RLS policy).
 *  - listings that can't be removed safely (see `listingRemovalBlock`) get a
 *    capped, grey "locked" reveal that springs back, plus an explanation on tap.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  FadeOut,
  LinearTransition,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { CustomFonts } from '@/src/constants/theme';
import BottomSheet from '@/src/components/activity/BottomSheet';
import PressableCard from '@/src/components/activity/PressableCard';
import { ListingThumb } from '@/src/components/activity/BookingCards';
import { SW } from '@/src/components/activity/layout';
import {
  EASE_OUT,
  SPRING_SETTLE,
  SPRING_SHEET,
  hapticSuccess,
  hapticWarning,
  project,
  rubberband,
} from '@/src/components/activity/motion';
import { triggerSelectionHaptic } from '@/src/utils/haptics';
import { getPrimaryRate } from '@/src/utils/listingPrice';
import {
  listingRemovalBlock,
  type Booking,
  type BookingListing,
} from '@/src/utils/activity';

const ROW_W = SW * 0.89;
const ROW_H = ROW_W * 0.27;
const ROW_R = ROW_H * 0.46;
const REVEAL = ROW_W * 0.34;
const THRESHOLD = ROW_W * 0.3;
const LOCK_PEEK = ROW_W * 0.16;
const MAX_PULL = ROW_W * 0.6;

const ROW_LAYOUT = LinearTransition.duration(220);
const ROW_EXIT = FadeOut.duration(160);

export type RemoveResult = { ok: true } | { ok: false; message: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  listings: BookingListing[];
  bookings: Booking[];
  now: number;
  /** Re-verifies against fresh data, deactivates, and resolves with the outcome. */
  onRemove: (listing: BookingListing) => Promise<RemoveResult>;
  /** Called once the row has finished sliding away after a successful removal. */
  onRemoved: (listingId: string) => void;
};

function describe(l: BookingListing, bookings: Booking[], now: number) {
  const blockedReason = listingRemovalBlock(l.id, bookings, now);
  const mine = bookings.filter(
    (b) =>
      b.listingId === l.id &&
      b.status !== 'cancelled' &&
      b.payoutStatus !== 'pending_payment' &&
      b.payoutStatus !== 'refunded',
  );
  const upcoming = mine.filter((b) => b.end.getTime() > now).length;
  let caption: string;
  if (upcoming > 0) caption = `${upcoming} upcoming booking${upcoming === 1 ? '' : 's'}`;
  else if (blockedReason) caption = 'Has booking history';
  else if (l.created_at) {
    caption = `Listed ${new Date(l.created_at).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })}`;
  } else caption = 'Active on the marketplace';
  return { caption, blockedReason };
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function ListingRow({
  listing,
  caption,
  blockedReason,
  onRemove,
  onRemoved,
}: {
  listing: BookingListing;
  caption: string;
  blockedReason: string | null;
  onRemove: Props['onRemove'];
  onRemoved: Props['onRemoved'];
}) {
  const canRemove = blockedReason === null;
  const x = useSharedValue(0);
  const ctx = useSharedValue(0);
  const locked = useSharedValue(false);
  const [removing, setRemoving] = useState(false);

  const rate = getPrimaryRate(listing);
  const rateLabel = rate ? `$${rate.value.toFixed(2)}/${rate.unit}` : 'Active';

  const reset = useCallback(() => {
    locked.set(false);
    x.set(withSpring(0, SPRING_SETTLE));
  }, [locked, x]);

  const finishRemoval = useCallback(() => {
    hapticSuccess();
    onRemoved(listing.id);
  }, [listing.id, onRemoved]);

  const performRemoval = useCallback(async () => {
    setRemoving(true);
    const result = await onRemove(listing);
    setRemoving(false);
    if (result.ok) {
      x.set(
        withTiming(-ROW_W, { duration: 220, easing: EASE_OUT }, (f) => {
          if (f) scheduleOnRN(finishRemoval);
        }),
      );
    } else {
      hapticWarning();
      Alert.alert('Could not remove this listing', result.message);
      reset();
    }
  }, [finishRemoval, listing, onRemove, reset, x]);

  const requestRemoval = useCallback(() => {
    hapticWarning();
    Alert.alert(
      'Remove this listing?',
      `${listing.address} will stop showing up on the marketplace. You can list it again later by creating a new listing.`,
      [
        { text: 'Keep it', style: 'cancel', onPress: reset },
        { text: 'Remove', style: 'destructive', onPress: performRemoval },
      ],
      { cancelable: true, onDismiss: reset },
    );
  }, [listing.address, performRemoval, reset]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!removing)
        .activeOffsetX([-10, 10])
        .failOffsetY([-12, 12])
        .onStart(() => {
          ctx.set(x.get());
        })
        .onUpdate((e) => {
          if (locked.get()) return;
          const next = ctx.get() + e.translationX;
          const limit = canRemove ? MAX_PULL : LOCK_PEEK;
          if (next > 0) x.set(rubberband(next, ROW_W, 0.3));
          else if (next >= -limit) x.set(next);
          else x.set(-limit + rubberband(next + limit, ROW_W));
        })
        .onEnd((e) => {
          if (locked.get()) return;
          if (!canRemove) {
            x.set(withSpring(0, { ...SPRING_SETTLE, velocity: e.velocityX }));
            return;
          }
          const projected = x.get() + project(e.velocityX);
          if (x.get() < -THRESHOLD || projected < -ROW_W * 0.55) {
            locked.set(true);
            x.set(withSpring(-REVEAL, { ...SPRING_SETTLE, velocity: e.velocityX }));
            scheduleOnRN(requestRemoval);
          } else {
            x.set(withSpring(0, { ...SPRING_SHEET, velocity: e.velocityX }));
          }
        }),
    [canRemove, removing, requestRemoval, ctx, x, locked],
  );

  // One selection tick each time the finger crosses the threshold (either way).
  useAnimatedReaction(
    () => canRemove && !locked.get() && x.get() < -THRESHOLD,
    (crossed, prev) => {
      if (prev !== null && crossed !== prev) scheduleOnRN(triggerSelectionHaptic);
    },
  );

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const areaStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.get(), [0, -8], [0, 1], Extrapolation.CLAMP),
  }));
  const iconStyle = useAnimatedStyle(() => {
    const t = interpolate(x.get(), [-ROW_W * 0.12, -THRESHOLD], [0, 1], Extrapolation.CLAMP);
    return { opacity: t, transform: [{ scale: 0.6 + 0.4 * t }] };
  });

  return (
    <Animated.View layout={ROW_LAYOUT} exiting={ROW_EXIT} style={styles.rowWrap}>
      <Animated.View
        style={[styles.area, canRemove ? styles.areaDelete : styles.areaLocked, areaStyle]}
        pointerEvents='none'
      >
        <Animated.View style={[styles.areaIcon, iconStyle]}>
          <Ionicons
            name={canRemove ? 'trash-outline' : 'lock-closed-outline'}
            size={ROW_H * 0.38}
            color={canRemove ? '#7A1F1F' : 'rgba(0,0,0,0.55)'}
          />
        </Animated.View>
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>
          <PressableCard
            silent={!blockedReason}
            onPress={() => {
              if (blockedReason) Alert.alert('This listing can’t be removed yet', blockedReason);
            }}
            accessibilityLabel={`${listing.address}, ${rateLabel}. ${caption}. ${
              canRemove ? 'Swipe left to remove.' : 'Cannot be removed yet.'
            }`}
            style={styles.row}
          >
            <ListingThumb uri={listing.photo_url} size={ROW_H * 0.54} radius={ROW_H * 0.27} />
            <View style={styles.rowText}>
              <Text style={styles.address} numberOfLines={1}>
                {listing.address}
              </Text>
              <Text style={styles.caption} numberOfLines={1}>
                {caption}
              </Text>
            </View>
            <View style={styles.chip}>
              <Text style={styles.chipText}>{rateLabel}</Text>
            </View>
          </PressableCard>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

// ─── Sheet ───────────────────────────────────────────────────────────────────

export default function ListingsSheet({
  visible,
  onClose,
  listings,
  bookings,
  now,
  onRemove,
  onRemoved,
}: Props) {
  const rows = useMemo(
    () => listings.map((l) => ({ listing: l, ...describe(l, bookings, now) })),
    [listings, bookings, now],
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title='Your listings currently on the marketplace, swipe to remove them.'
      maxHeightRatio={0.7}
    >
      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>You haven’t posted any listings yet.</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces
        >
          {rows.map((r) => (
            <ListingRow
              key={r.listing.id}
              listing={r.listing}
              caption={r.caption}
              blockedReason={r.blockedReason}
              onRemove={onRemove}
              onRemoved={onRemoved}
            />
          ))}
        </ScrollView>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  scrollContent: {
    paddingHorizontal: (SW * 0.95 - ROW_W) / 2,
    paddingBottom: SW * 0.05,
    gap: SW * 0.03,
  },
  empty: { paddingHorizontal: SW * 0.06, paddingBottom: SW * 0.08 },
  emptyText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: SW * 0.04,
    color: 'rgba(255,255,255,0.7)',
  },
  rowWrap: { width: ROW_W, height: ROW_H },
  area: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    borderRadius: ROW_R,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  areaDelete: { backgroundColor: '#FCAFAF' },
  areaLocked: { backgroundColor: 'rgba(255,255,255,0.55)' },
  areaIcon: { width: REVEAL * 0.8, alignItems: 'center', justifyContent: 'center' },
  row: {
    width: ROW_W,
    height: ROW_H,
    borderRadius: ROW_R,
    borderWidth: 2,
    borderColor: '#000',
    backgroundColor: '#DCDBD8',
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: ROW_W * 0.04,
    gap: ROW_W * 0.035,
  },
  rowText: { flex: 1, justifyContent: 'center' },
  address: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: ROW_W * 0.045,
    color: '#000',
    paddingRight: ROW_W * 0.28,
  },
  caption: {
    marginTop: ROW_W * 0.01,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: ROW_W * 0.032,
    color: 'rgba(0,0,0,0.75)',
    paddingRight: ROW_W * 0.28,
  },
  chip: {
    position: 'absolute',
    right: 0,
    bottom: ROW_H * 0.16,
    height: ROW_W * 0.085,
    minWidth: ROW_W * 0.27,
    paddingHorizontal: ROW_W * 0.04,
    backgroundColor: '#fff',
    borderTopLeftRadius: 999,
    borderBottomLeftRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: ROW_W * 0.043,
    color: '#000',
  },
});
