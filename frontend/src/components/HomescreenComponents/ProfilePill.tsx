/**
 * ProfilePill — Figma: "profile"
 *
 * Renders the user's avatar and username in a dark rounded pill,
 * displayed in the top-left of the HomeScreen header.
 */

// ─── React & React Native ────────────────────────────────────────────────────
import React from 'react'

import { View, Text, StyleSheet, Dimensions, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';

// ─── Constants ───────────────────────────────────────────────────────────────
import { CustomFonts } from '@/src/constants/theme';
import { withLightHaptic } from '@/src/utils/haptics';

import { useAvatarUrl } from '@/src/utils/avatar';

// ─── Components ──────────────────────────────────────────────────────────────────
import LogoutButton from '@/src/components/logout-button';
import DefaultAvatar from '@/src/components/DefaultAvatar';


// ─── Responsive sizing ───────────────────────────────────────────────────────
const { width: screenWidth } = Dimensions.get('window');
const AVATAR_SIZE = screenWidth * 0.075;   // ~30px on 390px screen
const FONT_SIZE   = screenWidth * 0.035;   // ~14px
const H_PAD       = screenWidth * 0.03;
const V_PAD       = screenWidth * 0.015;
const GAP         = screenWidth * 0.02;

// ─── Props ───────────────────────────────────────────────────────────────────
interface ProfilePillProps {
  username: string;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function ProfilePill({ username }: ProfilePillProps) {
  const avatarUrl = useAvatarUrl();
  return (
    <View style={styles.pill}>
      {/* Circular avatar */}
      <TouchableOpacity onPress={withLightHaptic(() => router.push('./Profile'))}>
        <DefaultAvatar size={AVATAR_SIZE} uri={avatarUrl} />
        </TouchableOpacity>
      {/* Username label */}
      <Text style={styles.username}>{username}</Text>
      {/* Logout button */}
      <LogoutButton />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 999,
    paddingHorizontal: H_PAD,
    paddingVertical: V_PAD,
    gap: GAP,
    alignSelf: 'flex-start',
  },
  username: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: FONT_SIZE,
    color: '#FFFFFF',
  },
});

