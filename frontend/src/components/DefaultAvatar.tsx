/**
 * DefaultAvatar — circular profile picture.
 *
 * Shows the remote image when `uri` is set; otherwise the shared placeholder
 * (car icon on a light disc) used by Profile and the MenuBar. If the image
 * fails to load (404, expired signed URL, offline) it falls back to the
 * placeholder; a new `uri` gets a fresh attempt.
 */
import React, { useState } from 'react';
import { View, Image, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface DefaultAvatarProps {
  size: number;
  uri?: string | null;
  style?: StyleProp<ViewStyle>;
}

export default function DefaultAvatar({ size, uri, style }: DefaultAvatarProps) {
  const circle = { width: size, height: size, borderRadius: size / 2 };
  // Remember which uri failed, so a changed uri is retried without an effect.
  const [failedUri, setFailedUri] = useState<string | null>(null);

  if (uri && uri !== failedUri) {
    return (
      <View
        style={[styles.base, circle, style]}
        accessible
        accessibilityRole="image"
        accessibilityLabel="Profile picture"
      >
        <Image source={{ uri }} style={circle} onError={() => setFailedUri(uri)} />
      </View>
    );
  }

  return (
    <View
      style={[styles.base, styles.placeholder, circle, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel="No profile picture"
    >
      <Ionicons name="car-sport" size={size * 0.5} color="#1A1A1A" />
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
  },
  placeholder: {
    backgroundColor: '#F2F1EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
