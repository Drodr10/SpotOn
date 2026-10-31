/**
 * BottomSheet — in-screen dark sheet (Figma 787:122). Rendered as an overlay of
 * its screen (not a native Modal) so gestures and the global MenuBar behave.
 *
 *  - Opens/closes with the menu-bar slide (650ms, EASE_OUT_SLIDE up / EASE_IN_SLIDE down).
 *  - The header (grabber + title) is a pan handle: 1:1 tracking, rubber-band
 *    when pulled up, velocity-projected dismissal, velocity handed to the spring.
 *  - Backdrop opacity derives from the same translateY, so it can never desync.
 *  - Reduced motion: no travel, a short fade instead.
 *  - Android back button dismisses it.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CustomFonts } from '@/src/constants/theme';
import { triggerLightHaptic } from '@/src/utils/haptics';
import { project, rubberband, slideIn, slideOut } from './motion';
import { SW } from './layout';
import { SHEET_BOTTOM, SHEET_INSET, SHEET_RADIUS, sheetBottomPad } from '@/src/constants/sheet';

type Props = {
  visible: boolean;
  /** Request to close (backdrop tap, back button, drag-dismiss). The parent flips `visible`. */
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Fraction of the window height the sheet may occupy. */
  maxHeightRatio?: number;
};

export default function BottomSheet({
  visible,
  onClose,
  title,
  children,
  maxHeightRatio = 0.72,
}: Props) {
  const { height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();

  const [mounted, setMounted] = useState(visible);
  const ty = useSharedValue(H);
  const ctx = useSharedValue(0);
  const sheetH = useSharedValue(H * 0.5);
  const fade = useSharedValue(0);

  const unmount = useCallback(() => setMounted(false), []);

  // Mount as soon as we're asked to show (derived during render, not synced in an effect).
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      if (reduced) {
        ty.set(0);
        fade.set(withTiming(1, { duration: 150 }));
      } else {
        ty.set(H);
        slideIn(ty, H);
        fade.set(1);
      }
    } else if (reduced) {
      fade.set(withTiming(0, { duration: 150 }, (f) => {
        if (f) scheduleOnRN(unmount);
      }));
    } else {
      slideOut(ty, H, (f) => {
       'worklet';
        'worklet';
        if (f) scheduleOnRN(unmount);
      });
    }
  }, [visible, reduced, H, ty, fade, unmount]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-8, 8])
        .failOffsetX([-24, 24])
        .onStart(() => {
          ctx.set(ty.get());
        })
        .onUpdate((e) => {
          const next = ctx.get() + e.translationY;
          ty.set(next >= 0 ? next : rubberband(next, sheetH.get()));
        })
        .onEnd((e) => {
          const projected = ty.get() + project(e.velocityY);
          if (projected > sheetH.get() * 0.4) {
            slideOut(ty, H, (f) => {
              'worklet';
              if (f) scheduleOnRN(onClose);
            });
          } else {
            slideIn(ty, H);
            scheduleOnRN(triggerLightHaptic);
          }
        }),
    [H, onClose, ctx, ty, sheetH],
  );

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: reduced ? fade.get() : 1,
    transform: [{ translateY: reduced ? 0 : ty.get() }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: reduced
      ? fade.get()
      : interpolate(ty.get(), [0, H], [1, 0], Extrapolation.CLAMP),
  }));

  if (!mounted) return null;

  return (
    <View style={styles.overlay} pointerEvents='box-none'>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel='Close'
          accessibilityRole='button'
        />
      </Animated.View>

      <Animated.View
        onLayout={(e) => sheetH.set(e.nativeEvent.layout.height)}
        style={[
          styles.sheet,
          { bottom: SHEET_BOTTOM, maxHeight: H * maxHeightRatio },
          sheetStyle,
        ]}
        accessibilityViewIsModal
      >
        {Platform.OS === 'ios' && (
          <BlurView intensity={40} tint='dark' style={StyleSheet.absoluteFill} />
        )}
        <GestureDetector gesture={pan}>
          <View style={styles.handle} collapsable={false}>
            <View style={styles.grabber} />
            {!!title && <Text style={styles.title}>{title}</Text>}
          </View>
        </GestureDetector>
        {children}
        <View style={{ height: sheetBottomPad(insets.bottom) }} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 100, elevation: 100 },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    left: SHEET_INSET,
    right: SHEET_INSET,
    borderRadius: SHEET_RADIUS,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: '#000',
    backgroundColor: Platform.OS === 'ios' ? 'rgba(0,0,0,0.72)' : 'rgba(10,10,10,0.95)',
    overflow: 'hidden',
  },
  handle: {
    paddingTop: SW * 0.03,
    paddingBottom: SW * 0.03,
    paddingHorizontal: SW * 0.08,
  },
  grabber: {
    alignSelf: 'center',
    width: SW * 0.1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
    marginBottom: SW * 0.03,
  },
  title: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: SW * 0.038,
    lineHeight: SW * 0.052,
    color: 'rgba(255,255,255,0.9)',
  },
});
