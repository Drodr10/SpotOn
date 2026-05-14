/**
 * CreateListing2 — 5-scene listing creation flow.
 *
 * Scene 1: Welcome / Intro
 * Scene 2: Pick Location (map)
 * Scene 3: Camera pop-up (overlay on scene 2)
 * Scene 4: Price Picker — single select page; Continue cycles through
 *          rate popup (daily for hourly / monthly for weekly) → totals
 *          popup (earnings breakdown) → calendar.
 * Scene 5: Calendar pop-up (overlay on scene 4)
 *
 * Rates stored per listing: hourly, daily, weekly, monthly.
 */

// ─── React & React Native ─────────────────────────────────────────────────────
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Switch,
  StyleSheet,
  Dimensions,
  Alert,
  Animated,
  PanResponder,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Navigation ───────────────────────────────────────────────────────────────
import { useRouter } from 'expo-router';

// ─── Icons ────────────────────────────────────────────────────────────────────
import { Ionicons } from '@expo/vector-icons';

// ─── Map ──────────────────────────────────────────────────────────────────────
import MapView, { Marker, Region } from 'react-native-maps';

// ─── Location ─────────────────────────────────────────────────────────────────
import * as Location from 'expo-location';

// ─── Image Picker ─────────────────────────────────────────────────────────────
import * as ImagePicker from 'expo-image-picker';

// ─── Constants ────────────────────────────────────────────────────────────────
import { CustomFonts } from '@/src/constants/theme';

// ─── Supabase ─────────────────────────────────────────────────────────────────
import { supabase } from '../utils/supabase';

// ─── Components ───────────────────────────────────────────────────────────────
import DateRangePicker from '@/src/components/DateRangePicker';
import FilterToggle from '@/src/components/FilterToggle';
import { triggerLightHaptic, triggerSelectionHaptic, withLightHaptic } from '@/src/utils/haptics';

// ─── Assets ───────────────────────────────────────────────────────────────────
import carparkingImg from '@/assets/images/carparking.png';
import accessibilityImg from '@/assets/images/accessibility.png';
import addLocationImg from '@/assets/images/add_location.png';
import cameraanalogImg from '@/assets/images/cameraanalog.png';
import calendarImg from '@/assets/images/calendar.png';
import spotonLogoAsset from '@/assets/images/spotonlogo.png';
import spotonLogoCircleAsset from '@/assets/images/spotonlogocircle.png';
import addlistingimageAsset from '@/assets/images/addlistingimage.png';
import dailyTagAsset from '@/assets/images/DailyTag.png';
import monthlyTagAsset from '@/assets/images/MonthlyTag.png';

// ─── Sizing ───────────────────────────────────────────────────────────────────
const { width: W, height: H } = Dimensions.get('window');
const H_PAD = W * 0.06;
const BOTTOM_ACTION_HEIGHT = 50;
const BOTTOM_ACTION_RADIUS = BOTTOM_ACTION_HEIGHT / 2;
const PRICE_IMAGE_SIZE = Math.min(W * 0.82, H * 0.34);
// Off-screen Y offset for rate / totals popups. Using the full screen height
// guarantees the card is fully translated below the viewport on any device,
// regardless of card height or safe-area inset.
const POPUP_OFFSCREEN_Y = H;

