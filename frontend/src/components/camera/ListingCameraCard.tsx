/**
 * ListingCameraCard — the Scene 3 photo pop-up of the listing creator.
 *
 * A single floating card: the live camera (expo-camera) fills it edge to edge,
 * inset 8pt from the left / right / bottom of the screen with a radius that is
 * concentric with the iPhone's display corners. The header line sits above the
 * card on the page background. Controls are overlaid on the bottom of the
 * preview: the shutter (centre), photo library (right). After a capture the
 * shutter becomes a checkmark "Continue" and Retake appears on the left.
 *
 * Dismiss: tap the backdrop, or drag the card down (velocity-aware, rubber-
 * banded upward). Both end in `onBack` after the exit animation.
 *
 * Motion (skills/animate-expo): everything is transform + opacity on the UI
 * thread via Reanimated. Entrance is a critically damped spring (no bounce, no
 * finger involved); the drag hands finger velocity to the spring. Press feedback
 * is a 100ms scale transition. Capture <-> live is an opacity crossfade over a
 * paused (not unmounted) preview so Retake is instant. Reduced motion drops the
 * travel / scale / flash and keeps the fades.
 *
 * The camera session only starts once the entrance spring has settled, and the
 * parent mounts this component only while the pop-up is open.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  FadeIn,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { CustomFonts } from '@/src/constants/theme';
import { triggerLightHaptic } from '@/src/utils/haptics';
import { slideIn, slideOut } from '@/src/components/activity/motion';
import cameraanalogImg from '@/assets/images/cameraanalog.png';

// ─── Layout ──────────────────────────────────────────────────────────────────
const EDGE_GAP = 8; // inset from left / right / bottom of the screen
const CORNER_RADIUS = 47; // concentric with the iPhone display corners
const CORNER_RADIUS_SQUARE = 28; // devices without rounded display (SE)
const FRAME_WIDTH = 2;
const SHUTTER_OUTER = 82;
const SHUTTER_GAP = 72;
const SHUTTER_CORE = 62;
const SIDE_BTN = 56;
const CONTROLS_INSET = 26; // side buttons from card edge (keeps clear of corner arc)
const CONTROLS_BOTTOM = 24;
const HEADER_RESERVE = 150; // shared creator header + this screen's header line

// ─── Motion tokens ───────────────────────────────────────────────────────────
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1); // strong ease-out for UI
// Module scope: layout-animation builders must not be rebuilt in render.
const TEXT_SWAP = FadeIn.duration(200).easing(EASE_OUT);
const MESSAGE_IN = FadeIn.duration(250).easing(EASE_OUT);

const CAPTURE_QUALITY = 0.7; // same compression the old launchCameraAsync used

// Where the finger would come to rest if it kept decelerating.
function project(velocity: number, decelerationRate = 0.998) {
  'worklet';
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

// The further past the edge, the less the card follows.
function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  'worklet';
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

type Props = {
  /** Back to the map (Scene 2). Called after the exit animation. */
  onBack: () => void;
  /** User accepted a photo. Same URI the old launchCameraAsync produced. */
  onConfirm: (uri: string) => void;
};

// ─── Round press-scale button ────────────────────────────────────────────────
function PressScale({
  onPress,
  onPressIn,
  disabled,
  label,
  scaleTo = 0.94,
  children,
}: {
  onPress: () => void;
  onPressIn?: () => void;
  disabled?: boolean;
  label: string;
  scaleTo?: number;
  children: React.ReactNode;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        setPressed(true);
        onPressIn?.();
      }}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      hitSlop={8}
      pressRetentionOffset={16}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Animated.View
        style={[styles.pressBase, pressed && !disabled && { transform: [{ scale: scaleTo }] }]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}

