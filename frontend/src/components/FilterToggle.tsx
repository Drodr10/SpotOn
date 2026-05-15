/**
 * FilterToggle — segmented control with a sliding pill (Figma 387-82).
 *
 * Two tags side-by-side; tapping either slides a black pill behind the
 * selected tag and animates the label colors (selected → white, other → black).
 *
 * Functional behavior is intentionally not wired yet — parent owns selected
 * state for future filter-listing integration.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  LayoutChangeEvent,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  interpolateColor,
  type SharedValue,
} from 'react-native-reanimated';

import { CustomFonts } from '@/src/constants/theme';
import { triggerLightHaptic } from '@/src/utils/haptics';

export interface FilterToggleProps {
  options: [string, string];
  value: number; // 0 or 1
  onChange: (next: number) => void;
  height?: number;
}

const ANIM_MS = 220;
const EASING = Easing.out(Easing.cubic);

export default function FilterToggle({
  options,
  value,
  onChange,
  height = 44,
}: FilterToggleProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const progress = useSharedValue(value); // 0 or 1, animated

  React.useEffect(() => {
    progress.value = withTiming(value, { duration: ANIM_MS, easing: EASING });
  }, [value, progress]);

  const onTrackLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  };

  const pillStyle = useAnimatedStyle(() => {
    const half = trackWidth / 2;
    return {
      transform: [{ translateX: progress.value * half }],
      width: half,
    };
  }, [trackWidth]);

  return (
    <View style={[styles.track, { height }]} onLayout={onTrackLayout}>
      {trackWidth > 0 && (
        <Animated.View
          style={[
            styles.pill,
            { height: height - 6, top: 3, borderRadius: (height - 6) / 2 },
            pillStyle,
          ]}
        />
      )}
      {options.map((label, i) => (
        <Pressable
          key={label}
          style={styles.tag}
          onPress={() => {
            // TODO: wire to listing filter
            triggerLightHaptic();
            onChange(i);
          }}
          hitSlop={6}
        >
          <ToggleLabel label={label} index={i} progress={progress} />
        </Pressable>
      ))}
    </View>
  );
}

function ToggleLabel({
  label,
  index,
  progress,
}: {
  label: string;
  index: number;
  progress: SharedValue<number>;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    // selected when progress ≈ index
    const t = 1 - Math.abs(progress.value - index); // 1 when selected, 0 when not
    const color = interpolateColor(t, [0, 1], ['#000000', '#FFFFFF']);
    return { color };
  }, [index]);

  return (
    <Animated.Text
      style={[styles.tagText, animatedStyle]}
      numberOfLines={1}
    >
      {label}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    width: '100%',
    backgroundColor: 'rgba(0,0,0,0.08)',
    borderRadius: 999,
    padding: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  pill: {
    position: 'absolute',
    left: 3,
    backgroundColor: '#000000',
  },
  tag: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  tagText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 15,
    letterSpacing: 0.2,
  },
});
