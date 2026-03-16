/**
 * PreviousSpotCard — Figma: "PreviousSpots Card"
 *
 * Renders a single card in the horizontal "Your Previous Spots" list.
 * Top half: map thumbnail image. Bottom half: dark info section with
 * location name, price + date, and parking duration.
 */

// ─── React & React Native ────────────────────────────────────────────────────
import React from 'react';
import { View, Text, Image, StyleSheet, Dimensions, ImageSourcePropType } from 'react-native';

// ─── Constants ───────────────────────────────────────────────────────────────
import { CustomFonts } from '@/src/constants/theme';

// ─── Responsive sizing ───────────────────────────────────────────────────────
const { width: screenWidth } = Dimensions.get('window');
// Card occupies ~48% of screen width; height maintains a ~1.3:1 ratio
const CARD_WIDTH  = screenWidth * 0.48;
const CARD_HEIGHT = CARD_WIDTH * 1.3;
const IMG_HEIGHT  = CARD_HEIGHT * 0.52;   // top ~half
const INFO_HEIGHT = CARD_HEIGHT * 0.48;   // bottom ~half

const FONT_NAME     = screenWidth * 0.04;   // ~16px — location name
const FONT_DETAIL   = screenWidth * 0.032;  // ~13px — price/date/duration
const INFO_H_PAD    = screenWidth * 0.03;
const INFO_V_PAD    = screenWidth * 0.025;
const LINE_GAP      = screenWidth * 0.01;

// ─── Props ───────────────────────────────────────────────────────────────────
export interface PreviousSpotCardProps {
  name: string;
  price: string;
  date: string;
  duration: string;
  mapImage: ImageSourcePropType;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function PreviousSpotCard({ name, price, date, duration, mapImage }: PreviousSpotCardProps) {
  return (
    <View style={styles.card}>
      {/* Top half — map thumbnail */}
      <Image source={mapImage} style={styles.mapImage} />

      {/* Bottom half — info section */}
      <View style={styles.info}>
        {/* Location name — Figma: SwitzerSemibold, white */}
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        {/* Price and date on one line — Figma: SwitzerLight, white */}
        <Text style={styles.detail}>{price} | {date}</Text>
        {/* Duration — Figma: SwitzerLight, white */}
        <Text style={styles.detail}>{duration}</Text>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  mapImage: {
    width: '100%',
    height: IMG_HEIGHT,
    resizeMode: 'cover',
  },
  info: {
    height: INFO_HEIGHT,
    backgroundColor: '#000000',
    paddingHorizontal: INFO_H_PAD,
    paddingVertical: INFO_V_PAD,
    justifyContent: 'center',
    gap: LINE_GAP,
  },
  name: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: FONT_NAME,
    color: '#FFFFFF',
  },
  detail: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: FONT_DETAIL,
    color: '#FFFFFF',
  },
});
