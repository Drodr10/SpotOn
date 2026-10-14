/**
 * HourScroller — iOS-style 3D wheel number picker.
 *
 * Performance notes:
 *  - Backed by `Animated.FlatList` so only a small window of items mounts at
 *    any time (was rendering 96 items + 96 useAnimatedStyle worklets — that's
 *    what was causing the "buggy / gets stuck" feel).
 *  - Per-item style worklet reads a single shared value (`scrollY`) and runs
 *    on the UI thread; no JS hop while scrolling.
 *  - Index detection runs in the scroll worklet via a shared value compare;
 *    we only `runOnJS` to fire haptics + capture the pending value when the
 *    centered integer actually changes (not every 16ms scroll tick).
 *  - `useAnimatedScrollHandler` is wrapped in `useMemo` so the worklet isn't
 *    rebuilt every render.
 *  - `getItemLayout` lets FlatList skip per-item measurement.
 *  - 60fps target on mobile.
 */
import React, { useEffect, useMemo, useRef, useCallback } from 'react';
import {
  FlatList as RNFlatList,
  ListRenderItemInfo,
  Platform,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { CustomFonts } from '@/src/constants/theme';

const AnimatedFlatList = Animated.createAnimatedComponent(
  RNFlatList,
) as unknown as typeof RNFlatList;

export type HourScrollerRichLabel = { primary: string; secondary?: string };

export interface HourScrollerProps {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  format?: (value: number) => string;
  formatRich?: (value: number) => HourScrollerRichLabel;
  fontSize?: number;
  secondaryFontSize?: number;
  color?: string;
  visibleCount?: number;
  maxRotation?: number;
  style?: ViewStyle;
  /**
   * Fires when the user starts interacting with the wheel (drag begins).
   * Use this to lock a parent ScrollView's scroll so the page doesn't scroll
   * while the user is choosing a value.
   */
  onInteractionStart?: () => void;
  /**
   * Fires when interaction fully ends — after both drag release AND any
   * momentum-deceleration that follows.
   */
  onInteractionEnd?: () => void;
}

const PERSPECTIVE = 1000;

export default function HourScroller({
  value,
  onChange,
  min,
  max,
  format,
  formatRich,
  fontSize = 64,
  secondaryFontSize,
  color = '#000',
  visibleCount = 5,
  maxRotation = 55,
  style,
  onInteractionStart,
  onInteractionEnd,
}: HourScrollerProps) {
  const ITEM_HEIGHT = Math.round(fontSize * 1.35);
  const half = Math.floor(visibleCount / 2);
  const containerHeight = ITEM_HEIGHT * visibleCount;
  const resolvedSecondary = secondaryFontSize ?? Math.round(fontSize * 0.32);

  const items = useMemo(() => {
    const arr: number[] = [];
    for (let i = min; i <= max; i++) arr.push(i);
    return arr;
  }, [min, max]);

  const listRef = useRef<RNFlatList<number>>(null);
  const scrollY = useSharedValue((value - min) * ITEM_HEIGHT);
  // UI-thread copy of the last centered index — avoids JS<->UI hops on every scroll frame.
  const lastIdxSV = useSharedValue(value - min);
  // JS-side mirror for cross-render reads.
  const lastIndexRef = useRef(value - min);
  const pendingValueRef = useRef(value);

  // ─── External value sync ──────────────────────────────────────────────
  useEffect(() => {
    const targetIdx = value - min;
    if (targetIdx !== lastIndexRef.current) {
      listRef.current?.scrollToOffset({
        offset: targetIdx * ITEM_HEIGHT,
        animated: true,
      });
      lastIndexRef.current = targetIdx;
      lastIdxSV.value = targetIdx;
      pendingValueRef.current = value;
    }
  }, [value, min, ITEM_HEIGHT, lastIdxSV]);

  // ─── Index-changed JS callback (haptic + ref bookkeeping) ─────────────
  const onIndexChangedJS = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= items.length) return;
      lastIndexRef.current = idx;
      pendingValueRef.current = items[idx];
      Haptics.selectionAsync().catch(() => {});
    },
    [items],
  );

  // Rebuild only when ITEM_HEIGHT changes — keeps the worklet stable across
  // the many re-renders triggered by haptic-driven onChange calls upstream.
  const scrollHandler = useAnimatedScrollHandler(
    {
      onScroll: (e) => {
        'worklet';
        scrollY.value = e.contentOffset.y;
        const idx = Math.round(e.contentOffset.y / ITEM_HEIGHT);
        if (idx !== lastIdxSV.value) {
          lastIdxSV.value = idx;
          runOnJS(onIndexChangedJS)(idx);
        }
      },
    },
    [ITEM_HEIGHT, onIndexChangedJS],
  );

  // ─── Settle: nudge the scroll to exact integer offset (smooth glide) ──
  const settle = (offsetY: number) => {
    const idx = Math.round(offsetY / ITEM_HEIGHT);
    const target = idx * ITEM_HEIGHT;
    if (Math.abs(offsetY - target) > 0.5) {
      listRef.current?.scrollToOffset({ offset: target, animated: true });
    }
  };

  const commit = (e?: { nativeEvent?: { contentOffset?: { y?: number } } }) => {
    const offsetY = e?.nativeEvent?.contentOffset?.y;
    if (typeof offsetY === 'number') settle(offsetY);
    if (pendingValueRef.current !== value) {
      onChange(pendingValueRef.current);
    }
  };

  // ── Interaction lifecycle ──────────────────────────────────────────────
  // We can't tell at onScrollEndDrag whether momentum will follow, so we set
  // a short timer; if onMomentumScrollBegin fires first we cancel it.
  const momentumPendingRef = useRef(false);
  const endDragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Saved reference to the drag-end scroll event, used by the deferred commit.
  const endDragEventRef = useRef<
    { nativeEvent?: { contentOffset?: { y?: number } } } | undefined
  >(undefined);
  useEffect(() => {
    return () => {
      if (endDragTimerRef.current) clearTimeout(endDragTimerRef.current);
    };
  }, []);
  const handleScrollBeginDrag = () => {
    momentumPendingRef.current = false;
    if (endDragTimerRef.current) {
      clearTimeout(endDragTimerRef.current);
      endDragTimerRef.current = null;
    }
    onInteractionStart?.();
  };
  const handleMomentumScrollBegin = () => {
    momentumPendingRef.current = true;
    if (endDragTimerRef.current) {
      clearTimeout(endDragTimerRef.current);
      endDragTimerRef.current = null;
    }
  };
  const handleMomentumScrollEnd = (
    e: { nativeEvent?: { contentOffset?: { y?: number } } },
  ) => {
    momentumPendingRef.current = false;
    commit(e);
    onInteractionEnd?.();
  };
  const handleScrollEndDrag = (
    e: { nativeEvent?: { contentOffset?: { y?: number } } },
  ) => {
    // IMPORTANT: Do NOT call commit()/settle() here. Calling scrollToOffset(animated:true)
    // at this point can interrupt native momentum before it begins, which suppresses
    // onMomentumScrollEnd entirely and leaves onInteractionEnd() never called —
    // permanently locking the picker. Instead, save the event and defer commit
    // until we know whether momentum will follow.
    endDragEventRef.current = e;
    endDragTimerRef.current = setTimeout(() => {
      if (!momentumPendingRef.current) {
        // No momentum followed the drag — safe to settle and commit now.
        commit(endDragEventRef.current);
        onInteractionEnd?.();
      }
      // If momentum did start, onMomentumScrollEnd handles commit + unlock.
    }, 80);
  };

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<number>) => (
      <WheelItem
        index={index}
        value={item}
        scrollY={scrollY}
        ITEM_HEIGHT={ITEM_HEIGHT}
        half={half}
        maxRotation={maxRotation}
        fontSize={fontSize}
        secondaryFontSize={resolvedSecondary}
        color={color}
        format={format}
        formatRich={formatRich}
      />
    ),
    [
      scrollY,
      ITEM_HEIGHT,
      half,
      maxRotation,
      fontSize,
      resolvedSecondary,
      color,
      format,
      formatRich,
    ],
  );

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: ITEM_HEIGHT,
      offset: ITEM_HEIGHT * index,
      index,
    }),
    [ITEM_HEIGHT],
  );

  const keyExtractor = useCallback((item: number) => String(item), []);

  return (
    <View style={[styles.container, { height: containerHeight }, style]}>
      <AnimatedFlatList
        ref={listRef as any}
        data={items}
        keyExtractor={keyExtractor}
        renderItem={renderItem as any}
        getItemLayout={getItemLayout}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate={Platform.OS === 'ios' ? 'fast' : 0.95}
        // @ts-expect-error — Animated wrapper passes through; types narrow on TS strict
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onScrollBeginDrag={handleScrollBeginDrag}
        onMomentumScrollBegin={handleMomentumScrollBegin}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        onScrollEndDrag={handleScrollEndDrag}
        initialScrollIndex={value - min}
        contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * half }}
        windowSize={3}
        initialNumToRender={visibleCount + 2}
        maxToRenderPerBatch={visibleCount}
        removeClippedSubviews={false}
        bounces
        overScrollMode="auto"
        nestedScrollEnabled
        onScrollToIndexFailed={(info) => {
          // Should not fire (we provide getItemLayout) but keep a safe fallback.
          listRef.current?.scrollToOffset({
            offset: info.index * ITEM_HEIGHT,
            animated: false,
          });
        }}
      />

      {/* Selection band — subtle hairlines marking the centered slot. */}
      <View
        pointerEvents="none"
        style={[
          styles.selectionBand,
          { top: ITEM_HEIGHT * half, height: ITEM_HEIGHT },
        ]}
      />
    </View>
  );
}

