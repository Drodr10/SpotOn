/**
 * Onboarding - Multi-step new-user flow.
 * Steps 0-3: cream-white background, mockup phone constrained near the top
 *   (85% screen width, 10% top margin from screen height).
 * Step 4: signin background with full signup card.
 *
 * Cards use the QuickSearch floating style: ~80% chalk-grey fill, rounded,
 * margins from edges/bottom — onboarding cards additionally carry a stroke
 * (Figma calls for a visible outline). Slide animations between steps.
 * Top-left back button mirrors the search.tsx back pill.
 *
 * ── TUNE ────────────────────────────────────────────────────────────────────
 *  MOCKUP_WIDTH_PCT     Mockup phone width (% of screen width)
 *  MOCKUP_TOP_MARGIN_PCT Mockup distance from top (% of screen height)
 *  STROKE_WIDTH         Card outline thickness  ← thicken here
 *  STROKE_COLOR         Card outline color
 *  CARD_FILL            Card fill color/alpha (target ~80%)
 *  CARD_BOTTOM_MARGIN   Card distance from bottom safe area
 *  CARD_SIDE_MARGIN     Card horizontal margin from screen edge
 *  CARD_RADIUS          Card corner radius
 *  BACK_PILL_*          Top-left back pill (matches search.tsx)
 * ───────────────────────────────────────────────────────────────────────────
 */

import React, { useCallback, useEffect, useState } from 'react';
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
  runOnJS,
} from 'react-native-reanimated';

import { CustomFonts } from '@/src/constants/theme';
import { triggerLightHaptic, withLightHaptic } from '@/src/utils/haptics';
import { supabase } from '@/src/utils/supabase';

import signinBg from '@/assets/images/onboardingflow/onboarding.signin.png';
import mockup1 from '@/assets/images/onboardingflow/onboarding.mockup1.png';
import mockup2 from '@/assets/images/onboardingflow/onboarding.mockup2.png';
import mockup3 from '@/assets/images/onboardingflow/onboarding.mockup3.png';
import mockup4 from '@/assets/images/onboardingflow/onboarding.mockup4.png';
import spotonLogoAsset from '@/assets/images/spotonlogocircle.png';
import enterArrowAsset from '@/assets/images/enter arrow.png';

const { width: SW, height: SH } = Dimensions.get('window');

// ── Tunable design tokens ──────────────────────────────────────────────────
const MOCKUP_WIDTH_PCT       = 0.85;                       // 85% of screen width
const MOCKUP_TOP_MARGIN_PCT  = 0.10;                       // 10% of screen height
const MOCKUP_WIDTH           = SW * MOCKUP_WIDTH_PCT;
const MOCKUP_TOP             = SH * MOCKUP_TOP_MARGIN_PCT;

const STROKE_WIDTH           = 2.0;                        // thicker stroke knob
const STROKE_COLOR           = 'rgba(0,0,0,1)';
const CARD_FILL              = 'rgba(220,219,216,0.80)';   // ~80% chalk grey (QuickSearch parity)
const CARD_BOTTOM_MARGIN     = SH * 0.00;
const CARD_SIDE_MARGIN       = SW * 0.05;
const CARD_RADIUS            = SW * 0.11;                 // matches QuickSearch
const CARD_PADDING_H         = SW * 0.055;
const CARD_PADDING_V         = SW * 0.05;

const INPUT_H                = Math.max(SW * 0.115, 44);
const INPUT_RADIUS           = INPUT_H / 2;

const BACK_PILL_SIZE         = SW * 0.115;
const BACK_PILL_FILL         = 'rgba(220,219,216,0.85)';
const BACK_PILL_ICON         = SW * 0.06;
const BACK_PILL_MARGIN       = SW * 0.04;

type IntroStep = {
  mockup: any;
  titlePre: string;
  titleItalic: string;
  titlePost?: string;
  body: string;
};

