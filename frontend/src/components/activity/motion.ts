/**
 * Shared motion primitives for the Activity / Seller Account screens.
 * Curves and spring shapes come from skills/animate-expo.
 */

import { useMemo } from 'react';
import * as Haptics from 'expo-haptics';
import { Easing as RNEasing } from 'react-native';
import {
  Easing,
  FadeIn,
  FadeInDown,
  useReducedMotion,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
// Menu bar leaving: starts slow, accelerates out of view.
export const EASE_IN_SLIDE = Easing.bezier(0.55, 0, 0.85, 0.3);
// Menu bar returning: arrives fast, settles slowly into place.
export const EASE_OUT_SLIDE = Easing.bezier(0.15, 0.7, 0.3, 1);

/** Duration of a full bottom slide (menu bar, every bottom pop-up). */
export const SLIDE_MS = 650;
/** Same two curves for core `Animated` (react-native Easing). */
export const RN_EASE_IN_SLIDE = RNEasing.bezier(0.55, 0, 0.85, 0.3);
export const RN_EASE_OUT_SLIDE = RNEasing.bezier(0.15, 0.7, 0.3, 1);
/** Shortest a partial (drag-released) slide may take. */
export const SLIDE_MIN_MS = 250;

/** Duration for covering `distance` of a `total` travel: full travel = SLIDE_MS. */
export function slideDuration(distance: number, total: number): number {
  'worklet';
  if (total <= 0) return SLIDE_MS;
  const f = Math.min(1, Math.max(0, Math.abs(distance) / total));
  return Math.max(SLIDE_MIN_MS, SLIDE_MS * f);
}

/** Slide up into place (translateY -> 0) with the menu-bar curve. `total` = full hidden offset. */
export function slideIn(
  sv: SharedValue<number>,
  total: number,
  cb?: (finished?: boolean) => void,
) {
  'worklet';
  sv.set(withTiming(0, { duration: slideDuration(sv.get(), total), easing: EASE_OUT_SLIDE }, cb));
}

/** Slide down out of view (translateY -> target) with the menu-bar curve. */
export function slideOut(
  sv: SharedValue<number>,
  target: number,
  cb?: (finished?: boolean) => void,
) {
  'worklet';
  if (Math.abs(target - sv.get()) < 1) {
    // Already there (e.g. a drag-dismiss just finished): no second animation.
    sv.set(target);
    cb?.(true);
    return;
  }
  sv.set(
    withTiming(
      target,
      { duration: slideDuration(target - sv.get(), target), easing: EASE_IN_SLIDE },
      cb,
    ),
  );
}

/** Sheet / reposition springs (Apple designer parameters). */
export const SPRING_SHEET = { duration: 300, dampingRatio: 0.8 } as const;
export const SPRING_SETTLE = { duration: 300, dampingRatio: 1 } as const;

/** Where a flick would come to rest — Apple's deceleration projection. */
export function project(velocity: number, decelerationRate = 0.998): number {
  'worklet';
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Resistance past a boundary: the further you pull, the less the element follows. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  'worklet';
  const sign = overshoot < 0 ? -1 : 1;
  const o = Math.abs(overshoot);
  return (sign * (o * dimension * constant)) / (dimension + constant * o);
}

/**
 * Staggered entrance for a block at position `index` (30–80ms apart, capped so
 * long lists don't make the tail wait). Reduced motion keeps only a quick fade.
 */
export function useStaggerEntering(index: number) {
  const reduced = useReducedMotion();
  return useMemo(() => {
    if (reduced) return FadeIn.duration(150);
    return FadeInDown.duration(280)
      .delay(Math.min(index, 8) * 45)
      .easing(EASE_OUT);
  }, [index, reduced]);
}

export function hapticSuccess() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function hapticWarning() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

export function hapticMedium() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}