// ─── WheelItem ──────────────────────────────────────────────────────────────
const WheelItem = React.memo(function WheelItem({
  index,
  value,
  scrollY,
  ITEM_HEIGHT,
  half,
  maxRotation,
  fontSize,
  secondaryFontSize,
  color,
  format,
  formatRich,
}: {
  index: number;
  value: number;
  scrollY: SharedValue<number>;
  ITEM_HEIGHT: number;
  half: number;
  maxRotation: number;
  fontSize: number;
  secondaryFontSize: number;
  color: string;
  format?: (value: number) => string;
  formatRich?: (value: number) => HourScrollerRichLabel;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const distance = (index * ITEM_HEIGHT - scrollY.value) / ITEM_HEIGHT;
    const absDist = Math.abs(distance);

    const rotateX = interpolate(
      distance,
      [-half, 0, half],
      [maxRotation, 0, -maxRotation],
      Extrapolation.CLAMP,
    );
    const opacity = interpolate(
      absDist,
      [0, half * 0.6, half],
      [1, 0.5, 0.1],
      Extrapolation.CLAMP,
    );
    const scale = interpolate(
      absDist,
      [0, half],
      [1, 0.72],
      Extrapolation.CLAMP,
    );

    return {
      opacity,
      transform: [
        { perspective: PERSPECTIVE },
        { rotateX: `${rotateX}deg` },
        { scale },
      ],
    };
  }, [index, ITEM_HEIGHT, half, maxRotation]);

  const rich = formatRich ? formatRich(value) : null;
  const plain = !formatRich && format ? format(value) : !formatRich ? String(value) : null;

  return (
    <Animated.View style={[styles.item, { height: ITEM_HEIGHT }, animatedStyle]}>
      {rich ? (
        <View style={styles.richRow}>
          <Text
            style={[
              styles.primary,
              { fontSize, color, lineHeight: fontSize * 1.0 },
            ]}
          >
            {rich.primary}
          </Text>
          {rich.secondary ? (
            <Text
              style={[
                styles.secondary,
                {
                  fontSize: secondaryFontSize,
                  color,
                  lineHeight: secondaryFontSize * 1.2,
                  marginLeft: Math.round(secondaryFontSize * 0.4),
                  marginBottom: Math.round(fontSize * 0.12),
                },
              ]}
            >
              {rich.secondary}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text
          style={[
            styles.primary,
            { fontSize, color, lineHeight: fontSize * 1.0 },
          ]}
        >
          {plain}
        </Text>
      )}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  item: {
    alignItems: 'center',
    justifyContent: 'center',
    backfaceVisibility: 'hidden',
  },
  richRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  primary: {
    fontFamily: CustomFonts.BevellierMedium,
    textAlign: 'center',
  },
  secondary: {
    fontFamily: CustomFonts.SwitzerLight,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  selectionBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.12)',
  },
});
