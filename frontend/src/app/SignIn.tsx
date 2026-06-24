/**
 * SignIn - Email + password login.
 * Background: onboarding.signin.png. Floating QuickSearch-style card pinned to
 * the bottom with margins, springs up on mount, lifts above the keyboard.
 * Supabase mechanics preserved.
 *
 * ── TUNE ────────────────────────────────────────────────────────────────────
 *  STROKE_WIDTH        Card outline thickness (also use to thicken visually)
 *  STROKE_COLOR        Card outline color
 *  CARD_FILL           Card fill color/alpha (Figma calls for ~78-80%)
 *  CARD_BOTTOM_MARGIN  Distance from card bottom to screen edge
 *  CARD_SIDE_MARGIN    Card horizontal margin from screen edge
 *  CARD_RADIUS         Corner radius
 *  BACK_PILL_*         Top-left back button (matches search.tsx pill)
 * ───────────────────────────────────────────────────────────────────────────
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Keyboard,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { CustomFonts } from '@/src/constants/theme';
import { triggerLightHaptic, withLightHaptic } from '@/src/utils/haptics';
import { supabase } from '@/src/utils/supabase';

import signinBg from '@/assets/images/onboardingflow/onboarding.signin.png';
import spotonLogoAsset from '@/assets/images/spotonlogocircle.png';
import enterArrowAsset from '@/assets/images/enter arrow.png';

const { width: SW, height: SH } = Dimensions.get('window');

// ── Tunable design tokens ──────────────────────────────────────────────────
const STROKE_WIDTH        = 1.5;                          // thicker stroke knob
const STROKE_COLOR        = 'rgba(0,0,0,0.55)';
const CARD_FILL           = 'rgba(220,219,216,0.80)';     // ~80% chalk grey
const CARD_BOTTOM_MARGIN  = SH * 0.00;
const CARD_SIDE_MARGIN    = SW * 0.05;
const CARD_RADIUS         = SW * 0.085;                   // matches QuickSearch (40 on iPhone 12)
const CARD_PADDING_H      = SW * 0.055;
const CARD_PADDING_V      = SW * 0.05;

const INPUT_H             = Math.max(SW * 0.115, 44);
const INPUT_RADIUS        = INPUT_H / 2;

const BACK_PILL_SIZE      = SW * 0.115;
const BACK_PILL_FILL      = 'rgba(220,219,216,0.85)';
const BACK_PILL_ICON      = SW * 0.06;
const BACK_PILL_MARGIN    = SW * 0.04;

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Spring float-in animation
  const translateY = useSharedValue(SH * 0.45);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 450, easing: Easing.out(Easing.cubic) });
    translateY.value = withSpring(0, { damping: 14, stiffness: 90, mass: 0.9 });
  }, []);

  const cardAnimStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const handleLogin = async () => {
    triggerLightHaptic();
    if (!email || !password) {
      setError('Please fill in all fields.');
      return;
    }
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.replace('/QuickSearch');
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <ImageBackground source={signinBg} style={StyleSheet.absoluteFill} resizeMode="cover" />

      {/* Top-left back pill (matches search.tsx style) */}
      <SafeAreaView style={styles.backWrap} edges={['top']}>
        <TouchableOpacity
          style={styles.backPill}
          onPress={withLightHaptic(() => router.back())}
          activeOpacity={0.85}
        >
          <Ionicons name="arrow-back" size={BACK_PILL_ICON} color="#000" />
        </TouchableOpacity>
      </SafeAreaView>

      <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.kav}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
        >
          <SafeAreaView edges={['bottom']} style={{ paddingBottom: CARD_BOTTOM_MARGIN, paddingHorizontal: CARD_SIDE_MARGIN }}>
            <Animated.View style={[styles.cardShadow, cardAnimStyle]}>
              <View style={styles.card}>
                <View style={styles.headerRow}>
                  <Image source={spotonLogoAsset} style={styles.headerLogo} resizeMode="contain" />
                </View>

                <Text style={styles.heading}>
                  Making parking <Text style={styles.italic}>infinite</Text>. Let&apos;s sign you in.
                </Text>

                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email"
                  placeholderTextColor="rgba(0,0,0,0.45)"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                />

                <View style={styles.passwordRow}>
                  <TextInput
                    style={[styles.input, { paddingRight: SW * 0.13, marginBottom: 0 }]}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Password"
                    placeholderTextColor="rgba(0,0,0,0.45)"
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="go"
                    onSubmitEditing={handleLogin}
                  />
                  <TouchableOpacity
                    style={styles.arrowButton}
                    onPress={handleLogin}
                    activeOpacity={0.7}
                    disabled={loading}
                  >
                    <Image source={enterArrowAsset} style={styles.arrowIcon} resizeMode="contain" />
                  </TouchableOpacity>
                </View>

                {!!error && <Text style={styles.errorText}>{error}</Text>}
              </View>
            </Animated.View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  kav: { flex: 1, justifyContent: 'flex-end' },

  // Top-left back pill
  backWrap: { position: 'absolute', top: 0, left: 0, zIndex: 10 },
  backPill: {
    width: BACK_PILL_SIZE,
    height: BACK_PILL_SIZE,
    borderRadius: 999,
    backgroundColor: BACK_PILL_FILL,
    alignItems: 'center',
    justifyContent: 'center',
    margin: BACK_PILL_MARGIN,
  },

  // Card
  cardShadow: {
    width: '100%',
    borderRadius: CARD_RADIUS,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
    elevation: 12,
  },
  card: {
    width: '100%',
    backgroundColor: CARD_FILL,
    borderRadius: CARD_RADIUS,
    borderWidth: STROKE_WIDTH,
    borderColor: STROKE_COLOR,
    paddingHorizontal: CARD_PADDING_H,
    paddingTop: CARD_PADDING_V,
    paddingBottom: CARD_PADDING_V,
    overflow: 'hidden',
  },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SW * 0.025 },
  headerLogo: { width: SW * 0.07, height: SW * 0.07, opacity: 0.85 },

  heading: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: SW * 0.046,
    color: '#000',
    lineHeight: SW * 0.058,
    marginBottom: SW * 0.045,
  },
  italic: {
    fontFamily: CustomFonts.SwitzerSemiboldItalic,
  },

  input: {
    width: '100%',
    height: INPUT_H,
    backgroundColor: 'rgba(3,3,3,0.10)',
    borderRadius: INPUT_RADIUS,
    borderWidth: 1,
    borderColor: STROKE_COLOR,
    paddingHorizontal: SW * 0.045,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: SW * 0.038,
    color: '#000',
    marginBottom: SW * 0.028,
  },
  passwordRow: { position: 'relative', justifyContent: 'center' },
  arrowButton: {
    position: 'absolute',
    right: SW * 0.015,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SW * 0.02,
  },
  arrowIcon: { width: SW * 0.075, height: SW * 0.075 },

  errorText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: SW * 0.034,
    color: 'rgba(190,0,0,1)',
    marginTop: SW * 0.02,
  },
});
