/**
 * CreateListing2 — 3-step listing creation flow.
 *
 * Step 1 (scene 2): Pick location (map). Carries the one-line intro that used
 *                   to be its own Welcome scene.
 * Step 2 (scene 3): Camera card on the plain page background.
 * Step 3 (scene 4): Price & availability — main rate, optional secondary rate
 *                   (daily for hourly / monthly for weekly), availability dates
 *                   and an earnings summary, all on one screen. "List my spot"
 *                   submits (opening the date picker first if no dates are set).
 *
 * Scene numbers are kept from the old 5-scene flow so the history reads cleanly.
 * Testers found the old flow (Welcome → Location → Photo → Price → rate popup →
 * totals popup → calendar, ~7 Continues) long, and the fee notice abrupt.
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
  Platform,
  StyleSheet,
  Dimensions,
  Alert,
  PanResponder,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Navigation ───────────────────────────────────────────────────────────────
import { useRouter } from 'expo-router';

// ─── Icons ────────────────────────────────────────────────────────────────────
import { Ionicons } from '@expo/vector-icons';

// ─── Map ──────────────────────────────────────────────────────────────────────
import MapView, { Marker, Region } from 'react-native-maps';

// ─── Location ─────────────────────────────────────────────────────────────────
import * as Location from 'expo-location';

// ─── Constants ────────────────────────────────────────────────────────────────
import { CustomFonts } from '@/src/constants/theme';

// ─── Supabase ─────────────────────────────────────────────────────────────────
import { supabase } from '../utils/supabase';

// ─── Components ───────────────────────────────────────────────────────────────
import DateRangePicker from '@/src/components/DateRangePicker';
import FilterToggle from '@/src/components/FilterToggle';
import ListingCameraCard from '@/src/components/camera/ListingCameraCard';
import { triggerLightHaptic, triggerSelectionHaptic, withLightHaptic } from '@/src/utils/haptics';
import { formatReverseGeocodeAddress } from '@/src/utils/geocode';
import { safeBack, useHardwareBack } from '@/src/utils/navigation';

// ─── Assets ───────────────────────────────────────────────────────────────────
import addLocationImg from '@/assets/images/add_location.png';
import spotonLogoAsset from '@/assets/images/spotonlogo.png';
import addlistingimageAsset from '@/assets/images/addlistingimage.png';
import dailyTagAsset from '@/assets/images/DailyTag.png';
import monthlyTagAsset from '@/assets/images/MonthlyTag.png';

// ─── Sizing ───────────────────────────────────────────────────────────────────
const { width: W } = Dimensions.get('window');
const H_PAD = W * 0.06;
const BOTTOM_ACTION_HEIGHT = 50;

// Helper-row glyph per step (location → photo → price). Replaces a stock
// "accessibility" figure that testers read as a stray person icon.
const STEP_ICONS = ['location-outline', 'camera-outline', 'pricetag-outline'] as const;
const BOTTOM_ACTION_RADIUS = BOTTOM_ACTION_HEIGHT / 2;
const TAG_H = W * 0.065;
const TAG_W = TAG_H * 2;

// Default region — Gainesville, FL
const GAINESVILLE: Region = {
  latitude: 29.6516,
  longitude: -82.3248,
  latitudeDelta: 0.04,
  longitudeDelta: 0.04,
};

// Suggested secondary rates (same formulas the old daily/monthly popups used):
// daily = 7 hours at 20% off, monthly = 4 weeks at 20% off.
const suggestedDailyRate = (hourly: number) => Math.round(hourly * 7 * 0.8 * 4) / 4;
const suggestedMonthlyRate = (weekly: number) => Math.round(weekly * 4 * 0.8 * 2) / 2;

// TODO(fee-model): this screen tells hosts SpotOn takes 15% OUT of their price
// on every tier. backend/utils/pricing.py (calculate_final_price / _fee_rate)
// instead ADDS the fee on top for the renter (host_payout = subtotal) and uses
// 7% for weekly/monthly. The team hasn't decided which is intended — the copy
// and math here are unchanged from the old totals popup until they do.
const DISPLAY_FEE_RATE = 0.15;

const formatShortDate = (d: Date) =>
  d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// ─── Rate payload builder ─────────────────────────────────────────────────────
function buildRatePayload(state: {
  periodType: 0 | 1;
  pricePerHour: number;
  pricePerDay: number | null;
  pricePerWeek: number;
  pricePerMonth: number | null;
  dailyRateAccepted: boolean;
  monthlyRateAccepted: boolean;
}): {
  hourly_rate: number | null;
  daily_rate: number | null;
  weekly_rate: number | null;
  monthly_rate: number | null;
  price_per_hour: number;
} {
  if (state.periodType === 0) {
    return {
      hourly_rate: state.pricePerHour,
      daily_rate: state.dailyRateAccepted ? state.pricePerDay : null,
      weekly_rate: null,
      monthly_rate: null,
      price_per_hour: state.pricePerHour,
    };
  }
  return {
    hourly_rate: null,
    daily_rate: null,
    weekly_rate: state.pricePerWeek,
    monthly_rate: state.monthlyRateAccepted ? state.pricePerMonth : null,
    price_per_hour: state.pricePerWeek / 168,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────
// Outside the component: react-hooks/purity can't prove handleSubmit never
// runs during render, and Date.now() inside a component body is flagged.
const newListingPhotoName = () => `listing_${Date.now()}.jpg`;

export default function CreateListing2() {
  const router = useRouter();

  // ── Scene state ────────────────────────────────────────────────────────────
  // 2 = location, 3 = photo (camera card over the map), 4 = price & availability.
  const [scene, setScene] = useState<2 | 3 | 4>(2);

  // ── Collected data ─────────────────────────────────────────────────────────
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [address, setAddress] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [pricePerHour, setPricePerHour] = useState(3.0);
  const [pricePerWeek, setPricePerWeek] = useState(50);
  const [periodType, setPeriodType] = useState<0 | 1>(0); // 0 = Hourly, 1 = Weekly
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);

  // ── Secondary rates (inline, optional) ─────────────────────────────────────
  // On by default with a suggested value — the old popup also opened switched
  // on and its Continue accepted it, so this keeps the same default outcome.
  const [pricePerDay, setPricePerDay] = useState<number | null>(suggestedDailyRate(3.0));
  const [dailyRateAccepted, setDailyRateAccepted] = useState(true);
  const [pricePerMonth, setPricePerMonth] = useState<number | null>(suggestedMonthlyRate(50));
  const [monthlyRateAccepted, setMonthlyRateAccepted] = useState(true);

  const [userId, setUserId] = useState<string | null>(null);

  // ── Pop-up visibility ──────────────────────────────────────────────────────
  const [showCameraPopup, setShowCameraPopup] = useState(false);
  const [showCalendarPopup, setShowCalendarPopup] = useState(false);
  // 'edit' = opened from the Availability row, just saves the dates.
  // 'submit' = opened by "List my spot" with no dates yet; confirming lists it.
  const [calendarMode, setCalendarMode] = useState<'edit' | 'submit'>('edit');
  const [submitting, setSubmitting] = useState(false);
  // State updates land a render late; two taps in one frame would both see
  // submitting=false and insert two listings. The ref is synchronous.
  const submittingRef = useRef(false);

  // ── Map ref for animating to location ─────────────────────────────────────
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    // Listing creation is zero-friction: no Stripe account required. Sellers set
    // up payouts later, after they've earned money (deferred onboarding).
    const initialize = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Authentication Error', 'You need to be logged in to create a listing.', [
          { text: 'OK', onPress: () => router.replace('/Intro') },
        ]);
        return;
      }
      setUserId(user.id);
    };

    initialize();
  }, []);

  // The camera card animates its own entrance and exit (UI thread, gesture-
  // driven dismiss), so closing here is just the state change it calls back into.
  const closeCameraPopup = (cb?: () => void) => {
    cb?.();
  };

  // ── Price PanResponders ────────────────────────────────────────────────────
  // Built once via useRef, so they read refs (not state) to avoid stale
  // closures. Separate refs keep Hourly and Weekly values when toggling.
  const priceRef = useRef(3.0);
  const priceWeekRef = useRef(50);
  const pricePerDayRef = useRef(suggestedDailyRate(3.0));
  const pricePerMonthRef = useRef(suggestedMonthlyRate(50));
  const periodTypeRef = useRef<0 | 1>(0);
  // Until the host drags a secondary rate themselves, it follows the main rate
  // (what the old popup did by recomputing its default each time it opened).
  const dailyTouched = useRef(false);
  const monthlyTouched = useRef(false);
  const lastY = useRef<number | null>(null);
  const lastYDaily = useRef<number | null>(null);
  const lastYMonthly = useRef<number | null>(null);

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
          if (!dailyTouched.current) {
            pricePerDayRef.current = suggestedDailyRate(priceRef.current);
            setPricePerDay(pricePerDayRef.current);
          }
        } else {
          const delta = steps * 1 * dir;
          priceWeekRef.current = Math.max(0, Math.round(priceWeekRef.current + delta));
          setPricePerWeek(priceWeekRef.current);
          if (!monthlyTouched.current) {
            pricePerMonthRef.current = suggestedMonthlyRate(priceWeekRef.current);
            setPricePerMonth(pricePerMonthRef.current);
          }
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
        dailyTouched.current = true;
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
        monthlyTouched.current = true;
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
        const formatted = formatReverseGeocodeAddress(results[0]);
        setAddress(formatted);
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
        const formatted = formatReverseGeocodeAddress(results[0]);
        setAddress(formatted);
      }
    } catch (_) {}
  };

  useEffect(() => {
    if (scene === 2) {
      // Location is a convenience; it must not prevent the map itself from
      // mounting if permission or GPS lookup fails.
      handleCurrentLocation().catch((error) => {
        console.warn('[CreateListing2] current location unavailable:', error);
      });
    }
  }, [scene]);

  // Called by ListingCameraCard when the user accepts a photo (taken in-app or
  // picked from the library). Same URI handling as the old launchCameraAsync
  // result: stored as-is, uploaded in handleSubmit.
  const handlePhotoConfirmed = (uri: string) => {
    setPhotoUri(uri);
    closeCameraPopup(() => {
      setShowCameraPopup(false);
      setScene(4);
    });
  };

  // Same checks, same messages as before; shared by "List my spot" (so the date
  // picker never opens over an invalid price) and handleSubmit itself.
  const validatePrices = () => {
    if (periodType === 0 && pricePerHour <= 0) {
      Alert.alert('Invalid price', 'Please set a price greater than $0.00.');
      return false;
    }
    if (periodType === 0 && dailyRateAccepted && (pricePerDay === null || pricePerDay <= 0)) {
      Alert.alert('Invalid daily rate', 'Please set a daily rate greater than $0.00.');
      return false;
    }
    if (periodType === 1 && pricePerWeek <= 0) {
      Alert.alert('Invalid price', 'Please set a price greater than $0.00.');
      return false;
    }
    if (periodType === 1 && monthlyRateAccepted && (pricePerMonth === null || pricePerMonth <= 0)) {
      Alert.alert('Invalid monthly rate', 'Please set a monthly rate greater than $0.00.');
      return false;
    }
    return true;
  };

  const handleSubmit = async (dateRange?: { start: Date | null; end: Date | null }) => {
    // Calendar's onConfirm calls setStartDate/setEndDate + handleSubmit synchronously,
    // so this render still sees the old state. Prefer the freshly-picked dates.
    const chosenStart = dateRange?.start ?? startDate;
    const chosenEnd = dateRange?.end ?? endDate;
    if (submittingRef.current || !validatePrices()) return;

    submittingRef.current = true;
    setSubmitting(true);
    try {
      let photoUrl = photoUri ?? '';

      // Try to upload to Supabase Storage
      if (photoUri) {
        const fileName = newListingPhotoName();
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

      if (!userId) {
        Alert.alert('Not logged in', 'Please log in before creating a listing.');
        setSubmitting(false);
        return;
      }

      const ratePayload = buildRatePayload({
        periodType,
        pricePerHour,
        pricePerDay,
        pricePerWeek,
        pricePerMonth,
        dailyRateAccepted,
        monthlyRateAccepted,
      });

      const { error } = await supabase.from('listings').insert({
        owner_id: userId,
        address: address,
        latitude: latitude,
        longitude: longitude,
        ...ratePayload,
        is_active: true,
        photo_url: photoUrl,
        available_from: chosenStart ? chosenStart.toISOString() : null,
        available_until: chosenEnd ? chosenEnd.toISOString() : null,
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
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  // ── Scene navigation helpers ────────────────────────────────────────────────

  const goToScene3 = () => {
    if (latitude === null || longitude === null) {
      Alert.alert('No location selected', 'Please select a location on the map first.');
      return;
    }
    setShowCameraPopup(true);
    setScene(3);
  };

  const goBackFromScene3 = () => {
    closeCameraPopup(() => {
      setShowCameraPopup(false);
      setScene(2);
    });
  };

  // Step 3 → step 2 (photo). The photo already taken stays in state until a
  // new one is confirmed.
  const goBackFromScene4 = () => {
    setShowCameraPopup(true);
    setScene(3);
  };

  // Android system back walks the steps (3 → 2 → 1) instead of dropping the
  // whole flow; on step 1 it leaves the screen as usual. An open date picker
  // closes first.
  useHardwareBack(() => {
    if (showCalendarPopup) {
      if (!submitting) setShowCalendarPopup(false);
      return true;
    }
    if (scene === 4) {
      goBackFromScene4();
      return true;
    }
    if (scene === 3) {
      goBackFromScene3();
      return true;
    }
    return false;
  });

  // "List my spot". A start date has always been required (the picker can't
  // confirm without one), so with none set yet the picker opens in submit mode
  // and its confirm lists the spot — no extra step when dates are already set.
  const handleListPress = () => {
    if (submitting || !validatePrices()) return;
    if (!startDate) {
      setCalendarMode('submit');
      setShowCalendarPopup(true);
      return;
    }
    handleSubmit();
  };

  const openAvailabilityPicker = () => {
    setCalendarMode('edit');
    setShowCalendarPopup(true);
  };

  const handleDailyToggle = (val: boolean) => {
    triggerLightHaptic();
    setDailyRateAccepted(val);
  };

  const handleMonthlyToggle = (val: boolean) => {
    triggerLightHaptic();
    setMonthlyRateAccepted(val);
  };

  const renderCalendarOverlay = () => (
    <DateRangePicker
      visible={showCalendarPopup}
      initialStart={startDate}
      initialEnd={endDate}
      helperText={
        calendarMode === 'submit'
          ? "Last thing: when is your spot available?"
          : 'When is your spot available?'
      }
      confirmLabel={
        calendarMode === 'submit' ? (submitting ? 'Creating...' : 'List my spot') : 'Save dates'
      }
      confirmDisabled={submitting}
      // DateRangePicker handles its own slide-out animation when `visible` flips to false.
      onClose={() => setShowCalendarPopup(false)}
      onConfirm={(start, end) => {
        setStartDate(start);
        setEndDate(end);
        if (calendarMode === 'submit') {
          handleSubmit({ start, end });
        } else {
          setShowCalendarPopup(false);
        }
      }}
    />
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Shared scene layout wrapper
  // ─────────────────────────────────────────────────────────────────────────────

  const renderSharedHeader = (helperText: string, step: number) => (
    <View style={styles.headerRow}>
      <View style={styles.headerLeft}>
        <Text style={styles.titleText}>Listing Creator</Text>
        <Text style={styles.stepText}>Step {step} of 3</Text>
        <View style={styles.helperRow}>
          <Ionicons
            name={STEP_ICONS[step - 1] ?? 'information-circle-outline'}
            size={18}
            color="#333"
            style={styles.helperIcon}
          />
          <Text style={styles.helperText}>{helperText}</Text>
        </View>
      </View>
      <Image source={spotonLogoAsset} style={styles.logo} />
    </View>
  );

  const renderBottomButtons = (
    onBack: () => void,
    onContinue: () => void,
    continueLabel = 'Continue',
    continueDisabled = false,
  ) => (
    <View style={styles.bottomRow}>
      <TouchableOpacity
        style={styles.backCircle}
        onPress={withLightHaptic(onBack)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={22} color="#fff" />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.continueBtn, continueDisabled && styles.continueBtnDisabled]}
        onPress={withLightHaptic(onContinue)}
        disabled={continueDisabled}
        activeOpacity={0.8}
      >
        <Text style={styles.continueBtnText}>{continueLabel}</Text>
      </TouchableOpacity>
    </View>
  );

  const locationHelper =
    "List your spot in about a minute. Tap and hold on the map to drop a pin, or use your current location.";

  // ─────────────────────────────────────────────────────────────────────────────
  // Scene 2 — Pick Location (first step; absorbs the old Welcome intro)
  // ─────────────────────────────────────────────────────────────────────────────
  const renderScene2 = () => (
    <SafeAreaView style={styles.safeArea}>
      {renderSharedHeader(locationHelper, 1)}
      <View style={styles.mapWrapper}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={GAINESVILLE}
          onMapReady={() => {
            if (latitude !== null && longitude !== null) {
              mapRef.current?.animateToRegion(
                { latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 },
                0,
              );
            }
          }}
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
          accessibilityRole="button"
          accessibilityLabel="Use my current location"
        >
          <Image source={addLocationImg} style={styles.addLocationIcon} resizeMode="contain" />
        </TouchableOpacity>
      </View>
      {renderBottomButtons(() => safeBack('/Homescreen'), goToScene3)}
    </SafeAreaView>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Scene 3 — Camera Pop-up (overlay on scene 2)
  // ─────────────────────────────────────────────────────────────────────────────
  const renderScene3 = () => (
    <SafeAreaView style={styles.safeArea}>
      {renderSharedHeader('Snap a photo of your spot so renters know where to park.', 2)}
      {/* Solid page background, like steps 1 and 3. This used to be the step-1
          map at 35% opacity, but the camera card's header ("Let's add a photo
          to your listing.") floats above the card and the map's street labels
          showed through behind it. */}
      <View style={styles.photoBackdrop} />

      {/* Camera pop-up — floating live card + tap-away backdrop, self-animated.
          Mounted only while open so the camera session stops on close. */}
      {showCameraPopup && (
        <ListingCameraCard onBack={goBackFromScene3} onConfirm={handlePhotoConfirmed} />
      )}
    </SafeAreaView>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Scene 4 — Price & availability. Everything that used to be three popups and
  // a calendar step lives inline here. No ScrollView on purpose: the prices are
  // adjusted by vertical swipes, which a ScrollView would steal. The decorative
  // image shrinks to whatever room is left instead.
  // ─────────────────────────────────────────────────────────────────────────────

  const renderSecondaryRate = () => {
    const isHourly = periodType === 0;
    const enabled = isHourly ? dailyRateAccepted : monthlyRateAccepted;
    const price = (isHourly ? pricePerDay : pricePerMonth) ?? 0;
    return (
      <View style={styles.rateCard}>
        <View style={styles.rateCardLeft}>
          <View style={styles.rateCardHeader}>
            <Image
              source={isHourly ? dailyTagAsset : monthlyTagAsset}
              style={{ width: TAG_W, height: TAG_H }}
              resizeMode="contain"
            />
            <Switch
              value={enabled}
              onValueChange={isHourly ? handleDailyToggle : handleMonthlyToggle}
              // Opaque colours: Android draws translucent tracks over this
              // black card as an invisible track with a clipped white thumb.
              // Android's thumb also overhangs the track, so a black ON thumb
              // vanishes into the card — use white-on-green there instead.
              trackColor={{ false: '#5A5A5A', true: Platform.OS === 'android' ? '#34C759' : '#FFFFFF' }}
              thumbColor={enabled ? (Platform.OS === 'android' ? '#FFFFFF' : '#000000') : '#E6E6E6'}
              ios_backgroundColor="#5A5A5A"
              style={styles.rateSwitch}
              accessibilityLabel={isHourly ? 'Offer a daily rate' : 'Offer a monthly rate'}
            />
          </View>
          <Text style={styles.rateCardBody}>
            {isHourly
              ? 'Optional: a daily price encourages longer stays.'
              : 'Optional: a monthly price encourages longer stays.'}
          </Text>
        </View>
        {enabled && (
          <View
            style={styles.rateCardPrice}
            {...(isHourly ? dailyPanResponder.panHandlers : monthlyPanResponder.panHandlers)}
          >
            <Text style={styles.rateCardPriceText}>${price.toFixed(2)}</Text>
            <Text style={styles.rateCardHint}>swipe to adjust</Text>
          </View>
        )}
      </View>
    );
  };

  const renderAvailabilityRow = () => {
    let value = 'Choose dates';
    if (startDate && endDate) value = `${formatShortDate(startDate)} – ${formatShortDate(endDate)}`;
    else if (startDate) value = `From ${formatShortDate(startDate)}`;
    return (
      <TouchableOpacity
        style={styles.availabilityRow}
        onPress={withLightHaptic(openAvailabilityPicker)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`Availability: ${value}`}
      >
        <Ionicons name="calendar-outline" size={20} color="#000" />
        <Text style={styles.availabilityLabel}>Available</Text>
        <Text style={[styles.availabilityValue, !startDate && styles.availabilityPlaceholder]} numberOfLines={1}>
          {value}
        </Text>
        <Ionicons name="chevron-forward" size={18} color="rgba(0,0,0,0.5)" />
      </TouchableOpacity>
    );
  };

  // Compact replacement for the old totals popup + mid-flow fee notice. Same
  // numbers and wording ("SpotOn fee (15%)", "You earn") — see TODO(fee-model).
  const renderEarningsSummary = () => {
    const fmt = (n: number) => `$${n.toFixed(2)}`;
    const isHourly = periodType === 0;
    const rows: { label: string; gross: number }[] = [
      { label: isHourly ? 'Hourly' : 'Weekly', gross: isHourly ? pricePerHour : pricePerWeek },
    ];
    const showSecondary = isHourly ? dailyRateAccepted : monthlyRateAccepted;
    if (showSecondary) {
      rows.push({
        label: isHourly ? 'Daily' : 'Monthly',
        gross: (isHourly ? pricePerDay : pricePerMonth) ?? 0,
      });
    }
    return (
      <View style={styles.summaryCard}>
        {rows.map((r, i) => {
          const fee = r.gross * DISPLAY_FEE_RATE;
          return (
            <View key={r.label} style={[styles.summaryRow, i > 0 && styles.summaryRowDivided]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryLabel}>{r.label}</Text>
                <Text style={styles.summaryDetail}>
                  {fmt(r.gross)} − SpotOn fee (15%) {fmt(fee)}
                </Text>
              </View>
              <View style={styles.summaryEarnWrap}>
                <Text style={styles.summaryEarnLabel}>You earn</Text>
                <Text style={styles.summaryEarnValue}>{fmt(r.gross - fee)}</Text>
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const renderScene4 = () => {
    const isHourly = periodType === 0;
    const displayPrice = isHourly ? pricePerHour : pricePerWeek;
    const unitLabel = isHourly ? '/hour' : '/week';
    return (
      <SafeAreaView style={styles.safeArea}>
        {renderSharedHeader('Set your price and when your spot is available.', 3)}
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
          </View>
          {renderSecondaryRate()}
          {renderAvailabilityRow()}
          {renderEarningsSummary()}
        </View>
        {renderBottomButtons(
          goBackFromScene4,
          handleListPress,
          submitting ? 'Creating...' : 'List my spot',
          submitting,
        )}
        {renderCalendarOverlay()}
      </SafeAreaView>
    );
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  switch (scene) {
    case 3: return renderScene3();
    case 4: return renderScene4();
    case 2:
    default: return renderScene2();
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
  },
  stepText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: 12,
    color: 'rgba(0,0,0,0.55)',
    marginTop: 2,
    marginBottom: W * 0.02,
  },
  helperRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: W * 0.02,
  },
  helperIcon: {
    marginTop: 0,
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

  // ── Location / photo map ───────────────────────────────────────────────────
  mapWrapper: {
    flex: 1,
    marginHorizontal: H_PAD,
    marginBottom: W * 0.03,
    borderRadius: 15,
    overflow: 'hidden',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  photoBackdrop: {
    flex: 1,
    backgroundColor: '#DCDBD8',
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
  continueBtnDisabled: {
    opacity: 0.6,
  },
  continueBtnText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 16,
    color: '#fff',
  },

  // ── Price & availability ───────────────────────────────────────────────────
  selectContent: {
    flex: 1,
    paddingHorizontal: H_PAD,
    gap: W * 0.025,
  },
  // Decorative; takes only the room left over after the controls, down to zero
  // on small phones.
  productImageWrap: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  productImage: {
    width: '100%',
    height: '100%',
  },
  selectControls: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  toggleRow: {
    width: '100%',
    marginBottom: W * 0.01,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingVertical: W * 0.02,
    paddingHorizontal: W * 0.1,
  },
  priceText: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: W * 0.15,
    color: '#000',
    lineHeight: W * 0.17,
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
  },

  // Secondary (daily / monthly) rate — inline version of the old rate popup.
  rateCard: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000',
    borderRadius: W * 0.05,
    borderCurve: 'continuous',
    paddingVertical: W * 0.035,
    paddingHorizontal: W * 0.05,
    gap: W * 0.03,
  },
  rateCardLeft: {
    flex: 1,
  },
  rateCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: W * 0.02,
    marginBottom: W * 0.015,
  },
  // iOS's switch is large next to the "Daily" tag, so it's scaled down there.
  // Android's is already compact, and scaling it clipped the thumb.
  rateSwitch: Platform.OS === 'ios'
    ? {
        transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }],
        marginLeft: -W * 0.01, // tighten gap left by Switch's invisible padding
      }
    : {},
  rateCardBody: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: W * 0.031,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: W * 0.043,
  },
  rateCardPrice: {
    alignItems: 'center',
    paddingVertical: W * 0.01,
    paddingHorizontal: W * 0.02,
  },
  rateCardPriceText: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: W * 0.075,
    color: '#fff',
  },
  rateCardHint: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: W * 0.026,
    color: 'rgba(255,255,255,0.55)',
  },

  // Availability — a real control, so it reads as a tappable row (chevron).
  availabilityRow: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderRadius: W * 0.04,
    borderCurve: 'continuous',
    paddingVertical: W * 0.035,
    paddingHorizontal: W * 0.045,
    gap: W * 0.025,
  },
  availabilityLabel: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: W * 0.038,
    color: '#000',
  },
  availabilityValue: {
    flex: 1,
    textAlign: 'right',
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: W * 0.036,
    color: '#000',
  },
  availabilityPlaceholder: {
    color: 'rgba(0,0,0,0.5)',
  },

  // Earnings summary — compact replacement for the old totals popup.
  summaryCard: {
    flexShrink: 0,
    borderRadius: W * 0.04,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    paddingHorizontal: W * 0.045,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: W * 0.025,
    gap: W * 0.03,
  },
  summaryRowDivided: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  summaryLabel: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: W * 0.036,
    color: '#000',
  },
  summaryDetail: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: W * 0.03,
    color: '#444',
    marginTop: 2,
  },
  summaryEarnWrap: {
    alignItems: 'flex-end',
  },
  summaryEarnLabel: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: W * 0.028,
    color: '#444',
  },
  summaryEarnValue: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: W * 0.05,
    color: '#000',
  },
});
