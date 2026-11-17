/**
 * ResetPassword - "Forgot password?" flow, reached from SignIn (and from
 * sign-up when the email already has an account).
 *
 * Three steps on one SignIn-style card (logic in utils/passwordReset.ts):
 *   1. email     → supabase.auth.resetPasswordForEmail. The confirmation is the
 *                  same whether or not the account exists.
 *   2. code      → the 6-digit code from the email, verifyOtp({ type: 'recovery' }).
 *                  That signs the user in.
 *   3. password  → updateUser({ password }), then on to QuickSearch like a
 *                  normal sign-in.
 *
 * Back (pill or Android system back) steps back through the flow. Leaving the
 * password step in-app without finishing signs the recovery session out again.
 * If the app is killed on the password step, the session survives and the user
 * is signed in on relaunch without having set a password — equivalent to an
 * emailed-code sign-in (the code proves inbox control), so accepted; they can
 * reset again any time.
 *
 * The email needs {{ .Token }} in the "Reset password" template — see
 * supabase/templates/recovery.html (hosted: paste it in the dashboard).
 */

import React, { useEffect, useRef, useState } from 'react';
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
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { isValidEmail, normalizeEmail } from '@/src/utils/email';
import { safeBack, useHardwareBack } from '@/src/utils/navigation';
import { registerForPushNotifications } from '@/src/utils/push';
import {
  type ResetStep,
  codeSentMessage,
  describeSendCodeError,
  describeUpdatePasswordError,
  describeVerifyError,
  isCompleteResetCode,
  previousResetStep,
  resendSecondsLeft,
  sanitizeResetCode,
  validateNewPassword,
} from '@/src/utils/passwordReset';

import signinBg from '@/assets/images/onboardingflow/onboarding.signin.png';
import spotonLogoAsset from '@/assets/images/spotonlogocircle.png';
import enterArrowAsset from '@/assets/images/enter_arrow.png';

const { width: SW, height: SH } = Dimensions.get('window');

// ── Design tokens (SignIn parity) ──────────────────────────────────────────
const STROKE_WIDTH        = 1.5;
const STROKE_COLOR        = 'rgba(0,0,0,0.55)';
const CARD_FILL           = 'rgba(220,219,216,0.80)';
const CARD_SIDE_MARGIN    = SW * 0.05;
const CARD_RADIUS         = SW * 0.085;
const CARD_PADDING_H      = SW * 0.055;
const CARD_PADDING_V      = SW * 0.05;

const INPUT_H             = Math.max(SW * 0.115, 44);
const INPUT_RADIUS        = INPUT_H / 2;

const BACK_PILL_SIZE      = SW * 0.115;
const BACK_PILL_FILL      = 'rgba(220,219,216,0.85)';
const BACK_PILL_ICON      = SW * 0.06;
const BACK_PILL_MARGIN    = SW * 0.04;

const PLACEHOLDER         = 'rgba(0,0,0,0.45)';

