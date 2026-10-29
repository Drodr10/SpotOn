/**
 * ListingCameraCard — the Scene 3 photo pop-up of the listing creator.
 *
 * Opens straight into a live in-app viewfinder (expo-camera). One control does
 * two jobs, as in the Figma "Take A Photo V2" frame: the white circle inside
 * the black pill is the shutter; once a photo exists it gives way to
 * "Continue". Retake and "choose from library" live on the viewfinder itself.
 *
 * Motion (see skills/animate-expo): everything here is transform + opacity on
 * the UI thread via Reanimated. Press feedback is 100ms in / spring out, the
 * viewfinder fades in on `onCameraReady`, the shutter flash is a 60ms-in /
 * 220ms-out white veil, and capture <-> live is an opacity crossfade over a
 * paused (not unmounted) preview so Retake is instant. With reduced motion the
 * scale / flash / drift go away and only the fades remain.
 *
 * The parent owns the slide-in of the card and passes `ready` once it has
 * settled, so the (heavy) camera session never starts mid-spring.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Dimensions,
  Image,
  LayoutChangeEvent,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

import { CustomFonts } from '@/src/constants/theme';
import { triggerLightHaptic } from '@/src/utils/haptics';
import cameraanalogImg from '@/assets/images/cameraanalog.png';

// ─── Sizing (screen-relative, like the rest of the creator) ──────────────────
const { width: W } = Dimensions.get('window');
const CARD_PAD = W * 0.05;
const ACTION_HEIGHT = 50; // matches the creator's back circle / Continue pill
const SHUTTER_SIZE = 58; // a touch taller than the pill, as in the design
const VIEWFINDER_RATIO = 3 / 4; // width / height — the sensor's 4:3, portrait
const VIEWFINDER_RADIUS = 26;

// ─── Motion tokens ───────────────────────────────────────────────────────────
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1); // strong ease-out for UI
// Module scope: layout-animation builders must not be rebuilt in render.
const TEXT_SWAP = FadeIn.duration(200).easing(EASE_OUT);
const MESSAGE_IN = FadeIn.duration(250).easing(EASE_OUT);

const CAPTURE_QUALITY = 0.7; // same compression the old launchCameraAsync used

type Props = {
  /** Entrance animation finished — safe to ask for permission / start camera. */
  ready: boolean;
  /** Back to the map (Scene 2). */
  onBack: () => void;
  /** User accepted a photo. Same URI the old launchCameraAsync produced. */
  onConfirm: (uri: string) => void;
};

