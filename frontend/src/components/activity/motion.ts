/**
 * Shared motion primitives for the Activity / Seller Account screens.
 * Curves and spring shapes come from skills/animate-expo.
 */

import { useMemo } from 'react';
import * as Haptics from 'expo-haptics';
import { Easing, FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';

export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
// Menu bar leaving: starts slow, accelerates out of view.
export const EASE_IN_SLIDE = Easing.bezier(0.55, 0, 0.85, 0.3);
// Menu bar returning: arrives fast, settles slowly into place.
export const EASE_OUT_SLIDE = Easing.bezier(0.15, 0.7, 0.3, 1);

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
