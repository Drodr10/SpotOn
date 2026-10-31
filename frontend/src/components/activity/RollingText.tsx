/**
 * RollingText / LiveLabel — a ticking label whose digits roll (translateY on
 * the UI thread, 220ms strong ease-out) instead of snapping. Only the digit
 * that changed moves; letters and spaces are static.
 *
 * LiveLabel owns the 1s timer, so only this tiny subtree re-renders per tick.
 */

import React, { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { EASE_OUT } from './motion';
import { useNow } from './useNow';

const DIGIT = /[0-9]/;

type CharProps = { char: string; style: TextStyle; lineHeight: number; reduced: boolean };

const RollingChar = memo(function RollingChar({ char, style, lineHeight, reduced }: CharProps) {
  const [pair, setPair] = useState({ prev: char, cur: char });
  const last = useRef(char);
  const progress = useSharedValue(1);

  useEffect(() => {
    if (last.current === char) return;
    const prev = last.current;
    last.current = char;
    setPair({ prev, cur: char });
    if (reduced) {
      progress.set(1);
      return;
    }
    progress.set(0);
    progress.set(withTiming(1, { duration: 220, easing: EASE_OUT }));
  }, [char, reduced, progress]);

  const slide = useAnimatedStyle(() => ({
    transform: [{ translateY: -lineHeight * progress.get() }],
  }));

  const text = [style, { height: lineHeight, lineHeight }];
  return (
    <View style={{ height: lineHeight, overflow: 'hidden' }}>
      <Animated.View style={slide}>
        <Text style={text}>{pair.prev}</Text>
        <Text style={text}>{pair.cur}</Text>
      </Animated.View>
    </View>
  );
});

export function RollingText({ text, style }: { text: string; style: TextStyle }) {
  const reduced = useReducedMotion();
  const fontSize = style.fontSize ?? 14;
  const lineHeight = Math.round(fontSize * 1.25);
  const flat: TextStyle = { ...style, fontVariant: ['tabular-nums'] };
  return (
    <View style={styles.row} accessible accessibilityLabel={text}>
      {text.split('').map((c, i) =>
        DIGIT.test(c) ? (
          // Keyed from the right so a digit keeps its slot when the string grows/shrinks at the front.
          <RollingChar
            key={`d${text.length - i}`}
            char={c}
            style={flat}
            lineHeight={lineHeight}
            reduced={reduced}
          />
        ) : (
          <Text key={`s${text.length - i}`} style={[flat, { lineHeight, height: lineHeight }]}>
            {c === ' ' ? ' ' : c}
          </Text>
        ),
      )}
    </View>
  );
}

/** Ticks every second and renders `getLabel(now)` with rolling digits. */
export function LiveLabel({
  getLabel,
  style,
  intervalMs = 1000,
}: {
  getLabel: (now: number) => string;
  style: TextStyle;
  intervalMs?: number;
}) {
  const now = useNow(intervalMs);
  return <RollingText text={getLabel(now)} style={style} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
