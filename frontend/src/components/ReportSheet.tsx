/**
 * ReportSheet — bottom sheet for reporting a user or a listing
 * (App Store Guideline 1.2). Shared: Chat imports it for users, the listing
 * surfaces import it for listings. The public contract is the `ReportTarget`
 * type and the `{ visible, target, onClose }` props — keep them stable.
 *
 * Motion (animate-expo):
 *  - A sheet is an occasional interaction, so it animates: spring in
 *    (duration 300, dampingRatio 0.8 per the sheet config), backdrop derived
 *    from the same shared value so the two can never drift apart.
 *  - Dismiss by tapping the backdrop, the Close button, the Android back
 *    button, or by dragging the grabber/title area down. The drag is 1:1 with
 *    the finger, upward drag rubber-bands, and release uses projected velocity
 *    so a flick is enough; the spring inherits the release velocity.
 *  - Only transform + opacity animate, on the UI thread (shared value →
 *    useAnimatedStyle). No setState per frame.
 *  - Reduced motion: no slide/spring — the sheet fades.
 *  - Keyboard: KeyboardAvoidingView lifts the sheet, the sheet's own content
 *    never exceeds the screen (details input has a capped height).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView, Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Ionicons } from '@expo/vector-icons';

import { CustomFonts } from '@/src/constants/theme';
import { blockUser, reportListing, reportUser } from '@/src/utils/moderation';
import {
  triggerErrorHaptic,
  triggerLightHaptic,
  triggerSelectionHaptic,
  triggerSuccessHaptic,
} from '@/src/components/moderation/haptics';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

export type ReportTarget =
  | { kind: 'user'; userId: string; userName?: string; conversationId?: string }
  | { kind: 'listing'; listingId: string; listingTitle?: string };

const USER_REASONS = [
  'Harassment or threats',
  'Spam or scam',
  'Inappropriate content',
  'Hate speech',
  'Other',
] as const;

const LISTING_REASONS = [
  'Fake or misleading listing',
  'Spot unavailable or unsafe',
  'Inappropriate photos or text',
  'Scam',
  'Other',
] as const;

const SUCCESS_MESSAGE = 'Thanks — our team reviews every report within 24 hours.';
const AUTO_CLOSE_MS = 2200;
const DETAILS_MAX = 500;

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

// Where a flick would come to rest (Apple's exponential-decay projection).
function project(velocity: number, decelerationRate = 0.998) {
  'worklet';
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

// The further past the edge, the less the element follows.
function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  'worklet';
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

interface Props {
  visible: boolean;
  target: ReportTarget | null;
  onClose: () => void;
}

export default function ReportSheet({ visible, target, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();

  // The Modal stays mounted until the exit animation has finished.
  const [mounted, setMounted] = useState(visible);

  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 0 = fully shown, `hiddenY` = off-screen. Backdrop and sheet both derive from it.
  const hiddenY = screenHeight;
  const translateY = useSharedValue(hiddenY);
  const dragStart = useSharedValue(0);

  const isUser = target?.kind === 'user';
  const reasons = isUser ? USER_REASONS : LISTING_REASONS;
  const subjectName =
    target?.kind === 'user'
      ? target.userName?.trim() || 'this user'
      : target?.kind === 'listing'
        ? target.listingTitle?.trim() || 'this listing'
        : '';

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const finishClose = useCallback(() => {
    setMounted(false);
    onClose();
  }, [onClose]);

  // Each time the sheet is asked to open, start from a clean form and mount the
  // Modal. Tracked against the previous `visible` during render (not in an effect).
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setReason(null);
      setDetails('');
      setAlsoBlock(true);
      setSubmitting(false);
      setError(null);
      setDone(false);
      setMounted(true);
    }
  }

  // Open / close animation driven by the `visible` prop.
  useEffect(() => {
    if (visible) {
      clearCloseTimer();
      translateY.set(
        reduced
          ? withTiming(0, { duration: 150, easing: EASE_OUT })
          : withSpring(0, { duration: 300, dampingRatio: 0.8 }),
      );
    } else {
      translateY.set(
        withTiming(hiddenY, { duration: reduced ? 100 : 220, easing: EASE_OUT }, (finished) => {
          if (finished) scheduleOnRN(setMounted, false);
        }),
      );
    }
  }, [visible, reduced, hiddenY, translateY, clearCloseTimer]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  /** Animate out, then tell the parent. Used by every dismissal path. */
  const requestClose = useCallback(() => {
    clearCloseTimer();
    translateY.set(
      withTiming(hiddenY, { duration: reduced ? 100 : 220, easing: EASE_OUT }, (finished) => {
        if (finished) scheduleOnRN(finishClose);
      }),
    );
  }, [clearCloseTimer, finishClose, hiddenY, reduced, translateY]);

  const submit = async () => {
    if (!target || !reason || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (target.kind === 'user') {
        await reportUser({
          userId: target.userId,
          reason,
          details,
          conversationId: target.conversationId,
        });
        if (alsoBlock) {
          // The report is already filed; a failed block must not turn that into
          // an error screen. The user can still block from the chat menu.
          try {
            await blockUser(target.userId);
          } catch (e) {
            console.warn('[ReportSheet] report filed but block failed', e);
          }
        }
      } else {
        await reportListing({ listingId: target.listingId, reason, details });
      }
      triggerSuccessHaptic();
      setDone(true);
      closeTimer.current = setTimeout(requestClose, AUTO_CLOSE_MS);
    } catch (e) {
      triggerErrorHaptic();
      setError(
        e instanceof Error && e.message
          ? e.message
          : "We couldn't send your report. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Drag-to-dismiss, on the grabber/title region only so chips, the text input
  // and the switch below keep their own touches.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-10, 10])
        .failOffsetX([-24, 24])
        .onStart(() => {
          dragStart.set(translateY.get());
        })
        .onUpdate((e) => {
          const next = dragStart.get() + e.translationY;
          translateY.set(next >= 0 ? next : rubberband(next, screenHeight * 0.3));
        })
        .onEnd((e) => {
          const projected = translateY.get() + project(e.velocityY);
          if (projected > 180) {
            translateY.set(
              withSpring(
                hiddenY,
                { duration: 300, dampingRatio: 1, velocity: e.velocityY, overshootClamping: true },
                (finished) => {
                  if (finished) scheduleOnRN(finishClose);
                },
              ),
            );
          } else {
            translateY.set(
              withSpring(0, { duration: 300, dampingRatio: 0.8, velocity: e.velocityY }),
            );
          }
        }),
    [dragStart, finishClose, hiddenY, translateY],
  );

  const sheetStyle = useAnimatedStyle(() => {
    if (reduced) {
      return { opacity: interpolate(translateY.get(), [0, hiddenY], [1, 0], Extrapolation.CLAMP) };
    }
    return { transform: [{ translateY: translateY.get() }] };
  });
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.get(), [0, hiddenY * 0.6], [1, 0], Extrapolation.CLAMP),
  }));

  if (!mounted) return null;

  const canSubmit = !!reason && !submitting;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={requestClose}
    >
      {/* Modals render in their own native root, so gestures need their own root view. */}
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable
            style={styles.fill}
            onPress={requestClose}
            accessibilityLabel="Close report sheet"
            accessibilityRole="button"
          />
        </Animated.View>

        <KeyboardAvoidingView
          style={styles.kav}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          pointerEvents="box-none"
        >
          <Animated.View
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 8 }, sheetStyle]}
          >
            <GestureDetector gesture={pan}>
              <View collapsable={false}>
                <View style={styles.grabber} />
                <View style={styles.titleRow}>
                  <Text style={styles.title} numberOfLines={2}>
                    {done
                      ? 'Report sent'
                      : isUser
                        ? `Report ${subjectName}`
                        : 'Report this listing'}
                  </Text>
                  <Pressable
                    onPress={() => {
                      triggerLightHaptic();
                      requestClose();
                    }}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    style={styles.closeBtn}
                  >
                    <Ionicons name="close" size={screenWidth * 0.05} color="#000" />
                  </Pressable>
                </View>
              </View>
            </GestureDetector>

            {done ? (
              <View style={styles.success} accessibilityLiveRegion="polite">
                <View style={styles.successIcon}>
                  <Ionicons name="checkmark" size={screenWidth * 0.08} color="#FFFFFF" />
                </View>
                <Text style={styles.successText}>{SUCCESS_MESSAGE}</Text>
                <Pressable
                  onPress={() => {
                    triggerLightHaptic();
                    requestClose();
                  }}
                  style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryBtnText}>Done</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Text style={styles.sectionLabel}>
                  {isUser ? "What's going on?" : "What's wrong with this spot?"}
                </Text>
                <View style={styles.chips}>
                  {reasons.map((r) => {
                    const selected = reason === r;
                    return (
                      <Pressable
                        key={r}
                        onPress={() => {
                          if (!selected) triggerSelectionHaptic();
                          setReason(r);
                          setError(null);
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        style={({ pressed }) => [
                          styles.chip,
                          selected && styles.chipSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                          {r}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <TextInput
                  style={styles.details}
                  value={details}
                  onChangeText={(t) => setDetails(t.slice(0, DETAILS_MAX))}
                  placeholder="Add details (optional)"
                  placeholderTextColor="rgba(0,0,0,0.4)"
                  multiline
                  maxLength={DETAILS_MAX}
                  textAlignVertical="top"
                  accessibilityLabel="Additional details"
                />

                {isUser && (
                  <View style={styles.blockRow}>
                    <Text style={styles.blockLabel} numberOfLines={2}>
                      Also block {subjectName}
                    </Text>
                    <Switch
                      value={alsoBlock}
                      onValueChange={(v) => {
                        triggerSelectionHaptic();
                        setAlsoBlock(v);
                      }}
                      trackColor={{ false: 'rgba(0,0,0,0.15)', true: '#000000' }}
                      thumbColor="#FFFFFF"
                      ios_backgroundColor="rgba(0,0,0,0.15)"
                      accessibilityLabel={`Also block ${subjectName}`}
                    />
                  </View>
                )}

                {error && (
                  <Text style={styles.error} accessibilityLiveRegion="polite">
                    {error}
                  </Text>
                )}

                <Pressable
                  onPress={submit}
                  disabled={!canSubmit}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canSubmit, busy: submitting }}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    !reason && styles.primaryBtnDisabled,
                    pressed && canSubmit && styles.pressed,
                  ]}
                >
                  {submitting ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Submit report</Text>
                  )}
                </Pressable>
              </>
            )}
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#DCDBD8',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: screenWidth * 0.05,
    maxHeight: screenHeight * 0.92,
  },
  grabber: {
    alignSelf: 'center',
    width: screenWidth * 0.1,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.25)',
    marginTop: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: screenWidth * 0.03,
    paddingTop: screenWidth * 0.04,
    paddingBottom: screenWidth * 0.035,
  },
  title: {
    flex: 1,
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: screenWidth * 0.052,
    color: '#000',
  },
  closeBtn: {
    width: screenWidth * 0.09,
    height: screenWidth * 0.09,
    borderRadius: 999,
    backgroundColor: '#F4F4F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.038,
    color: 'rgba(0,0,0,0.55)',
    marginBottom: screenWidth * 0.025,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: screenWidth * 0.02,
    marginBottom: screenWidth * 0.04,
  },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: screenWidth * 0.045,
    borderRadius: 999,
    backgroundColor: '#F4F4F4',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  chipSelected: {
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderColor: 'rgba(0,0,0,0.85)',
  },
  chipText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.038,
    color: '#000',
  },
  chipTextSelected: {
    fontFamily: CustomFonts.SwitzerSemibold,
    color: '#FFFFFF',
  },
  details: {
    minHeight: screenWidth * 0.22,
    maxHeight: screenWidth * 0.34,
    borderRadius: 22,
    backgroundColor: '#F4F4F4',
    paddingHorizontal: screenWidth * 0.045,
    paddingTop: screenWidth * 0.035,
    paddingBottom: screenWidth * 0.035,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.04,
    color: '#000',
  },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: screenWidth * 0.03,
    marginTop: screenWidth * 0.03,
    paddingHorizontal: screenWidth * 0.045,
    paddingVertical: screenWidth * 0.025,
    borderRadius: 999,
    backgroundColor: '#F4F4F4',
  },
  blockLabel: {
    flex: 1,
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: screenWidth * 0.04,
    color: '#000',
  },
  error: {
    marginTop: screenWidth * 0.03,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.037,
    color: '#C62828',
  },
  primaryBtn: {
    marginTop: screenWidth * 0.045,
    minHeight: 52,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: { opacity: 0.35 },
  primaryBtnText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: screenWidth * 0.042,
    color: '#FFFFFF',
  },
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  success: {
    alignItems: 'center',
    paddingTop: screenWidth * 0.03,
    paddingBottom: screenWidth * 0.02,
  },
  successIcon: {
    width: screenWidth * 0.16,
    height: screenWidth * 0.16,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: screenWidth * 0.04,
  },
  successText: {
    textAlign: 'center',
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.042,
    lineHeight: screenWidth * 0.06,
    color: '#000',
    marginHorizontal: screenWidth * 0.04,
  },
});