const STEPS: IntroStep[] = [
  {
    mockup: mockup1,
    titlePre: 'Find parking ',
    titleItalic: 'anywhere',
    body:
      'Discover open parking spots posted by home owners and the community near your destination in seconds.',
  },
  {
    mockup: mockup2,
    titlePre: 'Reserve in a ',
    titleItalic: 'tap',
    titlePost: '.',
    body:
      'Lock in your space ahead of time with transparent pricing and instant confirmation.',
  },
  {
    mockup: mockup3,
    titlePre: 'Park on ',
    titleItalic: 'your',
    titlePost: ' terms.',
    body:
      'Book for hours, days, or even months. Find availability that fits your budget and schedule.',
  },
  {
    mockup: mockup4,
    titlePre: 'Turn your driveway into ',
    titleItalic: 'income',
    titlePost: '.',
    body:
      'Become a seller and list your unused space, set your own rates, and earn money while you’re away.',
  },
];

export default function Onboarding() {
  const [step, setStep] = useState(0);

  if (step >= STEPS.length) {
    return <SignupStep onBack={() => setStep(STEPS.length - 1)} />;
  }

  return (
    <IntroStepView
      key={step}
      step={STEPS[step]}
      index={step}
      total={STEPS.length}
      onContinue={() => {
        triggerLightHaptic();
        setStep((s) => s + 1);
      }}
      onBack={() => {
        if (step === 0) router.back();
        else setStep((s) => s - 1);
      }}
    />
  );
}

