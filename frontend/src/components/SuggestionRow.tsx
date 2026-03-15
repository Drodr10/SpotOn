/**
 * SuggestionRow — Figma: single suggestion row
 *
 * Renders one destination suggestion with an icon on the left and location
 * name on the right. Icon is either a local image (building) or a vector
 * icon (emergency/hospital). Part of SuggestionsList.
 */

// ─── React & React Native ────────────────────────────────────────────────────
import React from 'react';
import { View, Text, Image, StyleSheet, Dimensions } from 'react-native';

// ─── Icons ───────────────────────────────────────────────────────────────────
import { Ionicons } from '@expo/vector-icons';

// ─── Constants ───────────────────────────────────────────────────────────────
import { CustomFonts } from '@/src/constants/theme';

// ─── Assets ──────────────────────────────────────────────────────────────────
import buildingIconAsset from '@/assets/images/templocationicon.png';

// ─── Responsive sizing ───────────────────────────────────────────────────────
const { width: screenWidth } = Dimensions.get('window');
const ICON_SIZE  = screenWidth * 0.065;  // ~26px
const FONT_SIZE  = screenWidth * 0.04;   // ~16px
const GAP        = screenWidth * 0.03;
const V_PAD      = screenWidth * 0.025;

// ─── Types ───────────────────────────────────────────────────────────────────
/** 'building' renders templocationicon.png; 'emergency' renders Ionicons medkit */
export type SuggestionIconType = 'building' | 'emergency';

export interface SuggestionRowProps {
  name: string;
  iconType: SuggestionIconType;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function SuggestionRow({ name, iconType }: SuggestionRowProps) {
  return (
    <View style={styles.row}>
      {/* Icon — Figma: "apartment" or "emergency" */}
      {iconType === 'building' ? (
        <Image source={buildingIconAsset} style={styles.iconImage} />
      ) : (
        <Ionicons name="medkit" size={ICON_SIZE} color="#000000" />
      )}
      {/* Location name */}
      <Text style={styles.name}>{name}</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: V_PAD,
    gap: GAP,
  },
  iconImage: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    resizeMode: 'contain',
  },
  name: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: FONT_SIZE,
    color: '#000000',
    flex: 1,
  },
});
