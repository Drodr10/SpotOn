/**
 * ChatActionsMenu — the small white panel that drops out from under the chat's
 * name pill (Figma 724:54, node 787:210 "Report User").
 *
 * It is absolutely positioned inside a wrapper that also contains the pill, and
 * is rendered *before* the pill in the tree so the pill paints over the panel's
 * top edge — the panel reads as sliding out from behind the pill.
 *
 * Motion (animate-expo / emil-design-eng):
 *  - Occasional interaction, so it gets a real animation, but it is still a
 *    menu the user opens on purpose: no overshoot.
 *  - Enter: spring (duration 300, dampingRatio 1) on opacity + scale 0.92 → 1 +
 *    a small translateY, with transform-origin at the TOP of the panel (where
 *    the pill is), so it grows out of its trigger instead of from its centre.
 *  - Exit: 120ms ease-out, faster than the entrance — dismissal should feel
 *    instant. Panel unmounts only when the exit finishes.
 *  - Only transform + opacity animate; all on the UI thread.
 *  - Reduced motion: opacity-only fade, no scale / translate.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { CustomFonts } from '@/src/constants/theme';

const { width: screenWidth } = Dimensions.get('window');

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

export interface ChatMenuItem {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  destructive?: boolean;
  onPress: () => void;
}

interface Props {
  open: boolean;
  /** Pill dimensions, so the panel can tuck behind it and match its width. */
  pillWidth: number;
  pillHeight: number;
  items: ChatMenuItem[];
}

/** Horizontal inset from the pill's edges — keeps the white from peeking round the pill's curved ends. */
const INSET = screenWidth * 0.025;
const ROW_HEIGHT = Math.max(48, screenWidth * 0.125);

/**
 * How far the panel hangs below the pill (two rows + padding). Android clips touch
 * hit-testing to a parent's bounds, so the pill wrapper and header must be given this
 * much extra (cancelled out with a negative margin) or the panel's rows can't be tapped.
 */
export const MENU_OVERHANG = ROW_HEIGHT * 2 + 24;

export default function ChatActionsMenu({ open, pillWidth, pillHeight, items }: Props) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const [mounted, setMounted] = useState(open);

  const unmount = useCallback(() => setMounted(false), []);

  // Mount as soon as we're asked to open (derived during render, not synced in an effect).
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open) {
      progress.set(
        reduced
          ? withTiming(1, { duration: 150, easing: EASE_OUT })
          : withSpring(1, { duration: 300, dampingRatio: 1 }),
      );
    } else {
      progress.set(
        withTiming(0, { duration: reduced ? 100 : 120, easing: EASE_OUT }, (finished) => {
          if (finished) scheduleOnRN(unmount);
        }),
      );
    }
  }, [open, reduced, progress, unmount]);

  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.get();
    if (reduced) return { opacity: p };
    return {
      opacity: Math.min(1, Math.max(0, p)),
      transform: [{ translateY: (1 - p) * -10 }, { scale: 0.92 + 0.08 * p }],
    };
  });

  if (!mounted || pillWidth <= 0) return null;

  const panelWidth = Math.max(pillWidth - INSET * 2, 0);
  // Tuck the top ~60% of the pill's height behind the pill.
  const overlap = pillHeight * 0.6;

  return (
    <Animated.View
      pointerEvents={open ? 'auto' : 'none'}
      style={[
        styles.panel,
        {
          top: pillHeight - overlap,
          left: INSET,
          width: panelWidth,
          paddingTop: overlap + 4,
          transformOrigin: '50% 0%',
        },
        animatedStyle,
      ]}
    >
      {items.map((item, i) => (
        <Pressable
          key={item.key}
          onPress={item.onPress}
          accessibilityRole="menuitem"
          accessibilityLabel={item.label}
          style={({ pressed }) => [
            styles.row,
            i > 0 && styles.rowDivider,
            pressed && styles.rowPressed,
          ]}
        >
          <Ionicons
            name={item.icon}
            size={screenWidth * 0.045}
            color={item.destructive ? '#C62828' : '#000'}
          />
          <Text
            style={[styles.label, item.destructive && styles.labelDestructive]}
            numberOfLines={1}
          >
            {item.label}
          </Text>
        </Pressable>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    paddingBottom: 6,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: screenWidth * 0.025,
    height: ROW_HEIGHT,
    paddingHorizontal: screenWidth * 0.04,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.12)',
  },
  rowPressed: { backgroundColor: 'rgba(0,0,0,0.05)' },
  label: {
    flexShrink: 1,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.04,
    color: '#000',
  },
  labelDestructive: { color: '#C62828' },
});
