/**
 * PressableCard — Pressable with a physical press: scale to 0.97 on press-in
 * (120ms, strong ease-out), spring back on release. Runs on the UI thread. With
 * reduced motion the scale is replaced by a slight dim.
 */

import React from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { triggerLightHaptic } from '@/src/utils/haptics';
import { EASE_OUT } from './motion';

type Props = {
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  disabled?: boolean;
  /** Skip the light haptic (e.g. when the handler fires its own). */
  silent?: boolean;
  hitSlop?: number;
  pressedScale?: number;
  accessibilityLabel?: string;
};

export default function PressableCard({
  onPress,
  style,
  children,
  disabled,
  silent,
  hitSlop,
  pressedScale = 0.97,
  accessibilityLabel,
}: Props) {
  const reduced = useReducedMotion();
  const p = useSharedValue(0);

  const animated = useAnimatedStyle(() => ({
    opacity: reduced ? 1 - 0.25 * p.get() : 1,
    transform: [{ scale: reduced ? 1 : 1 - (1 - pressedScale) * p.get() }],
  }));

  return (
    <Pressable
      disabled={disabled}
      hitSlop={hitSlop}
      pressRetentionOffset={16}
      accessibilityRole='button'
      accessibilityLabel={accessibilityLabel}
      onPressIn={() => p.set(withTiming(1, { duration: 120, easing: EASE_OUT }))}
      onPressOut={() => p.set(withSpring(0, { duration: 260, dampingRatio: 0.8 }))}
      onPress={() => {
        if (!silent) triggerLightHaptic();
        onPress?.();
      }}
    >
      <Animated.View style={[style, animated]}>{children}</Animated.View>
    </Pressable>
  );
}