export default function ListingCameraCard({ onBack, onConfirm }: Props) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { height: winH } = useWindowDimensions();

  const cameraRef = useRef<CameraView>(null);
  const capturingRef = useRef(false);
  const confirmedRef = useRef(false);
  const askedRef = useRef(false);

  const [ready, setReady] = useState(false); // entrance finished
  const [permission, requestPermission, refreshPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  // Kept after Retake so the preview can fade out instead of vanishing.
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  // ── Derived ────────────────────────────────────────────────────────────────
  const granted = permission?.granted ?? false;
  const denied = permission !== null && !granted && permission.status !== 'undetermined';
  const blocked = (denied || cameraError) && photo === null;
  const mountCamera = ready && granted && !cameraError;
  const cardHeight = Math.round(Math.min(winH * 0.72, winH - insets.top - HEADER_RESERVE));
  const radius = insets.bottom > 0 ? CORNER_RADIUS : CORNER_RADIUS_SQUARE;

  // ── Shared values ──────────────────────────────────────────────────────────
  const sheetY = useSharedValue(reduceMotion ? 0 : winH); // drag / entrance / exit
  const dragStart = useSharedValue(0);
  const appear = useSharedValue(0); // sheet opacity
  const closing = useSharedValue(false);
  const cameraFade = useSharedValue(0); // 0 = camera starting, 1 = live
  const captured = useSharedValue(0); // 0 = live, 1 = showing a photo
  const flash = useSharedValue(0);
  const squeeze = useSharedValue(1);

  // ── Entrance ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const settled = () => {
      'worklet';
      scheduleOnRN(setReady, true);
    };
    if (reduceMotion) {
      appear.set(withTiming(1, { duration: 200 }, settled));
      return;
    }
    appear.set(withTiming(1, { duration: 180 }));
    slideIn(sheetY, winH, settled);
  }, [reduceMotion, appear, sheetY, winH]);

  // ── Close paths ────────────────────────────────────────────────────────────
  const runClose = useCallback(
    (then: () => void) => {
      if (closing.get()) return;
      closing.set(true);
      const done = (finished?: boolean) => {
        'worklet';
        if (finished) scheduleOnRN(then);
      };
      if (reduceMotion) {
        appear.set(withTiming(0, { duration: 150 }, done));
      } else {
        slideOut(sheetY, winH, done);
      }
    },
    [closing, appear, sheetY, reduceMotion, winH],
  );

  const handleBackdrop = useCallback(() => {
    triggerLightHaptic();
    runClose(onBack);
  }, [runClose, onBack]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-10, 10])
        .failOffsetX([-24, 24])
        .onStart(() => {
          dragStart.set(sheetY.get());
        })
        .onUpdate((e) => {
          if (closing.get()) return;
          const next = dragStart.get() + e.translationY;
          sheetY.set(next >= 0 ? next : rubberband(next, cardHeight));
        })
        .onEnd((e) => {
          if (closing.get()) return;
          const y = sheetY.get();
          const projected = y + project(e.velocityY);
          if (y > cardHeight * 0.3 || projected > cardHeight * 0.45 || e.velocityY > 1000) {
            closing.set(true);
            slideOut(sheetY, winH, (finished) => {
              if (finished) scheduleOnRN(onBack);
            });
          } else {
            slideIn(sheetY, winH);
            if (y > 8) scheduleOnRN(triggerLightHaptic); // it snapped home
          }
        }),
    [dragStart, sheetY, closing, cardHeight, winH, onBack],
  );

  // ── Permission: ask once the card has settled ──────────────────────────────
  useEffect(() => {
    if (!ready || askedRef.current) return;
    if (permission && permission.status === 'undetermined' && permission.canAskAgain) {
      askedRef.current = true;
      requestPermission().catch(() => {});
    }
  }, [ready, permission, requestPermission]);

  // Coming back from Settings after flipping the switch.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshPermission().catch(() => {});
    });
    return () => sub.remove();
  }, [refreshPermission]);

  // ── Live <-> photo crossfade ───────────────────────────────────────────────
  useEffect(() => {
    captured.set(
      withTiming(photo ? 1 : 0, {
        duration: reduceMotion ? 150 : photo ? 220 : 180,
        easing: EASE_OUT,
      }),
    );
  }, [photo, reduceMotion, captured]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleCameraReady = useCallback(() => {
    setCameraReady(true);
    cameraFade.set(withTiming(1, { duration: reduceMotion ? 150 : 320, easing: EASE_OUT }));
  }, [cameraFade, reduceMotion]);

  const handleMountError = useCallback(() => {
    // Simulators and camera-less devices land here.
    setCameraError(true);
    setCameraReady(false);
    cameraFade.set(0);
  }, [cameraFade]);

  const showPhoto = useCallback((uri: string) => {
    setPreviewUri(uri);
    setPhoto(uri);
    // Freeze the feed under the preview: saves power and avoids a flicker if
    // the image decodes a frame late. Resumed on Retake.
    cameraRef.current?.pausePreview().catch(() => {});
  }, []);

  const handleShutter = useCallback(async () => {
    const cam = cameraRef.current;
    if (!cam || !cameraReady || capturingRef.current) return;
    capturingRef.current = true;

    // Feedback fires on the press, before the (slow) capture resolves.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (!reduceMotion) {
      flash.set(
        withSequence(
          withTiming(0.85, { duration: 60 }),
          withTiming(0, { duration: 220, easing: EASE_OUT }),
        ),
      );
      squeeze.set(
        withSequence(
          withTiming(0.99, { duration: 70, easing: EASE_OUT }),
          withSpring(1, { duration: 300, dampingRatio: 0.7 }),
        ),
      );
    }

    try {
      const picture = await cam.takePictureAsync({ quality: CAPTURE_QUALITY });
      showPhoto(picture.uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      console.warn('[ListingCameraCard] capture failed:', e);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      Alert.alert('Could not take photo', 'Please try again, or choose a photo from your library.');
    } finally {
      capturingRef.current = false;
    }
  }, [cameraReady, reduceMotion, flash, squeeze, showPhoto]);

  const handleConfirm = useCallback(() => {
    if (!photo || confirmedRef.current) return;
    confirmedRef.current = true;
    triggerLightHaptic();
    runClose(() => onConfirm(photo));
  }, [photo, onConfirm, runClose]);

  const handleRetake = useCallback(() => {
    triggerLightHaptic();
    setPhoto(null);
    cameraRef.current?.resumePreview().catch(() => {});
  }, []);

  const handleLibrary = useCallback(async () => {
    triggerLightHaptic();
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        quality: CAPTURE_QUALITY,
      });
      if (!result.canceled && result.assets.length > 0) {
        showPhoto(result.assets[0].uri);
      }
    } catch (e) {
      console.warn('[ListingCameraCard] library failed:', e);
      Alert.alert('Could not open library', 'Please try again.');
    }
  }, [showPhoto]);

  const handleAllowCamera = useCallback(() => {
    triggerLightHaptic();
    if (permission?.canAskAgain) {
      requestPermission().catch(() => {});
    } else {
      Linking.openSettings().catch(() => {});
    }
  }, [permission, requestPermission]);

  // ── Animated styles ────────────────────────────────────────────────────────
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: appear.get(),
    transform: [{ translateY: sheetY.get() }],
  }));
  const squeezeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: squeeze.get() }],
  }));
  const cameraStyle = useAnimatedStyle(() => ({
    opacity: cameraFade.get(),
    transform: [{ scale: reduceMotion ? 1 : interpolate(cameraFade.get(), [0, 1], [1.03, 1]) }],
  }));
  const placeholderStyle = useAnimatedStyle(() => ({ opacity: 1 - cameraFade.get() }));
  const previewStyle = useAnimatedStyle(() => ({ opacity: captured.get() }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.get() }));
  const libraryStyle = useAnimatedStyle(() => ({ opacity: 1 - captured.get() }));
  const retakeStyle = useAnimatedStyle(() => ({ opacity: captured.get() }));
  const checkStyle = useAnimatedStyle(() => ({
    opacity: captured.get(),
    transform: [{ scale: reduceMotion ? 1 : interpolate(captured.get(), [0, 1], [0.7, 1]) }],
  }));

  const shutterEnabled = cameraReady && !blocked;
  const centerEnabled = photo !== null || shutterEnabled;

  const messageTitle = cameraError ? "Camera isn't available" : 'Camera access is off';
  const messageBody = cameraError
    ? "We couldn't start the camera on this device. You can pick a photo from your library instead."
    : 'Allow SpotOn to use your camera to photograph your spot, or pick a photo from your library instead.';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Backdrop: tap anywhere outside the card to minimise */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={handleBackdrop}
        accessibilityRole="button"
        accessibilityLabel="Close camera"
      />

      <Animated.View style={[styles.sheet, sheetStyle]} pointerEvents="box-none">
        {/* Header sits on the page background, above the card */}
        <View style={styles.headerRow} pointerEvents="none">
          <Image source={cameraanalogImg} style={styles.headerGlyph} resizeMode="contain" />
          <Animated.Text
            key={photo ? 'review' : 'live'}
            entering={TEXT_SWAP}
            style={styles.headerText}
            accessibilityRole="header"
          >
            {photo ? 'Looking good? Continue, or retake.' : "Let's add a photo to your listing."}
          </Animated.Text>
        </View>

        <GestureDetector gesture={pan}>
          <Animated.View
            style={[styles.cardShadow, { height: cardHeight, borderRadius: radius }, squeezeStyle]}
          >
            <View style={[styles.cardClip, { borderRadius: radius }]}>
              {/* Resting surface while the camera spins up */}
              {!blocked && (
                <Animated.View style={[styles.placeholder, placeholderStyle]} pointerEvents="none">
                  <Ionicons name="camera-outline" size={38} color="rgba(255,255,255,0.28)" />
                </Animated.View>
              )}

              {mountCamera && (
                <Animated.View style={[StyleSheet.absoluteFill, cameraStyle]}>
                  <CameraView
                    ref={cameraRef}
                    style={StyleSheet.absoluteFill}
                    facing="back"
                    animateShutter={false}
                    onCameraReady={handleCameraReady}
                    onMountError={handleMountError}
                  />
                </Animated.View>
              )}

              {/* Captured photo */}
              {previewUri !== null && (
                <Animated.View style={[StyleSheet.absoluteFill, previewStyle]} pointerEvents="none">
                  <ExpoImage
                    source={{ uri: previewUri }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    transition={0}
                    accessibilityLabel="Photo of your parking spot"
                  />
                </Animated.View>
              )}

              {/* Shutter flash */}
              <Animated.View style={[styles.flash, flashStyle]} pointerEvents="none" />

              {/* Permission denied / no camera */}
              {blocked && (
                <Animated.View entering={MESSAGE_IN} style={styles.message}>
                  <View style={styles.messageIcon}>
                    <Ionicons name="camera-outline" size={26} color="#fff" />
                  </View>
                  <Text style={styles.messageTitle}>{messageTitle}</Text>
                  <Text style={styles.messageBody}>{messageBody}</Text>
                  {denied && !cameraError && (
                    <Pressable
                      onPress={handleAllowCamera}
                      style={({ pressed }) => [styles.primaryPill, pressed && styles.pillPressed]}
                      accessibilityRole="button"
                      accessibilityLabel="Allow camera"
                    >
                      <Text style={styles.primaryPillText}>Allow camera</Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={handleLibrary}
                    style={({ pressed }) => [styles.secondaryPill, pressed && styles.pillPressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Choose from library"
                  >
                    <Ionicons name="images-outline" size={16} color="#fff" />
                    <Text style={styles.secondaryPillText}>Choose from library</Text>
                  </Pressable>
                </Animated.View>
              )}

              {/* Controls overlaid on the bottom of the preview */}
              {!blocked && (
                <View style={styles.controls} pointerEvents="box-none">
                  {/* Left: Retake (after capture) */}
                  <Animated.View
                    style={[styles.slot, { left: CONTROLS_INSET }, retakeStyle]}
                    pointerEvents={photo ? 'auto' : 'none'}
                  >
                    <PressScale onPress={handleRetake} label="Retake photo" disabled={!photo}>
                      <View style={styles.sideBtn}>
                        <Ionicons name="refresh" size={24} color="#fff" />
                      </View>
                    </PressScale>
                  </Animated.View>

                  {/* Centre: shutter, becomes Continue */}
                  <View style={styles.centerSlot}>
                    <PressScale
                      onPress={photo ? handleConfirm : handleShutter}
                      disabled={!centerEnabled}
                      label={photo ? 'Continue with this photo' : 'Take photo'}
                      scaleTo={0.92}
                    >
                      <View style={[styles.shutterOuter, !centerEnabled && styles.shutterIdle]}>
                        <View style={styles.shutterGap}>
                          <View style={styles.shutterCore}>
                            <Animated.View style={checkStyle}>
                              <Ionicons name="checkmark" size={34} color="#000" />
                            </Animated.View>
                          </View>
                        </View>
                      </View>
                    </PressScale>
                  </View>

                  {/* Right: photo library (live only) */}
                  <Animated.View
                    style={[styles.slot, { right: CONTROLS_INSET }, libraryStyle]}
                    pointerEvents={photo ? 'none' : 'auto'}
                  >
                    <PressScale onPress={handleLibrary} label="Choose from library" disabled={!!photo}>
                      <View style={styles.sideBtn}>
                        <Ionicons name="images" size={22} color="#fff" />
                      </View>
                    </PressScale>
                  </Animated.View>
                </View>
              )}
            </View>

            {/* Thin translucent frame, above the camera */}
            <View
              style={[styles.frame, { borderRadius: radius }]}
              pointerEvents="none"
            />
          </Animated.View>
        </GestureDetector>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: EDGE_GAP,
    right: EDGE_GAP,
    bottom: EDGE_GAP,
  },

  // ── Header (on page background) ────────────────────────────────────────────
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 14,
    paddingRight: 8,
    marginBottom: 14,
    minHeight: 34,
  },
  headerGlyph: {
    width: 30,
    height: 30,
  },
  headerText: {
    flex: 1,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: 16,
    lineHeight: 21,
    color: '#2A2A2A',
  },

  // ── Card ───────────────────────────────────────────────────────────────────
  cardShadow: {
    backgroundColor: '#0B0B0B',
    borderCurve: 'continuous',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  cardClip: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
    borderCurve: 'continuous',
    backgroundColor: '#141414',
  },
  frame: {
    ...StyleSheet.absoluteFill,
    borderCurve: 'continuous',
    borderWidth: FRAME_WIDTH,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  placeholder: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flash: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#fff',
  },

  // ── Controls ───────────────────────────────────────────────────────────────
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: CONTROLS_BOTTOM,
    height: SHUTTER_OUTER,
  },
  slot: {
    position: 'absolute',
    top: (SHUTTER_OUTER - SIDE_BTN) / 2,
  },
  centerSlot: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressBase: {
    transitionProperty: 'transform',
    transitionDuration: '100ms',
    transitionTimingFunction: 'ease-out',
    transform: [{ scale: 1 }],
  },
  sideBtn: {
    width: SIDE_BTN,
    height: SIDE_BTN,
    borderRadius: SIDE_BTN / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  shutterOuter: {
    width: SHUTTER_OUTER,
    height: SHUTTER_OUTER,
    borderRadius: SHUTTER_OUTER / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  shutterGap: {
    width: SHUTTER_GAP,
    height: SHUTTER_GAP,
    borderRadius: SHUTTER_GAP / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  shutterCore: {
    width: SHUTTER_CORE,
    height: SHUTTER_CORE,
    borderRadius: SHUTTER_CORE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  shutterIdle: {
    opacity: 0.5,
  },
  pillPressed: {
    opacity: 0.7,
  },

  // ── Permission / unavailable message ───────────────────────────────────────
  message: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  messageIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginBottom: 4,
  },
  messageTitle: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 17,
    color: '#fff',
    textAlign: 'center',
  },
  messageBody: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.78)',
    textAlign: 'center',
    marginBottom: 8,
  },
  primaryPill: {
    height: 46,
    minWidth: 190,
    paddingHorizontal: 22,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  primaryPillText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 15,
    color: '#000',
  },
  secondaryPill: {
    height: 46,
    minWidth: 190,
    paddingHorizontal: 22,
    borderRadius: 23,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  secondaryPillText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 15,
    color: '#fff',
  },
});
