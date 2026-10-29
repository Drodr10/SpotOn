import React from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { useStaggerEntering } from './motion';

/** Staggered fade/rise-in for a block. Only for non-virtualized content. */
export default function Entrance({
  index,
  children,
  style,
}: {
  index: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const entering = useStaggerEntering(index);
  return (
    <Animated.View entering={entering} style={style}>
      {children}
    </Animated.View>
  );
}
