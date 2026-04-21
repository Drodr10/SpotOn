/**
 * ProfilePill — Figma: "profile"
 *
 * Renders the user's avatar and username in a dark rounded pill,
 * displayed in the top-left of the HomeScreen header.
 */

// ─── React & React Native ────────────────────────────────────────────────────
import React from 'react';
import { View, Text, Image, StyleSheet, Dimensions, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';

// ─── Constants ───────────────────────────────────────────────────────────────
import { CustomFonts } from '@/src/constants/theme';

// ─── Assets ──────────────────────────────────────────────────────────────────
import homeIcon from '@/assets/images/homeicon.png';

// ─── Components ──────────────────────────────────────────────────────────────────
import LogoutButton from '@/src/components/logout-button';


// ─── Responsive sizing ───────────────────────────────────────────────────────
const { width: screenWidth } = Dimensions.get('window');
const FONT_SIZE   = screenWidth * 0.035;
const H_PAD       = screenWidth * 0.03;
const V_PAD       = screenWidth * 0.015;
const GAP         = screenWidth * 0.02;

// ─── Props ───────────────────────────────────────────────────────────────────
// ─── Component ───────────────────────────────────────────────────────────────
export default function HomePill() {
  return (
    <View style={styles.pill}>
      {/* Circular avatar */}
      <TouchableOpacity onPress={() => router.push('./Homescreen')}>
        <Image source={homeIcon} style={styles.icon} />
      </TouchableOpacity>
      {/* Username label */}
      <Text style={styles.username}>Home</Text>
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
  icon: {
    width: 30,
    height: 30,
  },
  username: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: FONT_SIZE,
    color: '#FFFFFF',
  },
});
