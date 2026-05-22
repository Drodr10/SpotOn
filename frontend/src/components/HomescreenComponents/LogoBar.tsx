import React from 'react';
import { View, Text, Image, StyleSheet, Dimensions } from 'react-native';

import { CustomFonts } from '@/src/constants/theme';

import spotonLogoAsset from '@/assets/images/spotonlogo.png';

const { width: screenWidth } = Dimensions.get('window');
const LOGO_SIZE = screenWidth * 0.15;
const FONT_SIZE = screenWidth * 0.06;
const GAP = screenWidth * 0.0001;

export default function LogoBar() {
  return (
    <View style={styles.row}>
      <Image source={spotonLogoAsset} style={styles.logo} resizeMode="contain" />
      <View style={styles.brandTextWrap}>
        <Text style={styles.brandText}>
          <Text style={styles.spotPart}>Spot</Text>
          <Text style={styles.onPart}>On</Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GAP,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    opacity: 1,
  },
  brandTextWrap: {
    height: LOGO_SIZE,
    justifyContent: 'center',
  },
  brandText: {
    fontSize: FONT_SIZE,
    lineHeight: FONT_SIZE,
    color: '#000000',
    includeFontPadding: false,
  },
  spotPart: {
    fontFamily: CustomFonts.SwitzerSemibold,
  },
  onPart: {
    fontFamily: CustomFonts.SwitzerLight,
  },
});
