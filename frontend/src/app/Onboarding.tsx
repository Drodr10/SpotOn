/**
 * Onboarding - Multi-step new-user flow.
 * Steps 0-3: cream-white background, mockup phone constrained near the top
 *   (85% screen width, 10% top margin from screen height).
 * Step 4: signin background with full signup card.
 *
 * Cards use the QuickSearch floating style: ~80% chalk-grey fill, rounded,
 * margins from edges/bottom — onboarding cards additionally carry a stroke
 * (Figma calls for a visible outline). Steps 0-3 are a swipeable pager (see
 * IntroPager); Continue animates the same slide. Top-left back button mirrors
 * the search.tsx back pill and stays fixed while pages move.
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
  ScrollView,
  Linking,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHardwareBack } from '@/src/utils/navigation';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useReducedMotion,
  withSpring,
  withTiming,
  cancelAnimation,
  interpolateColor,
  Easing,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';

import { CustomFonts } from '@/src/constants/theme';
import { triggerLightHaptic, withLightHaptic } from '@/src/utils/haptics';
import { supabase } from '@/src/utils/supabase';
import { isValidEmail, normalizeEmail } from '@/src/utils/email';
import { isEmailInUseError } from '@/src/utils/passwordReset';

import signinBg from '@/assets/images/onboardingflow/onboarding.signin.png';
import mockup1 from '@/assets/images/onboardingflow/onboarding.mockup1.png';
import mockup2 from '@/assets/images/onboardingflow/onboarding.mockup2.png';
import mockup3 from '@/assets/images/onboardingflow/onboarding.mockup3.png';
import mockup4 from '@/assets/images/onboardingflow/onboarding.mockup4.png';
import spotonLogoAsset from '@/assets/images/spotonlogocircle.png';
import enterArrowAsset from '@/assets/images/enter_arrow.png';

const { width: SW, height: SH } = Dimensions.get('window');

// ── Tunable design tokens ──────────────────────────────────────────────────
const MOCKUP_WIDTH_PCT       = 0.85;                       // 85% of screen width
const MOCKUP_TOP_MARGIN_PCT  = 0.10;                       // 10% of screen height
const MOCKUP_WIDTH           = SW * MOCKUP_WIDTH_PCT;
const MOCKUP_TOP             = SH * MOCKUP_TOP_MARGIN_PCT;

const STROKE_WIDTH           = 2.0;                        // thicker stroke knob
const STROKE_COLOR           = 'rgba(0,0,0,1)';
const CARD_FILL              = 'rgba(220,219,216,0.80)';   // ~80% chalk grey (QuickSearch parity)
// Android draws a card's elevation shadow *underneath* its fill, so through an
// 80% fill the shadow shows as a lighter "box" inside darker edges. On the flat
// beige intro pages the fix is an opaque fill that looks identical:
// 80% chalk over the #F6F3F1 page = rgb(225,224,221). iOS keeps the real alpha.
const INTRO_BG               = '#F6F3F1';
const INTRO_CARD_FILL        = Platform.OS === 'android' ? 'rgb(225,224,221)' : CARD_FILL;
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
  // Index of the intro page to show, or STEPS.length for the sign-up form.
  const [step, setStep] = useState(0);

  if (step >= STEPS.length) {
    return <SignupStep onBack={() => setStep(STEPS.length - 1)} />;
  }

  return (
    <IntroPager
      initialIndex={step}
      onIndexChange={setStep}
      onFinish={() => setStep(STEPS.length)}
      onExit={() => router.back()}
    />
  );
}

// ── Intro pages (mockup + card), swipeable ──────────────────────────────────
// All pages sit side by side in one row that translates horizontally, so a
// page change never remounts anything (no blank frame between pages) and the
// row can follow the finger. The back pill is outside the row and stays put.
//
//  - Swipe left / Continue: next page. On the last page: same as Get Started.
//  - Swipe right / back pill: previous page. On the first page: leave
//    onboarding (same as the back pill).
//  - Past either end the row rubber-bands; it only commits if released past
//    the threshold (or flicked).
const SWIPE_COMMIT_FRACTION = 0.22;   // of screen width
const SWIPE_VELOCITY_PROJECTION = 0.18; // seconds of release velocity added
const PAGE_ANIM_MS = 320;

function rubberBand(overshoot: number) {
  'worklet';
  // iOS-style resistance: moves less the further it's pulled.
  const c = 0.55;
  const d = SW;
  const sign = overshoot < 0 ? -1 : 1;
  const x = Math.abs(overshoot);
  return sign * (1 - 1 / ((x * c) / d + 1)) * d;
}

function IntroPager({
  initialIndex,
  onIndexChange,
  onFinish,
  onExit,
}: {
  initialIndex: number;
  onIndexChange: (index: number) => void;
  onFinish: () => void;
  onExit: () => void;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const total = STEPS.length;
  const lastX = -(total - 1) * SW;

  const [index, setIndex] = useState(initialIndex);
  // Row offset in px: page i is fully on screen at x = -i * SW.
  const x = useSharedValue(-initialIndex * SW);
  const dragStartX = useSharedValue(0);

  // Entrance: content is drawn at full opacity from the very first frame
  // (no fade from 0 = no blank frame); it just settles up a little.
  const enterY = useSharedValue(reduceMotion ? 0 : 28);
  useEffect(() => {
    if (!reduceMotion) enterY.value = withSpring(0, { damping: 18, stiffness: 120 });
  }, []);

  const settle = useCallback(
    (next: number) => {
      setIndex(next);
      onIndexChange(next);
    },
    [onIndexChange],
  );

  // Called from the gesture (UI thread) once a swipe commits.
  const onSwipeCommit = useCallback(
    (target: number, from: number) => {
      if (target < 0) {
        triggerLightHaptic();
        onExit();
        return;
      }
      if (target >= total) {
        triggerLightHaptic();
        onFinish();
        return;
      }
      if (target !== from) {
        triggerLightHaptic();
        settle(target);
      }
    },
    [onExit, onFinish, settle, total],
  );

  const goTo = useCallback(
    (target: number) => {
      if (target < 0) {
        onExit();
        return;
      }
      if (target >= total) {
        // Get Started: slide the last page out to the left, then show the form.
        if (reduceMotion) {
          onFinish();
          return;
        }
        // A second tap restarts this; the cancelled run's callback has
        // done=false, so onFinish still fires once.
        x.value = withTiming(
          -total * SW,
          { duration: PAGE_ANIM_MS - 60, easing: Easing.in(Easing.cubic) },
          (done) => {
            if (done) runOnJS(onFinish)();
          },
        );
        return;
      }
      settle(target);
      if (reduceMotion) {
        x.value = -target * SW;
        return;
      }
      x.value = withTiming(-target * SW, {
        duration: PAGE_ANIM_MS,
        easing: Easing.out(Easing.cubic),
      });
    },
    [onExit, onFinish, reduceMotion, settle, total, x],
  );

  // Android back = the back pill: previous page, or leave onboarding on page 1.
  useHardwareBack(() => {
    goTo(index - 1);
    return true;
  });

  const pan = Gesture.Pan()
    // Horizontal only: vertical drags fail fast so they never fight scrolling.
    .activeOffsetX([-12, 12])
    .failOffsetY([-14, 14])
    .onStart(() => {
      cancelAnimation(x);
      dragStartX.value = x.value;
    })
    .onUpdate((e) => {
      const raw = dragStartX.value + e.translationX;
      if (raw > 0) x.value = rubberBand(raw);
      else if (raw < lastX) x.value = lastX + rubberBand(raw - lastX);
      else x.value = raw;
    })
    .onEnd((e) => {
      const from = Math.round(-dragStartX.value / SW);
      const projected = e.translationX + e.velocityX * SWIPE_VELOCITY_PROJECTION;
      let target = from;
      if (projected < -SW * SWIPE_COMMIT_FRACTION) target = from + 1;
      else if (projected > SW * SWIPE_COMMIT_FRACTION) target = from - 1;

      if (target < 0 || target >= total) {
        // Off either end: back out / Get Started. Spring the row home so it
        // isn't left dangling while the next screen takes over.
        x.value = withSpring(-from * SW, { damping: 22, stiffness: 220 });
        runOnJS(onSwipeCommit)(target, from);
        return;
      }
      const dest = -target * SW;
      x.value = reduceMotion
        ? dest
        : withSpring(dest, {
            damping: 26,
            stiffness: 230,
            mass: 0.9,
            velocity: e.velocityX,
            overshootClamping: true,
          });
      runOnJS(onSwipeCommit)(target, from);
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }));
  const enterStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: enterY.value }],
  }));

  return (
    <View style={[styles.screen, styles.introBg]}>
      <StatusBar style="dark" />

      <GestureDetector gesture={pan}>
        <Animated.View style={[StyleSheet.absoluteFill, enterStyle]}>
          <Animated.View style={[styles.pagerRow, { width: SW * total }, rowStyle]}>
            {STEPS.map((s, i) => (
              <IntroPage
                key={i}
                step={s}
                index={i}
                total={total}
                x={x}
                active={i === index}
                bottomInset={insets.bottom}
                onContinue={() => {
                  triggerLightHaptic();
                  goTo(i + 1);
                }}
              />
            ))}
          </Animated.View>
        </Animated.View>
      </GestureDetector>

      {/* Back pill: outside the swiping row so it stays fixed. Positioned from
          the safe-area context (known on the first frame) rather than a
          SafeAreaView, whose padding can land a frame late on Android. */}
      <View style={[styles.backWrap, { top: insets.top }]}>
        <TouchableOpacity
          style={styles.backPill}
          onPress={withLightHaptic(() => goTo(index - 1))}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={BACK_PILL_ICON} color="#000" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function IntroPage({
  step,
  index,
  total,
  x,
  active,
  bottomInset,
  onContinue,
}: {
  step: IntroStep;
  index: number;
  total: number;
  x: SharedValue<number>;
  active: boolean;
  bottomInset: number;
  onContinue: () => void;
}) {
  return (
    <View
      style={styles.page}
      // Only the visible page is reachable by screen readers.
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={!active}
    >
      <Image
        source={step.mockup}
        resizeMode="contain"
        style={styles.mockup}
        accessibilityIgnoresInvertColors
      />

      <View style={[styles.bottomPin, { paddingBottom: bottomInset + CARD_BOTTOM_MARGIN }]}>
        <View style={styles.cardShadow}>
          <View style={[styles.card, styles.introCardFill, styles.cardStroke]}>
            <View style={styles.headerRow}>
              <Image source={spotonLogoAsset} style={styles.headerLogo} resizeMode="contain" />
            </View>

            <Text style={styles.heading} accessibilityRole="header">
              {step.titlePre}
              <Text style={styles.italic}>{step.titleItalic}</Text>
              {step.titlePost ?? ''}
            </Text>

            <Text style={styles.body}>{step.body}</Text>

            <View style={styles.continueRow}>
              <TouchableOpacity
                style={styles.continueButton}
                activeOpacity={0.85}
                onPress={onContinue}
                accessibilityRole="button"
              >
                <Text style={styles.continueText}>
                  {index === total - 1 ? 'Get Started' : 'Continue'}
                </Text>
              </TouchableOpacity>
            </View>

            <View
              style={styles.dotsRow}
              accessible
              accessibilityLabel={`Page ${index + 1} of ${total}`}
            >
              {Array.from({ length: total }).map((_, i) => (
                <PageDot key={i} dot={i} x={x} />
              ))}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

// A page-indicator dot that tracks the row position, so it stretches and
// darkens continuously while the finger drags between pages.
function PageDot({ dot, x }: { dot: number; x: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const progress = -x.value / SW;
    const t = Math.max(0, 1 - Math.abs(progress - dot));
    return {
      width: 6 + 10 * t,
      backgroundColor: interpolateColor(t, [0, 1], ['rgba(0,0,0,0.25)', 'rgba(0,0,0,0.85)']),
    };
  });
  return <Animated.View style={[styles.dot, style]} />;
}

// ── Final signup step ───────────────────────────────────────────────────────
function SignupStep({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  // Android back returns to the last intro page, like the back pill.
  useHardwareBack(() => {
    onBack();
    return true;
  });
  // Bottom of the back pill plus a margin: the form never rises above this.
  const backClearance = insets.top + BACK_PILL_SIZE + BACK_PILL_MARGIN * 2;
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  // Set (to the normalized address) when sign-up says the email already has an
  // account: shows "Sign in instead" / "Reset password" under the error.
  const [inUseEmail, setInUseEmail] = useState('');
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
    const name = fullName.trim();
    if (!name || !email.trim() || !password) {
      setError('Please fill in all fields.');
      return;
    }
    if (!isValidEmail(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    setError('');
    setInUseEmail('');
    setLoading(true);
    const { error: err } = await supabase.auth.signUp({
      email: normalizeEmail(email),
      password,
      options: { data: { full_name: name } },
    });
    setLoading(false);
    if (err) {
      if (isEmailInUseError(err)) {
        setError('That email already has a SpotOn account.');
        setInUseEmail(normalizeEmail(email));
      } else if (err.message === 'Password should be at least 6 characters.')
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

      <View style={[styles.backWrap, { top: insets.top }]}>
        <TouchableOpacity
          style={styles.backPill}
          onPress={withLightHaptic(onBack)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={BACK_PILL_ICON} color="#000" />
        </TouchableOpacity>
      </View>

      <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[styles.kav, { paddingTop: backClearance }]}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
        >
          {/* Flow layout (not absolute) so KeyboardAvoidingView can push the card up.
              The scroll area starts below the back button: when the keyboard
              (plus the QuickType / password bar, an error line, a small phone)
              leaves too little room, the card scrolls instead of riding up
              over the back button. */}
          <ScrollView
            style={styles.formScroll}
            contentContainerStyle={styles.formScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <SafeAreaView edges={['bottom']} style={{ paddingBottom: CARD_BOTTOM_MARGIN, paddingHorizontal: CARD_SIDE_MARGIN }}>
              <Animated.View style={[styles.cardShadow, styles.cardShadowOverPhoto, cardAnimStyle]}>
                <View style={[styles.card, styles.cardStroke]}>
                  <View style={styles.headerRow}>
                    <Image source={spotonLogoAsset} style={styles.headerLogo} resizeMode="contain" />
                  </View>

                  <Text style={styles.heading}>
                    Making parking <Text style={styles.italic}>infinite</Text>. Let&apos;s get you started.
                  </Text>

                  {/* Uncontrolled on purpose (no `value` prop): nothing here ever
                      sets these fields programmatically, and without a JS-owned
                      value the native text can't be overwritten by a stale
                      state echo when input arrives faster than the JS thread
                      (autofill, the iOS strong-password sheet, a busy JS thread).
                      onChangeText still mirrors the text into state for submit. */}
                  <TextInput
                    style={styles.input}
                    defaultValue=""
                    onChangeText={setFullName}
                    placeholder="Name"
                    placeholderTextColor="rgba(0,0,0,0.45)"
                    autoCapitalize="words"
                    autoCorrect={false}
                    textContentType="name"
                    autoComplete="name"
                  />
                  <TextInput
                    style={styles.input}
                    defaultValue=""
                    onChangeText={(t) => {
                      setEmail(t);
                      // The actions below are for the address that was rejected.
                      if (inUseEmail) setInUseEmail('');
                    }}
                    placeholder="Email"
                    placeholderTextColor="rgba(0,0,0,0.45)"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="username"
                    autoComplete="email"
                  />
                  <View style={styles.passwordRow}>
                    <TextInput
                      style={[styles.input, { paddingRight: SW * 0.13, marginBottom: 0 }]}
                      defaultValue=""
                      onChangeText={setPassword}
                      placeholder="Password"
                      placeholderTextColor="rgba(0,0,0,0.45)"
                      secureTextEntry
                      // "newPassword" makes iOS suggest a strong password and offer
                      // to save it to the keychain on sign-up.
                      textContentType="newPassword"
                      autoComplete="new-password"
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
                      accessibilityRole="button"
                      accessibilityLabel="Sign up"
                      accessibilityState={{ disabled: loading }}
                    >
                      {/* The asset used to be "enter arrow.png": iOS didn't load
                          the image because of the space in its filename, so the
                          arrow was invisible there (Android was fine). Keep
                          asset filenames free of spaces. */}
                      <Image source={enterArrowAsset} style={styles.arrowIcon} resizeMode="contain" />
                    </TouchableOpacity>
                  </View>

                  {!!error && <Text style={styles.errorText}>{error}</Text>}

                  {!!inUseEmail && (
                    <View style={styles.inUseRow}>
                      <TouchableOpacity
                        style={[styles.inUseButton, styles.inUseButtonPrimary]}
                        activeOpacity={0.85}
                        onPress={withLightHaptic(() =>
                          router.push({ pathname: '/SignIn', params: { email: inUseEmail } }),
                        )}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.inUseText, styles.inUseTextPrimary]}>Sign in instead</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.inUseButton}
                        activeOpacity={0.85}
                        onPress={withLightHaptic(() =>
                          router.push({ pathname: '/ResetPassword', params: { email: inUseEmail } }),
                        )}
                        accessibilityRole="button"
                      >
                        <Text style={styles.inUseText}>Reset password</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  <Text style={styles.legalText}>
                    By signing up you agree to our{' '}
                    <Text style={styles.legalLink} onPress={() => Linking.openURL('https://spot-on.software/terms')}>
                      Terms
                    </Text>{' '}
                    and{' '}
                    <Text style={styles.legalLink} onPress={() => Linking.openURL('https://spot-on.software/privacy')}>
                      Privacy Policy
                    </Text>
                    .
                  </Text>
                </View>
              </Animated.View>
            </SafeAreaView>
          </ScrollView>
        </KeyboardAvoidingView>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  kav: { flex: 1, justifyContent: 'flex-end' },
  formScroll: { flex: 1 },
  formScrollContent: { flexGrow: 1, justifyContent: 'flex-end' },

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

  // Intro pager: one row of full-width pages that translates horizontally.
  introBg: { backgroundColor: INTRO_BG },
  pagerRow: { position: 'absolute', top: 0, bottom: 0, left: 0, flexDirection: 'row' },
  page: { width: SW, height: '100%' },
  // Floating mockup pinned near the top: 85% width, 10% top margin
  mockup: {
    position: 'absolute',
    top: MOCKUP_TOP,
    left: (SW - MOCKUP_WIDTH) / 2,
    width: MOCKUP_WIDTH,
    height: SH * 0.75,
  },
  // Bottom area — absolute pin so the card sits at the bottom
  bottomPin: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: CARD_SIDE_MARGIN,
  },

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
  introCardFill: { backgroundColor: INTRO_CARD_FILL },
  // Over the sign-in photo there's no single colour to make the fill opaque
  // with, so on Android the card drops its elevation instead (no shadow to
  // show through the 80% fill as a lighter box). The stroke still outlines it.
  cardShadowOverPhoto: Platform.OS === 'android' ? { elevation: 0 } : {},
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

  inUseRow: { flexDirection: 'row', gap: SW * 0.025, marginTop: SW * 0.03 },
  inUseButton: {
    flex: 1,
    height: INPUT_H * 0.85,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: STROKE_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inUseButtonPrimary: { backgroundColor: '#000' },
  inUseText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: SW * 0.034,
    color: '#000',
  },
  inUseTextPrimary: { color: '#FFFFFF' },

  legalText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: SW * 0.03,
    color: 'rgba(0,0,0,0.5)',
    marginTop: SW * 0.035,
    lineHeight: SW * 0.045,
  },
  legalLink: {
    color: 'rgba(0,0,0,0.75)',
    textDecorationLine: 'underline',
  },
});
