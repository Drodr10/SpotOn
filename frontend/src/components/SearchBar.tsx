/**
 * SearchBar — Figma: "search bar"
 *
 * Renders a rounded search input row with a magnifying-glass icon on the left
 * and "Where to?" placeholder text. Displayed below the header on HomeScreen.
 * Currently static (no input handling) — connect to search logic when ready.
 */

// ─── React & React Native ────────────────────────────────────────────────────
import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';

// ─── Icons ───────────────────────────────────────────────────────────────────
import { Ionicons } from '@expo/vector-icons';

// ─── Constants ───────────────────────────────────────────────────────────────
import { CustomFonts } from '@/src/constants/theme';

// ─── Responsive sizing ───────────────────────────────────────────────────────
const { width: screenWidth } = Dimensions.get('window');
const H_PAD    = screenWidth * 0.04;
const V_PAD    = screenWidth * 0.03;
const FONT_SIZE = screenWidth * 0.04;   // ~16px
const ICON_SIZE = screenWidth * 0.055;  // ~22px
const GAP       = screenWidth * 0.025;

// ─── Component ───────────────────────────────────────────────────────────────
export default function SearchBar() {
  return (
    <View style={styles.container}>
      {/* Search icon — Figma: "explore icon" */}
      <Ionicons name="search" size={ICON_SIZE} color="rgba(0,0,0,0.75)" />
      {/* Placeholder text */}
      <Text style={styles.placeholder}>Where to?</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.75)',
    borderRadius: 999,
    paddingHorizontal: H_PAD,
    paddingVertical: V_PAD,
    gap: GAP,
    backgroundColor: 'transparent',
  },
  placeholder: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: FONT_SIZE,
    color: '#000000',
  },
});