// ── Intro step (mockup + card) ──────────────────────────────────────────────
function IntroStepView({
  step,
  index,
  total,
  onContinue,
  onBack,
}: {
  step: IntroStep;
  index: number;
  total: number;
  onContinue: () => void;
  onBack: () => void;
}) {
  const mockupY = useSharedValue(40);
  const mockupOpacity = useSharedValue(0);
  const textX = useSharedValue(40);
  const textOpacity = useSharedValue(0);

  useEffect(() => {
    mockupY.value = withSpring(0, { damping: 16, stiffness: 95 });
    mockupOpacity.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) });
    textX.value = withSpring(0, { damping: 18, stiffness: 110 });
    textOpacity.value = withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) });
  }, []);

  const mockupStyle = useAnimatedStyle(() => ({
    opacity: mockupOpacity.value,
    transform: [{ translateY: mockupY.value }],
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateX: textX.value }],
  }));

  const handleContinue = useCallback(() => {
    mockupOpacity.value = withTiming(0, { duration: 220 });
    mockupY.value = withTiming(-30, { duration: 240, easing: Easing.in(Easing.cubic) });
    textOpacity.value = withTiming(0, { duration: 200 });
    textX.value = withTiming(-50, { duration: 220, easing: Easing.in(Easing.cubic) }, () => {
      runOnJS(onContinue)();
    });
  }, [onContinue]);

  return (
    <View style={[styles.screen, { backgroundColor: '#F6F3F1' }]}>
      <StatusBar style="dark" />

      {/* Floating mockup pinned near the top: 85% width, 10% top margin */}
      <Animated.Image
        source={step.mockup}
        resizeMode="contain"
        style={[
          {
            position: 'absolute',
            top: MOCKUP_TOP,
            left: (SW - MOCKUP_WIDTH) / 2,
            width: MOCKUP_WIDTH,
            height: SH * 0.75,
          },
          mockupStyle,
        ]}
      />

      {/* Top-left back pill */}
      <SafeAreaView style={styles.backWrap} edges={['top']}>
        <TouchableOpacity
          style={styles.backPill}
          onPress={withLightHaptic(onBack)}
          activeOpacity={0.85}
        >
          <Ionicons name="arrow-back" size={BACK_PILL_ICON} color="#000" />
        </TouchableOpacity>
      </SafeAreaView>

      {/* Bottom-pinned info card */}
      <SafeAreaView edges={['bottom']} style={styles.bottomSafe}>
        <Animated.View style={[styles.cardWrap, textStyle]}>
          <View style={styles.cardShadow}>
            <View style={[styles.card, styles.cardStroke]}>
              <View style={styles.headerRow}>
                <Image source={spotonLogoAsset} style={styles.headerLogo} resizeMode="contain" />
              </View>

              <Text style={styles.heading}>
                {step.titlePre}
                <Text style={styles.italic}>{step.titleItalic}</Text>
                {step.titlePost ?? ''}
              </Text>

              <Text style={styles.body}>{step.body}</Text>

              <View style={styles.continueRow}>
                <TouchableOpacity
                  style={styles.continueButton}
                  activeOpacity={0.85}
                  onPress={handleContinue}
                >
                  <Text style={styles.continueText}>
                    {index === total - 1 ? 'Get Started' : 'Continue'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.dotsRow}>
                {Array.from({ length: total }).map((_, i) => (
                  <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
                ))}
              </View>
            </View>
          </View>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

// ── Final signup step ───────────────────────────────────────────────────────
function SignupStep({ onBack }: { onBack: () => void }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

  const handleSignup = async () => {
    triggerLightHaptic();
    if (!fullName || !email || !password) {
      setError('Please fill in all fields.');
      return;
    }
    setLoading(true);
    const { error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    setLoading(false);
    if (err) {
      if (err.message === 'User already registered') setError('Email already in use.');
      else if (err.message === 'Password should be at least 6 characters.')
        setError('Password must be at least 6 characters.');
      else setError(err.message);
      return;
    }
    router.replace('/QuickSearch');
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <ImageBackground source={signinBg} style={StyleSheet.absoluteFill} resizeMode="cover" />

      <SafeAreaView style={styles.backWrap} edges={['top']}>
        <TouchableOpacity
          style={styles.backPill}
          onPress={withLightHaptic(onBack)}
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
          {/* Flow layout (not absolute) so KeyboardAvoidingView can push the card up. */}
          <SafeAreaView edges={['bottom']} style={{ paddingBottom: CARD_BOTTOM_MARGIN, paddingHorizontal: CARD_SIDE_MARGIN }}>
            <Animated.View style={[styles.cardShadow, cardAnimStyle]}>
              <View style={[styles.card, styles.cardStroke]}>
                <View style={styles.headerRow}>
                  <Image source={spotonLogoAsset} style={styles.headerLogo} resizeMode="contain" />
                </View>

                <Text style={styles.heading}>
                  Making parking <Text style={styles.italic}>infinite</Text>. Let&apos;s get you started.
                </Text>

                <TextInput
                  style={styles.input}
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="Name"
                  placeholderTextColor="rgba(0,0,0,0.45)"
                  autoCapitalize="words"
                  autoCorrect={false}
                />
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
                    onSubmitEditing={handleSignup}
                  />
                  <TouchableOpacity
                    style={styles.arrowButton}
                    onPress={handleSignup}
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
  screen: { flex: 1 },
  kav: { flex: 1, justifyContent: 'flex-end' },

  // Top-left back pill (search.tsx parity)
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

  // Bottom area — absolute pin so the card sits at the bottom (mockup/back are also absolute)
  bottomSafe: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: CARD_BOTTOM_MARGIN,
    paddingHorizontal: CARD_SIDE_MARGIN,
  },
  cardWrap: { width: '100%' },

  cardShadow: {
    width: '100%',
    borderRadius: CARD_RADIUS,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 22,
    elevation: 12,
  },
  card: {
    width: '100%',
    backgroundColor: CARD_FILL,
    borderRadius: CARD_RADIUS,
    paddingHorizontal: CARD_PADDING_H,
    paddingTop: CARD_PADDING_V,
    paddingBottom: CARD_PADDING_V,
    overflow: 'hidden',
  },
  cardStroke: {
    borderWidth: STROKE_WIDTH,
    borderColor: STROKE_COLOR,
  },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SW * 0.025 },
  headerLogo: { width: SW * 0.07, height: SW * 0.07, opacity: 0.85 },

  heading: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: SW * 0.046,
    color: '#000',
    lineHeight: SW * 0.058,
    marginBottom: SW * 0.03,
  },
  italic: {
    fontFamily: CustomFonts.SwitzerSemiboldItalic,
  },
  body: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: SW * 0.036,
    color: 'rgba(0,0,0,0.85)',
    lineHeight: SW * 0.05,
    marginBottom: SW * 0.05,
  },

  continueRow: { alignItems: 'center' },
  continueButton: {
    backgroundColor: '#000',
    paddingHorizontal: SW * 0.085,
    paddingVertical: SW * 0.03,
    borderRadius: 999,
    minWidth: SW * 0.4,
    alignItems: 'center',
  },
  continueText: {
    color: '#FFFFFF',
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: SW * 0.038,
  },

  dotsRow: { flexDirection: 'row', justifyContent: 'center', marginTop: SW * 0.04, gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.25)' },
  dotActive: { width: 16, backgroundColor: 'rgba(0,0,0,0.85)' },

  // Inputs
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
