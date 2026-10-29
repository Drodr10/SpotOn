/**
 * CountUp — dollar amount that counts up from $0 on mount and glides to new
 * values. The text is written by a UI-thread worklet through animatedProps on a
 * read-only TextInput, so the JS thread never re-renders per frame.
 */

import React, { useEffect } from 'react';
import { Text, TextInput, type TextStyle } from 'react-native';
import Animated, {
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { EASE_OUT } from './motion';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export default function CountUp({
  value,
  style,
  duration = 750,
}: {
  /** null while loading. */
  value: number | null;
  style: TextStyle;
  duration?: number;
}) {
  if (value === null) {
    return (
      <Text style={style} accessibilityLabel='Loading'>
        —
      </Text>
    );
  }
  return <CountUpValue value={value} style={style} duration={duration} />;
}

function CountUpValue({
  value,
  style,
  duration,
}: {
  value: number;
  style: TextStyle;
  duration: number;
}) {
  const reduced = useReducedMotion();
  const decimals = Math.round(value * 100) % 100 === 0 ? 0 : 2;
  const current = useSharedValue(reduced ? value : 0);

  useEffect(() => {
    current.set(reduced ? value : withTiming(value, { duration, easing: EASE_OUT }));
  }, [value, reduced, duration, current]);

  const animatedProps = useAnimatedProps(() => {
    return { text: `$${current.get().toFixed(decimals)}` } as any;
  });

  const final = `$${value.toFixed(decimals)}`;
  return (
    <AnimatedTextInput
      editable={false}
      pointerEvents='none'
      underlineColorAndroid='transparent'
      defaultValue={reduced ? final : `$${(0).toFixed(decimals)}`}
      animatedProps={animatedProps}
      accessibilityLabel={final}
      style={[style, { padding: 0, margin: 0 }]}
    />
  );
}
