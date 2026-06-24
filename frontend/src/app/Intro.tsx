/**
 * Intro - First screen on app launch (Figma 699-112).
 * Full-bleed onboarding.intro hero, small logo top-right, wordmark + tagline
 * bottom-left, with Sign Up (filled) and Sign In (outlined) pills.
 */

import React from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  ImageBackground,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CustomFonts } from '@/src/constants/theme';
import { withLightHaptic } from '@/src/utils/haptics';

import introBg from '@/assets/images/onboardingflow/onboarding.intro.png';
import spotonLogoAsset from '@/assets/images/spotonlogocircle.png';

const { width: SW, height: SH } = Dimensions.get('window');

export default function Intro() {
  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ImageBackground source={introBg} style={StyleSheet.absoluteFill} resizeMode="cover" />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* Top-right logo only */}
        <View style={styles.topBar}>
          <Image source={spotonLogoAsset} style={styles.cornerLogo} resizeMode="contain" />
        </View>

        <View style={styles.bottomBlock}>
          <Text style={styles.brand}>
            <Text style={styles.brandBold}>Spot</Text>
            <Text style={styles.brandLight}>On</Text>
          </Text>

          <Text style={styles.tagline}>Instant spots, easy earnings,{'\n'}the smartest way to park.</Text>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={withLightHaptic(() => router.push('/Onboarding'))}
              style={styles.signUpButton}
            >
              <Text style={styles.signUpText}>Sign Up</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={withLightHaptic(() => router.push('/SignIn'))}
              style={styles.signInButton}
            >
              <Text style={styles.signInText}>Sign In</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const H_PAD = SW * 0.06;
const BUTTON_HEIGHT = SH * 0.058;
const BUTTON_MIN_WIDTH = SW * 0.27;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  safe: { flex: 1, justifyContent: 'space-between' },

  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: H_PAD,
    paddingTop: SH * 0.005,
  },
  cornerLogo: { width: SW * 0.085, height: SW * 0.085, opacity: 0.95 },

  bottomBlock: {
    paddingHorizontal: H_PAD,
    paddingBottom: SH * 0.05,
  },
  brand: { color: '#FFFFFF', fontSize: SW * 0.085, letterSpacing: 0.3, marginBottom: SH * 0.012 },
  brandBold: { fontFamily: CustomFonts.SwitzerSemibold },
  brandLight: { fontFamily: CustomFonts.SwitzerLight },

  tagline: {
    color: '#FFFFFF',
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: SW * 0.042,
    lineHeight: SW * 0.054,
    marginBottom: SH * 0.025,
    opacity: 0.95,
  },

  buttonRow: { flexDirection: 'row', gap: 10 },

  signUpButton: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: SW * 0.07,
    height: BUTTON_HEIGHT,
    minWidth: BUTTON_MIN_WIDTH,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signUpText: {
    color: '#000',
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: SW * 0.04,
  },

  signInButton: {
    backgroundColor: 'rgba(255,255,255,0)',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    paddingHorizontal: SW * 0.07,
    height: BUTTON_HEIGHT,
    minWidth: BUTTON_MIN_WIDTH,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signInText: {
    color: '#FFFFFF',
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: SW * 0.04,
  },
});