export default function ResetPassword() {
  const insets = useSafeAreaInsets();
  const backClearance = insets.top + BACK_PILL_SIZE + BACK_PILL_MARGIN * 2;
  const params = useLocalSearchParams<{ email?: string }>();
  const initialEmail = typeof params.email === 'string' ? params.email : '';

  const [step, setStep] = useState<ResetStep>('email');
  // Text mirrored from the (uncontrolled) inputs.
  const [emailText, setEmailText] = useState(initialEmail);
  const [codeText, setCodeText] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  // The normalized address the code was sent to.
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Refs for the unmount cleanup and to stop a double submit (auto-verify on
  // the 6th digit racing the arrow button).
  const busy = useRef(false);
  const stepRef = useRef<ResetStep>('email');
  const done = useRef(false);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  // Leaving the screen mid password-step (iOS swipe back, etc.): drop the
  // recovery session. Local scope only — other devices stay signed in.
  useEffect(() => {
    return () => {
      if (stepRef.current === 'password' && !done.current) {
        supabase.auth.signOut({ scope: 'local' });
      }
    };
  }, []);

  const secondsLeft = resendSecondsLeft(sentAt, now);
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [secondsLeft > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Card float-in (SignIn parity)
  const translateY = useSharedValue(SH * 0.45);
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withTiming(1, { duration: 450, easing: Easing.out(Easing.cubic) });
    translateY.value = withSpring(0, { damping: 14, stiffness: 90, mass: 0.9 });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cardAnimStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const goTo = (next: ResetStep) => {
    setError('');
    setStep(next);
  };

  const goBack = () => {
    const prev = previousResetStep(step);
    if (!prev) {
      safeBack('/SignIn');
      return;
    }
    if (step === 'password') supabase.auth.signOut({ scope: 'local' });
    setCodeText('');
    setPassword('');
    setConfirm('');
    goTo(prev);
  };

  useHardwareBack(() => {
    if (step === 'email') return false;
    goBack();
    return true;
  });

  // Step 1 (and "Resend code")
  const sendCode = async (address: string, isResend: boolean) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError('');
    const { error: err } = await supabase.auth.resetPasswordForEmail(address);
    busy.current = false;
    setLoading(false);
    const message = describeSendCodeError(err);
    if (message) {
      setError(message);
      return;
    }
    setEmail(address);
    setSentAt(Date.now());
    setNow(Date.now());
    if (!isResend) {
      setCodeText('');
      goTo('code');
    }
  };

  const handleSendCode = () => {
    triggerLightHaptic();
    Keyboard.dismiss();
    const normalized = normalizeEmail(emailText);
    if (!normalized) {
      setError('Please enter your email.');
      return;
    }
    if (!isValidEmail(normalized)) {
      setError('Please enter a valid email address.');
      return;
    }
    sendCode(normalized, false);
  };

  const handleResend = () => {
    if (secondsLeft > 0 || loading) return;
    triggerLightHaptic();
    sendCode(email, true);
  };

  // Step 2
  const verifyCode = async (raw: string) => {
    if (busy.current) return;
    const token = sanitizeResetCode(raw);
    if (!isCompleteResetCode(token)) {
      setError('Enter the 6-digit code from the email.');
      return;
    }
    busy.current = true;
    Keyboard.dismiss();
    setLoading(true);
    setError('');
    const { error: err } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
    busy.current = false;
    setLoading(false);
    if (err) {
      setError(describeVerifyError(err));
      return;
    }
    setPassword('');
    setConfirm('');
    goTo('password');
  };

  const handleCodeChange = (text: string) => {
    setCodeText(text);
    if (error) setError('');
    // Verify as soon as the 6th digit lands (typed, pasted or autofilled).
    if (isCompleteResetCode(text) && sanitizeResetCode(text) !== sanitizeResetCode(codeText)) {
      verifyCode(text);
    }
  };

  // Step 3
  const handleSetPassword = async () => {
    triggerLightHaptic();
    if (busy.current) return;
    const invalid = validateNewPassword(password, confirm);
    if (invalid) {
      setError(invalid);
      return;
    }
    busy.current = true;
    setLoading(true);
    setError('');
    const { error: err } = await supabase.auth.updateUser({ password });
    busy.current = false;
    setLoading(false);
    if (err) {
      setError(describeUpdatePasswordError(err));
      return;
    }
    done.current = true;
    Keyboard.dismiss();
    // verifyOtp reports PASSWORD_RECOVERY, not SIGNED_IN, so the root layout's
    // push registration didn't run. Do it here, as a sign-in would have.
    registerForPushNotifications();
    // Drop Intro/SignIn from the stack so Android back can't return to them.
    if (router.canDismiss()) router.dismissAll();
    router.replace('/QuickSearch');
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <ImageBackground source={signinBg} style={StyleSheet.absoluteFill} resizeMode="cover" />

      <SafeAreaView style={styles.backWrap} edges={['top']}>
        <TouchableOpacity
          style={styles.backPill}
          onPress={withLightHaptic(goBack)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={BACK_PILL_ICON} color="#000" />
        </TouchableOpacity>
      </SafeAreaView>

      <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[styles.kav, { paddingTop: backClearance }]}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
        >
          <ScrollView
            style={styles.formScroll}
            contentContainerStyle={styles.formScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <SafeAreaView edges={['bottom']} style={{ paddingHorizontal: CARD_SIDE_MARGIN }}>
              <Animated.View style={[styles.cardShadow, cardAnimStyle]}>
                <View style={styles.card}>
                  <View style={styles.headerRow}>
                    <Image source={spotonLogoAsset} style={styles.headerLogo} resizeMode="contain" />
                  </View>

                  {step === 'email' && (
                    <>
                      <Text style={styles.heading}>
                        Forgot your password? Let&apos;s get you <Text style={styles.italic}>back</Text> in.
                      </Text>
                      <Text style={styles.body}>
                        Enter your account email and we&apos;ll send you a code to reset your password.
                      </Text>
                      <View style={styles.inputRow}>
                        {/* Uncontrolled (defaultValue) like sign-up: autofill
                            can't be overwritten by a stale state echo. */}
                        <TextInput
                          key="email"
                          style={[styles.input, styles.inputWithArrow]}
                          defaultValue={emailText}
                          onChangeText={(t) => {
                            setEmailText(t);
                            if (error) setError('');
                          }}
                          placeholder="Email"
                          placeholderTextColor={PLACEHOLDER}
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="email-address"
                          textContentType="username"
                          autoComplete="email"
                          returnKeyType="send"
                          onSubmitEditing={handleSendCode}
                          autoFocus={!initialEmail}
                          accessibilityLabel="Email"
                        />
                        <SubmitArrow onPress={handleSendCode} loading={loading} label="Send code" />
                      </View>
                    </>
                  )}

                  {step === 'code' && (
                    <>
                      <Text style={styles.heading}>
                        Check your <Text style={styles.italic}>email</Text>.
                      </Text>
                      <Text style={styles.body}>{codeSentMessage(email)}</Text>
                      <View style={styles.inputRow}>
                        <TextInput
                          key="code"
                          // No letterSpacing here (or on any TextInput): iOS Fabric
                          // recycles the native text field, and the kerning stuck
                          // to whichever input reused it next — e.g. QuickSearch's
                          // placeholder rendered "W h e r e  A r e …" after a reset.
                          style={[styles.input, styles.inputWithArrow]}
                          defaultValue=""
                          onChangeText={handleCodeChange}
                          placeholder="6-digit code"
                          placeholderTextColor={PLACEHOLDER}
                          keyboardType="number-pad"
                          textContentType="oneTimeCode"
                          autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
                          autoCorrect={false}
                          autoFocus
                          returnKeyType="done"
                          onSubmitEditing={() => verifyCode(codeText)}
                          accessibilityLabel="6-digit code"
                        />
                        <SubmitArrow
                          onPress={() => {
                            triggerLightHaptic();
                            verifyCode(codeText);
                          }}
                          loading={loading}
                          label="Verify code"
                        />
                      </View>
                      <View style={styles.linkRow}>
                        <TouchableOpacity
                          onPress={handleResend}
                          disabled={secondsLeft > 0 || loading}
                          accessibilityRole="button"
                          accessibilityState={{ disabled: secondsLeft > 0 || loading }}
                          hitSlop={8}
                        >
                          <Text style={[styles.link, (secondsLeft > 0 || loading) && styles.linkDisabled]}>
                            {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={withLightHaptic(goBack)}
                          accessibilityRole="button"
                          hitSlop={8}
                        >
                          <Text style={styles.link}>Use a different email</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}

                  {step === 'password' && (
                    <>
                      <Text style={styles.heading}>
                        Choose a <Text style={styles.italic}>new</Text> password.
                      </Text>
                      {/* Read-only username field: lets iOS / Android pair the
                          new password with the account when offering to save it. */}
                      <TextInput
                        key="account"
                        style={[styles.input, styles.inputReadOnly]}
                        defaultValue={email}
                        editable={false}
                        textContentType="username"
                        autoComplete="email"
                        accessibilityLabel="Account email"
                      />
                      <TextInput
                        key="new-password"
                        style={styles.input}
                        defaultValue=""
                        onChangeText={(t) => {
                          setPassword(t);
                          if (error) setError('');
                        }}
                        placeholder="New password"
                        placeholderTextColor={PLACEHOLDER}
                        secureTextEntry
                        textContentType="newPassword"
                        autoComplete="new-password"
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoFocus
                        returnKeyType="next"
                        accessibilityLabel="New password"
                      />
                      <View style={styles.inputRow}>
                        <TextInput
                          key="confirm-password"
                          style={[styles.input, styles.inputWithArrow]}
                          defaultValue=""
                          onChangeText={(t) => {
                            setConfirm(t);
                            if (error) setError('');
                          }}
                          placeholder="Confirm new password"
                          placeholderTextColor={PLACEHOLDER}
                          secureTextEntry
                          textContentType="newPassword"
                          autoComplete="new-password"
                          autoCapitalize="none"
                          autoCorrect={false}
                          returnKeyType="go"
                          onSubmitEditing={handleSetPassword}
                          accessibilityLabel="Confirm new password"
                        />
                        <SubmitArrow onPress={handleSetPassword} loading={loading} label="Save new password" />
                      </View>
                    </>
                  )}

                  {!!error && (
                    <Text style={styles.errorText} accessibilityLiveRegion="polite">
                      {error}
                    </Text>
                  )}
                </View>
              </Animated.View>
            </SafeAreaView>
          </ScrollView>
        </KeyboardAvoidingView>
      </Pressable>
    </View>
  );
}

// The arrow inside the last input of each step (SignIn parity); a spinner while busy.
function SubmitArrow({ onPress, loading, label }: { onPress: () => void; loading: boolean; label: string }) {
  return (
    <TouchableOpacity
      style={styles.arrowButton}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: loading, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator color="#000" style={styles.arrowIcon} />
      ) : (
        <Image source={enterArrowAsset} style={styles.arrowIcon} resizeMode="contain" />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  formScroll: { flex: 1 },
  formScrollContent: { flexGrow: 1, justifyContent: 'flex-end' },

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

  cardShadow: {
    width: '100%',
    borderRadius: CARD_RADIUS,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
    // No elevation on Android: it draws the shadow under the 80% fill, which
    // shows through as a lighter "box" inside the card. The stroke outlines it.
    elevation: Platform.OS === 'android' ? 0 : 12,
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
    marginBottom: SW * 0.025,
  },
  italic: { fontFamily: CustomFonts.SwitzerSemiboldItalic },
  body: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: SW * 0.036,
    color: 'rgba(0,0,0,0.85)',
    lineHeight: SW * 0.05,
    marginBottom: SW * 0.04,
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
  inputWithArrow: { paddingRight: SW * 0.13, marginBottom: 0 },
  inputReadOnly: { color: 'rgba(0,0,0,0.55)', backgroundColor: 'rgba(3,3,3,0.05)' },
  inputRow: { position: 'relative', justifyContent: 'center' },
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

  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: SW * 0.035,
    paddingHorizontal: SW * 0.01,
  },
  link: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: SW * 0.034,
    color: 'rgba(0,0,0,0.8)',
    textDecorationLine: 'underline',
  },
  linkDisabled: { color: 'rgba(0,0,0,0.4)', textDecorationLine: 'none' },

  errorText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: SW * 0.034,
    color: 'rgba(190,0,0,1)',
    marginTop: SW * 0.02,
  },
});