export default function ListingCameraCard({ ready, onBack, onConfirm }: Props) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  const cameraRef = useRef<CameraView>(null);
  const capturingRef = useRef(false);
  const confirmedRef = useRef(false);
  const askedRef = useRef(false);

  const [permission, requestPermission, refreshPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  // Kept after Retake so the preview can fade out instead of vanishing.
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);

  // ── Derived state ──────────────────────────────────────────────────────────
  const granted = permission?.granted ?? false;
  const denied = permission !== null && !granted && permission.status !== 'undetermined';
  const blocked = (denied || cameraError) && photo === null;
  const mountCamera = ready && granted && !cameraError;

  // ── Shared values ──────────────────────────────────────────────────────────
  const cameraFade = useSharedValue(0); // 0 = camera starting, 1 = live
  const captured = useSharedValue(0); // 0 = live, 1 = showing a photo
  const flash = useSharedValue(0);
  const squeeze = useSharedValue(1);
  const shutterPress = useSharedValue(1);
  const pillPress = useSharedValue(1);

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
  const onStageLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setStage((prev) =>
      prev && prev.w === width && prev.h === height ? prev : { w: width, h: height },
    );
  }, []);

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
          withTiming(0.985, { duration: 70, easing: EASE_OUT }),
          withSpring(1, { duration: 300, dampingRatio: 0.7 }),
        ),
      );
    }

    try {
      const picture = await cam.takePictureAsync({ quality: CAPTURE_QUALITY });
      showPhoto(picture.uri);
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
    onConfirm(photo);
  }, [photo, onConfirm]);

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

  const handlePillPress = photo ? handleConfirm : handleShutter;

  const handlePressIn = () => {
    if (photo) {
      pillPress.set(withTiming(0.97, { duration: 100, easing: EASE_OUT }));
    } else if (cameraReady) {
      shutterPress.set(withTiming(0.9, { duration: 100, easing: EASE_OUT }));
    }
  };
  const handlePressOut = () => {
    pillPress.set(withTiming(1, { duration: 120, easing: EASE_OUT }));
    shutterPress.set(withSpring(1, { duration: 250, dampingRatio: 0.7 }));
  };

  // ── Animated styles ────────────────────────────────────────────────────────
  const viewfinderStyle = useAnimatedStyle(() => ({
    transform: [{ scale: squeeze.get() }],
  }));
  const cameraStyle = useAnimatedStyle(() => ({
    opacity: cameraFade.get(),
    transform: [
      { scale: reduceMotion ? 1 : interpolate(cameraFade.get(), [0, 1], [1.03, 1]) },
    ],
  }));
  const placeholderStyle = useAnimatedStyle(() => ({
    opacity: 1 - cameraFade.get(),
  }));
  const gridStyle = useAnimatedStyle(() => ({
    opacity: cameraFade.get() * (1 - captured.get()),
  }));
  const previewStyle = useAnimatedStyle(() => ({
    opacity: captured.get(),
  }));
  const flashStyle = useAnimatedStyle(() => ({
    opacity: flash.get(),
  }));
  const libraryBtnStyle = useAnimatedStyle(() => ({
    opacity: 1 - captured.get(),
  }));
  const retakeBtnStyle = useAnimatedStyle(() => ({
    opacity: captured.get(),
  }));
  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pillPress.get() }],
  }));
  const shutterStyle = useAnimatedStyle(() => ({
    opacity: 1 - captured.get(),
    transform: [
      { scale: shutterPress.get() * (reduceMotion ? 1 : interpolate(captured.get(), [0, 1], [1, 0.6])) },
    ],
  }));
  const continueStyle = useAnimatedStyle(() => ({
    opacity: captured.get(),
    transform: [{ translateX: reduceMotion ? 0 : interpolate(captured.get(), [0, 1], [10, 0]) }],
  }));

  // ── Viewfinder size: largest 3:4 that fits the stage ───────────────────────
  const vfWidth = stage ? Math.floor(Math.min(stage.w, stage.h * VIEWFINDER_RATIO)) : 0;
  const vfHeight = Math.floor(vfWidth / VIEWFINDER_RATIO);

  const shutterEnabled = cameraReady && !blocked;

  const messageTitle = cameraError ? "Camera isn't available" : 'Camera access is off';
  const messageBody = cameraError
    ? "We couldn't start the camera on this device. You can pick a photo from your library instead."
    : 'Allow SpotOn to use your camera to photograph your spot, or pick a photo from your library instead.';

  return (
    <View
      style={[
        styles.card,
        { paddingBottom: Math.max(insets.bottom, 12) + W * 0.015 },
      ]}
    >
      {/* Header row */}
      <View style={styles.headerRow}>
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

      {/* Stage — the viewfinder is centred in whatever space is left */}
      <View style={styles.stage} onLayout={onStageLayout}>
        {stage !== null && vfWidth > 0 && (
          <Animated.View style={[styles.viewfinder, { width: vfWidth, height: vfHeight }, viewfinderStyle]}>
            {/* Resting surface while the camera spins up */}
            <View style={styles.vfBase} />
            {!blocked && (
              <Animated.View style={[styles.placeholder, placeholderStyle]} pointerEvents="none">
                <Ionicons name="camera-outline" size={34} color="rgba(255,255,255,0.28)" />
              </Animated.View>
            )}

            {mountCamera && (
              <Animated.View style={[StyleSheet.absoluteFill, cameraStyle]}>
                <CameraView
                  ref={cameraRef}
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  ratio="4:3"
                  animateShutter={false}
                  onCameraReady={handleCameraReady}
                  onMountError={handleMountError}
                />
              </Animated.View>
            )}

            {/* Rule-of-thirds guide, camera only */}
            <Animated.View style={[StyleSheet.absoluteFill, gridStyle]} pointerEvents="none">
              <View style={[styles.gridV, { left: '33.333%' }]} />
              <View style={[styles.gridV, { left: '66.666%' }]} />
              <View style={[styles.gridH, { top: '33.333%' }]} />
              <View style={[styles.gridH, { top: '66.666%' }]} />
            </Animated.View>

            {/* Captured photo */}
            {previewUri !== null && (
              <Animated.View
                style={[StyleSheet.absoluteFill, previewStyle]}
                pointerEvents="none"
              >
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

            {/* Library (live) / Retake (photo) share one corner */}
            {!blocked && (
              <>
                <Animated.View
                  style={[styles.cornerSlot, libraryBtnStyle]}
                  pointerEvents={photo ? 'none' : 'auto'}
                >
                  <Pressable
                    onPress={handleLibrary}
                    style={({ pressed }) => [styles.libraryBtn, pressed && styles.pillPressed]}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Choose from library"
                  >
                    <Ionicons name="images-outline" size={20} color="#fff" />
                  </Pressable>
                </Animated.View>
                <Animated.View
                  style={[styles.cornerSlot, retakeBtnStyle]}
                  pointerEvents={photo ? 'auto' : 'none'}
                >
                  <Pressable
                    onPress={handleRetake}
                    style={({ pressed }) => [styles.retakeBtn, pressed && styles.pillPressed]}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Retake photo"
                  >
                    <Ionicons name="refresh" size={17} color="#fff" />
                    <Text style={styles.retakeText}>Retake</Text>
                  </Pressable>
                </Animated.View>
              </>
            )}

            <View style={styles.vfBorder} pointerEvents="none" />
          </Animated.View>
        )}
      </View>

      {/* Bottom row — back circle + black pill carrying the shutter */}
      <View style={styles.bottomRow}>
        <Pressable
          onPress={() => {
            triggerLightHaptic();
            onBack();
          }}
          style={({ pressed }) => [styles.backCircle, pressed && styles.pillPressed]}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>

        <Animated.View style={[styles.pillWrap, pillStyle]}>
          <Pressable
            onPress={handlePillPress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            disabled={!photo && !shutterEnabled}
            pressRetentionOffset={16}
            style={styles.pill}
            accessibilityRole="button"
            accessibilityLabel={photo ? 'Continue with this photo' : 'Take photo'}
            accessibilityState={{ disabled: !photo && !shutterEnabled }}
          >
            {/* Continue label — fades in as the shutter fades out */}
            <Animated.View style={[styles.continueRow, continueStyle]} pointerEvents="none">
              <Text style={styles.continueText}>Continue</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </Animated.View>

            {blocked && <Text style={styles.disabledText}>Continue</Text>}

            {!blocked && (
              <Animated.View style={[styles.shutterWrap, shutterStyle]} pointerEvents="none">
                <View style={[styles.shutter, !cameraReady && styles.shutterIdle]}>
                  <View style={styles.shutterRing} />
                </View>
              </Animated.View>
            )}
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.68)',
    borderRadius: 34,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingTop: W * 0.04,
    paddingHorizontal: CARD_PAD,
    overflow: 'hidden',
  },

  // ── Header ─────────────────────────────────────────────────────────────────
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: W * 0.025,
    paddingLeft: 2,
    minHeight: 34,
  },
  headerGlyph: {
    width: 30,
    height: 30,
  },
  headerText: {
    flex: 1,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: 14,
    lineHeight: 19,
    color: '#fff',
  },

  // ── Viewfinder ─────────────────────────────────────────────────────────────
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: W * 0.03,
  },
  viewfinder: {
    borderRadius: VIEWFINDER_RADIUS,
    overflow: 'hidden',
    backgroundColor: '#101010',
  },
  vfBase: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#141414',
  },
  vfBorder: {
    ...StyleSheet.absoluteFill,
    borderRadius: VIEWFINDER_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  placeholder: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  gridH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  flash: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#fff',
  },

  // ── Corner controls on the viewfinder ──────────────────────────────────────
  cornerSlot: {
    position: 'absolute',
    left: 12,
    bottom: 12,
  },
  libraryBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  retakeBtn: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  retakeText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 14,
    color: '#fff',
  },
  pillPressed: {
    opacity: 0.7,
  },

  // ── Permission / unavailable message ───────────────────────────────────────
  message: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
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

  // ── Bottom row ─────────────────────────────────────────────────────────────
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: W * 0.03,
    height: SHUTTER_SIZE,
  },
  backCircle: {
    width: ACTION_HEIGHT,
    height: ACTION_HEIGHT,
    borderRadius: ACTION_HEIGHT / 2,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  pillWrap: {
    flex: 1,
    height: SHUTTER_SIZE,
    justifyContent: 'center',
  },
  pill: {
    height: ACTION_HEIGHT,
    borderRadius: ACTION_HEIGHT / 2,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  shutterWrap: {
    position: 'absolute',
    width: SHUTTER_SIZE,
    height: SHUTTER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutter: {
    width: SHUTTER_SIZE,
    height: SHUTTER_SIZE,
    borderRadius: SHUTTER_SIZE / 2,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterIdle: {
    opacity: 0.45,
  },
  shutterRing: {
    width: SHUTTER_SIZE - 10,
    height: SHUTTER_SIZE - 10,
    borderRadius: (SHUTTER_SIZE - 10) / 2,
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.16)',
  },
  continueRow: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  continueText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 16,
    color: '#fff',
  },
  disabledText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 16,
    color: 'rgba(255,255,255,0.35)',
  },
});