// Default region — Gainesville, FL
const GAINESVILLE: Region = {
  latitude: 29.6516,
  longitude: -82.3248,
  latitudeDelta: 0.04,
  longitudeDelta: 0.04,
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function CreateListing2() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // ── Scene state ────────────────────────────────────────────────────────────
  const [scene, setScene] = useState(1);

  // ── Collected data ─────────────────────────────────────────────────────────
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [address, setAddress] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [pricePerHour, setPricePerHour] = useState(3.0);
  const [pricePerDay, setPricePerDay] = useState<number | null>(null);
  const [pricePerWeek, setPricePerWeek] = useState(50);
  // pricePerMonth is derived: pricePerWeek * 4 * 0.8 (20% monthly discount)
  const [periodType, setPeriodType] = useState<0 | 1>(0); // 0 = Hourly, 1 = Weekly
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);

  // ── Daily / Monthly rate popups ────────────────────────────────────────────
  const [showDailyPopup, setShowDailyPopup] = useState(false);
  const [dailyEnabled, setDailyEnabled] = useState(true);
  const [dailyRateAccepted, setDailyRateAccepted] = useState(false);
  const [showMonthlyPopup, setShowMonthlyPopup] = useState(false);
  const [monthlyEnabled, setMonthlyEnabled] = useState(true);
  const [monthlyRateAccepted, setMonthlyRateAccepted] = useState(false);
  const [pricePerMonth, setPricePerMonth] = useState<number | null>(null);

  // ── Totals (earnings breakdown) popup ──────────────────────────────────────
  const [showTotalsPopup, setShowTotalsPopup] = useState(false);

  // ── Pop-up visibility ──────────────────────────────────────────────────────
  const [showCameraPopup, setShowCameraPopup] = useState(false);
  const [showCalendarPopup, setShowCalendarPopup] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);


  // ── Map ref for animating to location ─────────────────────────────────────
  const mapRef = useRef<MapView>(null);

  // ── Pop-up animations ──────────────────────────────────────────────────────
  const cameraPopupAnim = useRef(new Animated.Value(H)).current;
  const calendarPopupAnim = useRef(new Animated.Value(H)).current;
  const dailyPopupAnim = useRef(new Animated.Value(POPUP_OFFSCREEN_Y)).current;
  const monthlyPopupAnim = useRef(new Animated.Value(POPUP_OFFSCREEN_Y)).current;
  const totalsPopupAnim = useRef(new Animated.Value(POPUP_OFFSCREEN_Y)).current;

  const openPopup = (anim: Animated.Value) => {
    Animated.timing(anim, {
      toValue: 0,
      duration: 400,
      useNativeDriver: true,
    }).start();
  };

  const closePopup = (anim: Animated.Value, cb?: () => void) => {
    Animated.timing(anim, {
      toValue: H,
      duration: 300,
      useNativeDriver: true,
    }).start(() => cb && cb());
  };

  useEffect(() => {
    if (showCameraPopup) openPopup(cameraPopupAnim);
  }, [showCameraPopup]);

  useEffect(() => {
    if (showCalendarPopup) openPopup(calendarPopupAnim);
  }, [showCalendarPopup]);

  // ── Price PanResponder ─────────────────────────────────────────────────────
  // Two separate refs so toggling Hourly↔Weekly preserves each value.
  // periodTypeRef mirrors state so the PanResponder (built once via useRef)
  // reads the current mode without stale-closure bugs.
  const priceRef = useRef(3.0);
  const priceWeekRef = useRef(50);
  const pricePerDayRef = useRef(0);
  const pricePerMonthRef = useRef(0);
  const periodTypeRef = useRef<0 | 1>(0);
  const lastY = useRef<number | null>(null);
  const lastYDaily = useRef<number | null>(null);
  const lastYMonthly = useRef<number | null>(null);
  // Tracks whether popup was already shown+dismissed so Continue skips it on second press
  const dailyPopupDone = useRef(false);
  const monthlyPopupDone = useRef(false);
  const totalsPopupDone = useRef(false);

  const pricePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 5,
      onPanResponderGrant: (e) => {
        lastY.current = e.nativeEvent.pageY;
      },
      onPanResponderMove: (e) => {
        if (lastY.current === null) return;
        const dy = lastY.current - e.nativeEvent.pageY;
        const steps = Math.floor(Math.abs(dy) / 10);
        if (steps === 0) return;
        lastY.current = e.nativeEvent.pageY;
        const dir = dy > 0 ? 1 : -1;
        if (periodTypeRef.current === 0) {
          const delta = steps * 0.25 * dir;
          priceRef.current = Math.max(0, Math.round((priceRef.current + delta) * 4) / 4);
          setPricePerHour(priceRef.current);
        } else {
          const delta = steps * 1 * dir;
          priceWeekRef.current = Math.max(0, Math.round(priceWeekRef.current + delta));
          setPricePerWeek(priceWeekRef.current);
        }
        triggerSelectionHaptic();
      },
      onPanResponderRelease: () => {
        lastY.current = null;
      },
    })
  ).current;

  const dailyPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 5,
      onPanResponderGrant: (e) => {
        lastYDaily.current = e.nativeEvent.pageY;
      },
      onPanResponderMove: (e) => {
        if (lastYDaily.current === null) return;
        const dy = lastYDaily.current - e.nativeEvent.pageY;
        const steps = Math.floor(Math.abs(dy) / 10);
        if (steps === 0) return;
        lastYDaily.current = e.nativeEvent.pageY;
        const dir = dy > 0 ? 1 : -1;
        const delta = steps * 0.25 * dir;
        pricePerDayRef.current = Math.max(0, Math.round((pricePerDayRef.current + delta) * 4) / 4);
        setPricePerDay(pricePerDayRef.current);
        triggerSelectionHaptic();
      },
      onPanResponderRelease: () => {
        lastYDaily.current = null;
      },
    })
  ).current;

  const monthlyPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 5,
      onPanResponderGrant: (e) => {
        lastYMonthly.current = e.nativeEvent.pageY;
      },
      onPanResponderMove: (e) => {
        if (lastYMonthly.current === null) return;
        const dy = lastYMonthly.current - e.nativeEvent.pageY;
        const steps = Math.floor(Math.abs(dy) / 10);
        if (steps === 0) return;
        lastYMonthly.current = e.nativeEvent.pageY;
        const dir = dy > 0 ? 1 : -1;
        const delta = steps * 0.5 * dir;
        pricePerMonthRef.current = Math.max(0, Math.round((pricePerMonthRef.current + delta) * 2) / 2);
        setPricePerMonth(pricePerMonthRef.current);
        triggerSelectionHaptic();
      },
      onPanResponderRelease: () => {
        lastYMonthly.current = null;
      },
    })
  ).current;

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleMapLongPress = async (e: any) => {
    triggerLightHaptic();
    const { latitude: lat, longitude: lng } = e.nativeEvent.coordinate;
    setLatitude(lat);
    setLongitude(lng);
    try {
      const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (results.length > 0) {
        const r = results[0];
        const parts = [r.streetNumber, r.street, r.city, r.region].filter(Boolean);
        setAddress(parts.join(', '));
      }
    } catch (_) {}
  };

  const handleCurrentLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission denied', 'Location permission is required.');
      return;
    }
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const { latitude: lat, longitude: lng } = loc.coords;
    setLatitude(lat);
    setLongitude(lng);
    mapRef.current?.animateToRegion(
      { latitude: lat, longitude: lng, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      600
    );
    try {
      const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (results.length > 0) {
        const r = results[0];
        const parts = [r.streetNumber, r.street, r.city, r.region].filter(Boolean);
        setAddress(parts.join(', '));
      }
    } catch (_) {}
  };

  const handleTakePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission denied', 'Camera permission is required.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: 'images',
      quality: 0.7,
    });
    if (!result.canceled && result.assets.length > 0) {
      setPhotoUri(result.assets[0].uri);
      closePopup(cameraPopupAnim, () => {
        setShowCameraPopup(false);
        setScene(4);
      });
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      let photoUrl = photoUri ?? '';

      // Try to upload to Supabase Storage
      if (photoUri) {
        const fileName = `listing_${Date.now()}.jpg`;
        const response = await fetch(photoUri);
        const blob = await response.blob();
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('listing-photos')
          .upload(fileName, blob, { contentType: 'image/jpeg' });
        if (!uploadError && uploadData) {
          const { data: publicData } = supabase.storage
            .from('listing-photos')
            .getPublicUrl(uploadData.path);
          photoUrl = publicData.publicUrl;
        }
      }

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        Alert.alert('Not logged in', 'Please log in before creating a listing.');
        return;
      }

      // TODO: replace with real period_type + per-unit price columns once schema is migrated.
      // Frontend captures pricePerHour, pricePerWeek, periodType in state; backend currently only persists price_per_hour.
      const { error } = await supabase.from('listings').insert({
        owner_id: userId,
        address: address,
        latitude: latitude,
        longitude: longitude,
        price_per_hour: 2,
        is_active: true,
        photo_url: photoUrl,
      });

      if (error) throw new Error(error.message);

      Alert.alert('Success!', 'Your listing has been created!', [
        {
          text: 'OK',
          onPress: () => router.replace('/Homescreen'),
        },
      ]);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Scene navigation helpers ────────────────────────────────────────────────

  const goToScene2 = () => setScene(2);

  const goToScene3 = () => {
    if (latitude === null || longitude === null) {
      Alert.alert('No location selected', 'Please select a location on the map first.');
      return;
    }
    setShowCameraPopup(true);
    setScene(3);
  };

  const goToScene4 = () => {
    closePopup(cameraPopupAnim, () => {
      setShowCameraPopup(false);
      setScene(4);
    });
  };

  const goToScene5 = () => {
    if (periodType === 0) {
      if (pricePerHour <= 0) {
        Alert.alert('Invalid price', 'Please set a price greater than $0.00.');
        return;
      }
      if (!dailyPopupDone.current) {
        openDailyPopup();
        return;
      }
      if (!totalsPopupDone.current) {
        openTotalsPopup();
        return;
      }
      dailyPopupDone.current = false;
      totalsPopupDone.current = false;
      setShowCalendarPopup(true);
      return;
    }
    // Weekly path
    if (pricePerWeek <= 0) {
      Alert.alert('Invalid price', 'Please set a price greater than $0.00.');
      return;
    }
    if (!monthlyPopupDone.current) {
      openMonthlyPopup();
      return;
    }
    if (!totalsPopupDone.current) {
      openTotalsPopup();
      return;
    }
    monthlyPopupDone.current = false;
    totalsPopupDone.current = false;
    setShowCalendarPopup(true);
  };

  const goBackFromScene3 = () => {
    closePopup(cameraPopupAnim, () => {
      setShowCameraPopup(false);
      setScene(2);
    });
  };

  const goBackFromScene5 = () => {
    // DateRangePicker handles its own slide-out animation when `visible` flips to false.
    setShowCalendarPopup(false);
  };

  // ── Daily popup helpers ─────────────────────────────────────────────────────

  const openDailyPopup = () => {
    const defaultDaily = Math.round(pricePerHour * 7 * 0.8 * 4) / 4;
    setPricePerDay(defaultDaily);
    pricePerDayRef.current = defaultDaily;
    setDailyEnabled(true);
    setDailyRateAccepted(false);
    setShowDailyPopup(true);
    dailyPopupAnim.setValue(POPUP_OFFSCREEN_Y);
    Animated.spring(dailyPopupAnim, {
      toValue: 0,
      damping: 14,
      stiffness: 130,
      mass: 1,
      useNativeDriver: true,
    }).start();
  };

  const dismissDailyPopup = (accepted = true, onDone?: () => void) => {
    // Mark done synchronously so a quick follow-up Continue press is not lost
    // while the slide-down animation is still in flight.
    dailyPopupDone.current = true;
    setDailyRateAccepted(accepted);
    Animated.spring(dailyPopupAnim, {
      toValue: POPUP_OFFSCREEN_Y,
      damping: 14,
      stiffness: 130,
      mass: 1,
      useNativeDriver: true,
    }).start(() => {
      setShowDailyPopup(false);
      onDone?.();
    });
  };

  const handleDailyToggle = (val: boolean) => {
    triggerLightHaptic();
    setDailyEnabled(val);
    if (!val) {
      setPricePerDay(null);
      pricePerDayRef.current = 0;
      dismissDailyPopup(false);
    }
  };

  // ── Monthly popup helpers ───────────────────────────────────────────────────

  const openMonthlyPopup = () => {
    const defaultMonthly = Math.round(pricePerWeek * 4 * 0.8 * 2) / 2;
    setPricePerMonth(defaultMonthly);
    pricePerMonthRef.current = defaultMonthly;
    setMonthlyEnabled(true);
    setMonthlyRateAccepted(false);
    setShowMonthlyPopup(true);
    monthlyPopupAnim.setValue(POPUP_OFFSCREEN_Y);
    Animated.spring(monthlyPopupAnim, {
      toValue: 0,
      damping: 14,
      stiffness: 130,
      mass: 1,
      useNativeDriver: true,
    }).start();
  };

  const dismissMonthlyPopup = (accepted = true, onDone?: () => void) => {
    // See dismissDailyPopup: set ref synchronously to avoid a lost Continue press.
    monthlyPopupDone.current = true;
    setMonthlyRateAccepted(accepted);
    Animated.spring(monthlyPopupAnim, {
      toValue: POPUP_OFFSCREEN_Y,
      damping: 14,
      stiffness: 130,
      mass: 1,
      useNativeDriver: true,
    }).start(() => {
      setShowMonthlyPopup(false);
      onDone?.();
    });
  };

  const handleMonthlyToggle = (val: boolean) => {
    triggerLightHaptic();
    setMonthlyEnabled(val);
    if (!val) {
      setPricePerMonth(null);
      pricePerMonthRef.current = 0;
      dismissMonthlyPopup(false);
    }
  };

  // ── Totals popup helpers ────────────────────────────────────────────────────

  const openTotalsPopup = () => {
    setShowTotalsPopup(true);
    totalsPopupAnim.setValue(POPUP_OFFSCREEN_Y);
    Animated.spring(totalsPopupAnim, {
      toValue: 0,
      damping: 14,
      stiffness: 130,
      mass: 1,
      useNativeDriver: true,
    }).start();
  };

  const dismissTotalsPopup = (onDone?: () => void) => {
    // Set ref synchronously so the next Continue press immediately advances.
    totalsPopupDone.current = true;
    Animated.spring(totalsPopupAnim, {
      toValue: POPUP_OFFSCREEN_Y,
      damping: 14,
      stiffness: 130,
      mass: 1,
      useNativeDriver: true,
    }).start(() => {
      setShowTotalsPopup(false);
      onDone?.();
    });
  };

  const renderCalendarOverlay = () => (
    <DateRangePicker
      visible={showCalendarPopup}
      initialStart={startDate}
      initialEnd={endDate}
      helperText="Finally, let's add the date."
      confirmLabel={submitting ? 'Creating...' : 'Looking good!'}
      confirmDisabled={submitting}
      onClose={goBackFromScene5}
      onConfirm={(start, end) => {
        setStartDate(start);
        setEndDate(end);
        handleSubmit();
      }}
    />
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Shared scene layout wrapper
  // ─────────────────────────────────────────────────────────────────────────────

  const renderSharedHeader = (helperText: string) => (
    <View style={styles.headerRow}>
      <View style={styles.headerLeft}>
        <Text style={styles.titleText}>Listing Creator</Text>
        <View style={styles.helperRow}>
          <Image source={accessibilityImg} style={styles.accessibilityIcon} />
          <Text style={styles.helperText}>{helperText}</Text>
        </View>
      </View>
      <Image source={spotonLogoAsset} style={styles.logo} />
    </View>
  );

  const renderBottomButtons = (
    onBack: () => void,
    onContinue: () => void,
    continueLabel = 'Continue'
  ) => (
    <View style={styles.bottomRow}>
      <TouchableOpacity style={styles.backCircle} onPress={withLightHaptic(onBack)} activeOpacity={0.8}>
        <Ionicons name="chevron-back" size={22} color="#fff" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.continueBtn} onPress={withLightHaptic(onContinue)} activeOpacity={0.8}>
        <Text style={styles.continueBtnText}>{continueLabel}</Text>
      </TouchableOpacity>
    </View>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Scene 1 — Welcome
  // ─────────────────────────────────────────────────────────────────────────────
  const renderScene1 = () => (
    <SafeAreaView style={styles.safeArea}>
      {renderSharedHeader(
        "Let's get you set up real quick. It only takes a few minutes to list your spot and start making money."
      )}
      <View style={styles.centerContent}>
        <Image source={carparkingImg} style={styles.carparkingImg} resizeMode="contain" />
      </View>
      {renderBottomButtons(() => router.back(), goToScene2)}
    </SafeAreaView>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Scene 2 — Pick Location
  // ─────────────────────────────────────────────────────────────────────────────
  const renderScene2 = () => (
    <SafeAreaView style={styles.safeArea}>
      {renderSharedHeader(
        'Pick your spot location by either tapping and holding on the map, or choose your current location.'
      )}
      <View style={styles.mapWrapper}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          initialRegion={GAINESVILLE}
          onLongPress={handleMapLongPress}
        >
          {latitude !== null && longitude !== null && (
            <Marker coordinate={{ latitude, longitude }} title="Your Spot" />
          )}
        </MapView>
        {/* Current Location button — bottom-left inside map area */}
        <TouchableOpacity
          style={styles.currentLocBtn}
          onPress={withLightHaptic(handleCurrentLocation)}
          activeOpacity={0.8}
        >
          <Image source={addLocationImg} style={styles.addLocationIcon} resizeMode="contain" />
        </TouchableOpacity>
      </View>
      {renderBottomButtons(() => setScene(1), goToScene3)}
    </SafeAreaView>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Scene 3 — Camera Pop-up (overlay on scene 2)
  // ─────────────────────────────────────────────────────────────────────────────
  const renderScene3 = () => (
    <SafeAreaView style={styles.safeArea}>
      {/* Dimmed map background */}
      {renderSharedHeader(
        'Pick your spot location by either tapping and holding on the map, or choose your current location.'
      )}
      <View style={[styles.mapWrapper, { opacity: 0.35 }]}>
        <MapView
          style={StyleSheet.absoluteFillObject}
          initialRegion={
            latitude !== null && longitude !== null
              ? { latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }
              : GAINESVILLE
          }
          scrollEnabled={false}
          zoomEnabled={false}
        >
          {latitude !== null && longitude !== null && (
            <Marker coordinate={{ latitude, longitude }} />
          )}
        </MapView>
      </View>
      <View style={styles.bottomRow}>
        <TouchableOpacity style={styles.backCircle} onPress={withLightHaptic(goBackFromScene3)} activeOpacity={0.8}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Camera Pop-up */}
      <Animated.View
        style={[styles.popup, { transform: [{ translateY: cameraPopupAnim }] }]}
      >
        <View style={styles.popupHelperRow}>
          <Image source={accessibilityImg} style={[styles.accessibilityIcon, { tintColor: '#fff' }]} />
          <Text style={styles.popupHelperText}>
            {"Let's add a photo of your spot. Press the camera to take the photo."}
          </Text>
        </View>
        <TouchableOpacity onPress={withLightHaptic(handleTakePhoto)} activeOpacity={0.85} style={styles.popupImageBtn}>
          <Image source={cameraanalogImg} style={styles.popupLargeImg} resizeMode="contain" />
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Shared rate popup renderer (daily & monthly share the same structure)
  // ─────────────────────────────────────────────────────────────────────────────

  const renderRatePopup = (opts: {
    visible: boolean;
    anim: Animated.Value;
    tagImage: any;
    enabled: boolean;
    onToggle: (v: boolean) => void;
    bodyText: string;
    price: number;
    panHandlers: any;
    onContinue: () => void;
  }) => {
    if (!opts.visible) return null;
    const TAG_H = W * 0.075;
    const TAG_W = TAG_H * 2;
    return (
      <Animated.View
        style={[
          styles.ratePopup,
          {
            bottom: W * 0.05 + insets.bottom,
            transform: [{ translateY: opts.anim }],
          },
        ]}
      >
        {/* Header row */}
        <View style={styles.ratePopupHeader}>
          {/* Tag image left-aligned, same distance as body text (card padding) */}
          <Image source={opts.tagImage} style={[styles.rateTagImage, { width: TAG_W, height: TAG_H }]} resizeMode="contain" />
          <Switch
            value={opts.enabled}
            onValueChange={opts.onToggle}
            trackColor={{ false: 'rgba(255,255,255,0.25)', true: 'rgba(255,255,255,0.85)' }}
            thumbColor={opts.enabled ? '#000' : 'rgba(255,255,255,0.9)'}
            ios_backgroundColor="rgba(255,255,255,0.25)"
            style={styles.rateSwitch}
          />
          {/* SpotOn logo circle — height matches tag */}
          <Image
            source={spotonLogoCircleAsset}
            style={[styles.ratePopupLogo, { width: TAG_H, height: TAG_H }]}
            resizeMode="contain"
          />
        </View>

        <Text style={styles.ratePopupBody}>{opts.bodyText}</Text>

        {/* Price scroller */}
        <View style={styles.ratePriceContainer} {...opts.panHandlers}>
          <Text style={styles.ratePriceText}>${opts.price.toFixed(2)}</Text>
        </View>

        <Text style={styles.ratePopupSubtext}>
          recommended for this listing, you can scroll to adjust
        </Text>

        {/* Continue — dismisses popup; user then presses original Continue */}
        <TouchableOpacity
          style={styles.ratePopupContinue}
          onPress={withLightHaptic(opts.onContinue)}
          activeOpacity={0.8}
        >
          <Text style={styles.ratePopupContinueText}>Continue</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const renderDailyPopup = () =>
    renderRatePopup({
      visible: showDailyPopup,
      anim: dailyPopupAnim,
      tagImage: dailyTagAsset,
      enabled: dailyEnabled,
      onToggle: handleDailyToggle,
      bodyText:
        'In addition, you can decide to set a daily price to influence buyers to extend reservations for longer.',
      price: pricePerDay ?? 0,
      panHandlers: dailyPanResponder.panHandlers,
      onContinue: () => dismissDailyPopup(true),
    });

  const renderMonthlyPopup = () =>
    renderRatePopup({
      visible: showMonthlyPopup,
      anim: monthlyPopupAnim,
      tagImage: monthlyTagAsset,
      enabled: monthlyEnabled,
      onToggle: handleMonthlyToggle,
      bodyText:
        'In addition, you can decide to set a monthly price to influence buyers to extend reservations for longer.',
      price: pricePerMonth ?? 0,
      panHandlers: monthlyPanResponder.panHandlers,
      onContinue: () => dismissMonthlyPopup(true),
    });

  // ─────────────────────────────────────────────────────────────────────────────
  // Totals popup — earnings breakdown rendered as a card-style popup that
  // animates up from below. Primary section is the user's selected period
  // (Hourly or Weekly); secondary section (Daily or Monthly) is shown only
  // after the user accepts that popup with Continue.
  // ─────────────────────────────────────────────────────────────────────────────
  const renderTotalsPopup = () => {
    if (!showTotalsPopup) return null;
    const fmt = (n: number) => `$${n.toFixed(2)}`;
    const isHourly = periodType === 0;
    const LOGO = W * 0.075;

    const primaryLabel = isHourly ? 'Hourly' : 'Weekly';
    const primaryGross = isHourly ? pricePerHour : pricePerWeek;
    const primaryFee = primaryGross * 0.15;
    const primaryNet = primaryGross - primaryFee;

    const showSecondary = isHourly ? dailyRateAccepted : monthlyRateAccepted;
    const secondaryLabel = isHourly ? 'Daily' : 'Monthly';
    const secondaryGross = (isHourly ? pricePerDay : pricePerMonth) ?? 0;
    const secondaryFee = secondaryGross * 0.15;
    const secondaryNet = secondaryGross - secondaryFee;

    return (
      <Animated.View
        style={[
          styles.ratePopup,
          styles.totalsPopup,
          {
            bottom: W * 0.05 + insets.bottom,
            transform: [{ translateY: totalsPopupAnim }],
          },
        ]}
      >
        <Image
          source={spotonLogoCircleAsset}
          style={[styles.totalsLogo, { width: LOGO, height: LOGO }]}
          resizeMode="contain"
        />

        <Text style={styles.breakdownSectionTitle}>{primaryLabel}</Text>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>Gross</Text>
          <Text style={styles.breakdownValue}>{fmt(primaryGross)}</Text>
        </View>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>SpotOn fee (15%)</Text>
          <Text style={styles.breakdownValue}>- {fmt(primaryFee)}</Text>
        </View>
        <View style={styles.breakdownDivider} />
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownTotalLabel}>You earn</Text>
          <Text style={styles.breakdownTotalValue}>{fmt(primaryNet)}</Text>
        </View>

        {showSecondary && (
          <>
            <View style={{ height: W * 0.035 }} />
            <Text style={styles.breakdownSectionTitle}>{secondaryLabel}</Text>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Gross</Text>
              <Text style={styles.breakdownValue}>{fmt(secondaryGross)}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>SpotOn fee (15%)</Text>
              <Text style={styles.breakdownValue}>- {fmt(secondaryFee)}</Text>
            </View>
            <View style={styles.breakdownDivider} />
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownTotalLabel}>You earn</Text>
              <Text style={styles.breakdownTotalValue}>{fmt(secondaryNet)}</Text>
            </View>
          </>
        )}

        <View style={{ height: W * 0.035 }} />
        <TouchableOpacity
          style={styles.ratePopupContinue}
          onPress={withLightHaptic(() => dismissTotalsPopup())}
          activeOpacity={0.8}
        >
          <Text style={styles.ratePopupContinueText}>Continue</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Scene 4 — Price Picker. Single select page; daily/monthly rate popup and
  // totals popup are rendered as overlays driven by Continue presses.
  // ─────────────────────────────────────────────────────────────────────────────
  const renderScene4 = () => renderScene4Select();

  const renderScene4Select = () => {
    const isHourly = periodType === 0;
    const displayPrice = isHourly ? pricePerHour : pricePerWeek;
    const unitLabel = isHourly ? '/hour' : '/week';
    const feeAmount = displayPrice * 0.15;
    const profit = displayPrice - feeAmount;
    return (
      <SafeAreaView style={styles.safeArea}>
        {renderSharedHeader("Finally let's set your price and dates.")}
        <View style={styles.selectContent}>
          <View style={styles.productImageWrap}>
            <Image
              source={addlistingimageAsset}
              defaultSource={addlistingimageAsset}
              fadeDuration={0}
              style={styles.productImage}
              resizeMode="contain"
            />
          </View>
          <View style={styles.selectControls}>
            <View style={styles.toggleRow}>
              <FilterToggle
                options={['Hourly', 'Weekly']}
                value={periodType}
                onChange={(n) => {
                  const next = (n as 0 | 1);
                  periodTypeRef.current = next;
                  setPeriodType(next);
                }}
              />
            </View>
            <View style={styles.priceContainer} {...pricePanResponder.panHandlers}>
              <Text style={styles.priceText}>${displayPrice.toFixed(2)}</Text>
              <Text style={styles.perHourText}>{unitLabel}</Text>
            </View>
            <Text style={styles.swipeHint}>Swipe up / down to adjust</Text>
            {isHourly && (
              <Text style={styles.feeNotice}>
                Please note SpotOn will take ${feeAmount.toFixed(2)} (15%), so your profit will be ${profit.toFixed(2)} /hour.
              </Text>
            )}
          </View>
        </View>
        {renderBottomButtons(
          () => {
            dailyPopupDone.current = false;
            monthlyPopupDone.current = false;
            totalsPopupDone.current = false;
            setDailyRateAccepted(false);
            setMonthlyRateAccepted(false);
            setPricePerDay(null);
            setPricePerMonth(null);
            pricePerDayRef.current = 0;
            pricePerMonthRef.current = 0;
            setScene(2);
          },
          goToScene5
        )}
        {renderDailyPopup()}
        {renderMonthlyPopup()}
        {renderTotalsPopup()}
        {renderCalendarOverlay()}
      </SafeAreaView>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Scene 5 — Legacy path retained for safety; calendar now renders as overlay in Scene 4.
  // ─────────────────────────────────────────────────────────────────────────────
  const renderScene5 = () => (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.scene5Dim} pointerEvents="none">
        {renderScene4Select()}
      </View>
      {renderCalendarOverlay()}
    </SafeAreaView>
  );

  // ─── Render ───────────────────────────────────────────────────────────────
  switch (scene) {
    case 1: return renderScene1();
    case 2: return renderScene2();
    case 3: return renderScene3();
    case 4: return renderScene4();
    case 5: return renderScene5();
    default: return renderScene1();
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#DCDBD8',
  },

  // ── Header ─────────────────────────────────────────────────────────────────
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: H_PAD,
    paddingTop: W * 0.03,
    paddingBottom: W * 0.03,
  },
  headerLeft: {
    flex: 1,
    paddingRight: W * 0.04,
  },
  titleText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 22,
    color: '#000',
    marginBottom: W * 0.02,
  },
  helperRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: W * 0.02,
  },
  accessibilityIcon: {
    width: 18,
    height: 18,
    marginTop: 2,
  },
  helperText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: 13,
    color: '#333',
    flex: 1,
    lineHeight: 18,
  },
  logo: {
    width: W * 0.15,
    height: W * 0.15,
    opacity: 0.75,
    resizeMode: 'contain',
  },

  // ── Content center ─────────────────────────────────────────────────────────
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: H_PAD,
  },

  // ── Scene 1 ────────────────────────────────────────────────────────────────
  carparkingImg: {
    width: W * 0.8,
    height: W * 0.8,
  },

  // ── Scene 2 / 3 Map ────────────────────────────────────────────────────────
  mapWrapper: {
    flex: 1,
    marginHorizontal: H_PAD,
    marginBottom: W * 0.03,
    borderRadius: 15,
    overflow: 'hidden',
  },
  currentLocBtn: {
    position: 'absolute',
    bottom: W * 0.04,
    left: W * 0.04,
    width: 48,
    height: 48,
    borderRadius: 100,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLocationIcon: {
    width: 26,
    height: 26,
    tintColor: '#fff',
  },

  // ── Bottom buttons ─────────────────────────────────────────────────────────
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: H_PAD,
    paddingBottom: W * 0.05,
    paddingTop: W * 0.03,
    gap: W * 0.03,
  },
  backCircle: {
    width: 50,
    height: 50,
    borderRadius: 100,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueBtn: {
    flex: 1,
    height: BOTTOM_ACTION_HEIGHT,
    borderRadius: BOTTOM_ACTION_RADIUS,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueBtnText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 16,
    color: '#fff',
  },

  // ── Pop-ups ────────────────────────────────────────────────────────────────
  popup: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    paddingTop: W * 0.05,
    paddingBottom: W * 0.06,
    paddingHorizontal: H_PAD,
    minHeight: H * 0.52,
    justifyContent: 'space-between',
  },
  popupHelperRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: W * 0.02,
    marginBottom: W * 0.04,
  },
  popupHelperText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: 13,
    color: '#fff',
    flex: 1,
    lineHeight: 18,
  },
  popupImageBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  popupLargeImg: {
    width: W * 0.55,
    height: W * 0.55,
  },

  // ── Scene 4 Price ──────────────────────────────────────────────────────────
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingVertical: W * 0.04,
    paddingHorizontal: W * 0.1,
  },
  priceText: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: W * 0.16,
    color: '#000',
    lineHeight: W * 0.18,
  },
  perHourText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: W * 0.038,
    color: '#333',
    marginBottom: W * 0.03,
    marginLeft: 4,
  },
  swipeHint: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: W * 0.033,
    color: 'rgba(0,0,0,0.5)',
    marginTop: W * 0.005,
  },

  // ── Calendar ───────────────────────────────────────────────────────────────
  calendarContainer: {
    flex: 1,
  },
  calendarNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: W * 0.03,
  },
  calendarMonthText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 15,
    color: '#fff',
  },
  calendarDaysRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: W * 0.02,
  },
  calendarDayLabel: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    width: (W - H_PAD * 2) / 7,
    textAlign: 'center',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarCell: {
    width: (W - H_PAD * 2) / 7,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  calendarCellSelected: {
    backgroundColor: '#fff',
  },
  calendarCellRange: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  calendarDayText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: 13,
    color: '#fff',
  },
  calendarDayTextSelected: {
    fontFamily: CustomFonts.SwitzerSemibold,
    color: '#000',
  },
  calendarRangeHint: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginTop: W * 0.02,
    marginBottom: W * 0.02,
  },

  // ── Scene 4 — Pricing (new design) ─────────────────────────────────────────
  selectContent: {
    flex: 1,
    paddingHorizontal: H_PAD,
  },
  productImageWrap: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: W * 0.02,
    overflow: 'hidden',
  },
  productImage: {
    width: PRICE_IMAGE_SIZE,
    height: PRICE_IMAGE_SIZE,
  },
  preloadImage: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    top: 0,
    left: 0,
  },
  selectControls: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: W * 0.02,
    paddingBottom: W * 0.02,
  },
  toggleRow: {
    width: '100%',
    marginBottom: W * 0.02,
  },
  feeNotice: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: W * 0.032,
    color: '#444',
    textAlign: 'center',
    marginTop: W * 0.025,
    paddingHorizontal: W * 0.02,
    lineHeight: W * 0.045,
  },
  breakdownWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: H_PAD,
    paddingTop: W * 0.02,
  },
  breakdownContainer: {
    width: '100%',
    paddingVertical: W * 0.06,
    paddingHorizontal: W * 0.06,
    borderRadius: W * 0.05,
    backgroundColor: '#000',
  },
  breakdownLogo: {
    position: 'absolute',
    top: W * 0.04,
    right: W * 0.06,
    opacity: 0.9,
  },
  breakdownSectionTitle: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: W * 0.045,
    color: '#fff',
    marginBottom: W * 0.02,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: W * 0.012,
  },
  breakdownLabel: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: W * 0.037,
    color: 'rgba(255,255,255,0.75)',
  },
  breakdownValue: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: W * 0.04,
    color: '#fff',
  },
  breakdownDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginVertical: W * 0.02,
  },
  breakdownTotalLabel: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: W * 0.045,
    color: '#fff',
  },
  breakdownTotalValue: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: W * 0.05,
    color: '#fff',
  },
  scene5Dim: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.35,
  },

  // ── Rate Popups (Daily + Monthly share these styles) ───────────────────────
  ratePopup: {
    position: 'absolute',
    left: H_PAD,
    right: H_PAD,
    backgroundColor: '#000',
    borderRadius: BOTTOM_ACTION_RADIUS,
    paddingTop: W * 0.045,
    paddingBottom: W * 0.045,
    paddingHorizontal: W * 0.05,
    zIndex: 20,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
  },
  ratePopupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    // tag left-aligned, logo pinned right with flex spacer
    marginBottom: W * 0.03,
    gap: W * 0.025,
  },
  rateTagImage: {
    resizeMode: 'contain',
  },
  rateSwitch: {
    transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }],
    marginLeft: -W * 0.01, // tighten gap left by Switch's invisible padding
  },
  ratePopupLogo: {
    // size set inline to match tag height
    opacity: 0.9,
    marginLeft: 'auto' as any, // push logo to the right edge
  },
  ratePopupBody: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: W * 0.034,
    color: '#fff',
    lineHeight: W * 0.05,
    marginBottom: W * 0.025,
  },
  ratePriceContainer: {
    alignItems: 'center',
    paddingVertical: W * 0.025,
  },
  ratePriceText: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: W * 0.13,
    color: '#fff',
    lineHeight: W * 0.15,
  },
  ratePopupSubtext: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: W * 0.029,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    marginBottom: W * 0.04,
  },
  ratePopupContinue: {
    height: 44,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratePopupContinueText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 15,
    color: '#fff',
  },

  // ── Totals popup overrides ─────────────────────────────────────────────────
  totalsPopup: {
    paddingTop: W * 0.055,
    paddingBottom: W * 0.045,
    paddingHorizontal: W * 0.06,
  },
  totalsLogo: {
    position: 'absolute',
    top: W * 0.04,
    right: W * 0.05,
    opacity: 0.9,
    zIndex: 1,
  },
});
