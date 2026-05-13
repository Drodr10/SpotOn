/**
 * CreateListing2 — 5-scene listing creation flow.
 *
 * Scene 1: Welcome / Intro
 * Scene 2: Pick Location (map)
 * Scene 3: Camera pop-up (overlay on scene 2)
 * Scene 4: Price Picker — 3 sub-states (pricingStep):
 *          'select' + periodType 0 → Hourly picker
 *          'select' + periodType 1 → Weekly picker
 *          'breakdown'             → Weekly fee/discount breakdown
 * Scene 5: Calendar pop-up (overlay on scene 4)
 */

// ─── React & React Native ─────────────────────────────────────────────────────
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Alert,
  Animated,
  PanResponder,
  Platform,
  Modal,
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

// ─── Image Picker ─────────────────────────────────────────────────────────────
import * as ImagePicker from 'expo-image-picker';

// ─── Constants ────────────────────────────────────────────────────────────────
import { CustomFonts } from '@/src/constants/theme';

// ─── Supabase ─────────────────────────────────────────────────────────────────
import { supabase } from '../utils/supabase';

// ─── Components ───────────────────────────────────────────────────────────────
import DateRangePicker from '@/src/components/DateRangePicker';
import FilterToggle from '@/src/components/FilterToggle';
import { triggerLightHaptic, withLightHaptic } from '@/src/utils/haptics';

// ─── Assets ───────────────────────────────────────────────────────────────────
import carparkingImg from '@/assets/images/carparking.png';
import accessibilityImg from '@/assets/images/accessibility.png';
import addLocationImg from '@/assets/images/add_location.png';
import cameraanalogImg from '@/assets/images/cameraanalog.png';
import calendarImg from '@/assets/images/calendar.png';
import spotonLogoAsset from '@/assets/images/spotonlogo.png';
import addlistingimageAsset from '@/assets/images/addlistingimage.png';

// ─── Sizing ───────────────────────────────────────────────────────────────────
const { width: W, height: H } = Dimensions.get('window');
const H_PAD = W * 0.06;
const PRICE_IMAGE_SIZE = Math.min(W * 0.82, H * 0.34);

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

  // ── Scene state ────────────────────────────────────────────────────────────
  const [scene, setScene] = useState(1);

  // ── Collected data ─────────────────────────────────────────────────────────
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [address, setAddress] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [pricePerHour, setPricePerHour] = useState(3.0);
  const [pricePerWeek, setPricePerWeek] = useState(50);
  const [periodType, setPeriodType] = useState<0 | 1>(0); // 0 = Hourly, 1 = Weekly
  const [pricingStep, setPricingStep] = useState<'select' | 'breakdown'>('select');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);

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
  const periodTypeRef = useRef<0 | 1>(0);
  const lastY = useRef<number | null>(null);

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
      },
      onPanResponderRelease: () => {
        lastY.current = null;
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
      setShowCalendarPopup(true);
      setScene(5);
      return;
    }
    // Weekly path
    if (pricingStep === 'select') {
      if (pricePerWeek <= 0) {
        Alert.alert('Invalid price', 'Please set a price greater than $0.00.');
        return;
      }
      setPricingStep('breakdown');
      return;
    }
    // Weekly breakdown → calendar
    setShowCalendarPopup(true);
    setScene(5);
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
    // Wait for the picker's slide-out (≈300ms) before swapping scenes so the
    // dimmed price background doesn't pop back to full opacity prematurely.
    setTimeout(() => setScene(4), 300);
  };

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
            Let's add a photo of your spot. Press the camera to take the photo.
          </Text>
        </View>
        <TouchableOpacity onPress={withLightHaptic(handleTakePhoto)} activeOpacity={0.85} style={styles.popupImageBtn}>
          <Image source={cameraanalogImg} style={styles.popupLargeImg} resizeMode="contain" />
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Scene 4 — Price Picker (3 sub-states: Hourly select, Weekly select, Weekly breakdown)
  // ─────────────────────────────────────────────────────────────────────────────
  const renderScene4 = () => {
    if (pricingStep === 'breakdown') return renderScene4Breakdown();
    return renderScene4Select();
  };

  // States A (Hourly) + B (Weekly Page 1) — same layout, FilterToggle controls which
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
            <Image source={addlistingimageAsset} style={styles.productImage} resizeMode="contain" />
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
        {renderBottomButtons(() => setScene(2), goToScene5)}
      </SafeAreaView>
    );
  };

  // State C — Weekly Breakdown (pricing-details container)
  const renderScene4Breakdown = () => {
    const fmt = (n: number) => `$${n.toFixed(2)}`;

    const weeklyGross = pricePerWeek;
    const weeklyFee = weeklyGross * 0.15;
    const weeklyNet = weeklyGross - weeklyFee;

    const monthlyBase = pricePerWeek * 4;
    const monthlyDiscount = monthlyBase * 0.20;
    const monthlyAfterDiscount = monthlyBase - monthlyDiscount;
    const monthlyFee = monthlyAfterDiscount * 0.15;
    const monthlyNet = monthlyAfterDiscount - monthlyFee;

    return (
      <SafeAreaView style={styles.safeArea}>
        {renderSharedHeader("Finally let's set your price and dates.")}
        <View style={styles.breakdownWrapper}>
          <View style={styles.breakdownContainer}>
            <Image source={spotonLogoAsset} style={styles.breakdownLogo} resizeMode="contain" />

            {/* Weekly */}
            <Text style={styles.breakdownSectionTitle}>Weekly</Text>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Gross</Text>
              <Text style={styles.breakdownValue}>{fmt(weeklyGross)}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>SpotOn fee (15%)</Text>
              <Text style={styles.breakdownValue}>- {fmt(weeklyFee)}</Text>
            </View>
            <View style={styles.breakdownDivider} />
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownTotalLabel}>You earn</Text>
              <Text style={styles.breakdownTotalValue}>{fmt(weeklyNet)}</Text>
            </View>

            <View style={{ height: W * 0.04 }} />

            {/* Monthly */}
            <Text style={styles.breakdownSectionTitle}>Monthly (4 weeks)</Text>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Gross</Text>
              <Text style={styles.breakdownValue}>{fmt(monthlyBase)}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Monthly discount (20%)</Text>
              <Text style={styles.breakdownValue}>- {fmt(monthlyDiscount)}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Subtotal</Text>
              <Text style={styles.breakdownValue}>{fmt(monthlyAfterDiscount)}</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>SpotOn fee (15%)</Text>
              <Text style={styles.breakdownValue}>- {fmt(monthlyFee)}</Text>
            </View>
            <View style={styles.breakdownDivider} />
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownTotalLabel}>You earn</Text>
              <Text style={styles.breakdownTotalValue}>{fmt(monthlyNet)}</Text>
            </View>
          </View>
        </View>
        {renderBottomButtons(() => setPricingStep('select'), goToScene5)}
      </SafeAreaView>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Scene 5 — Calendar Pop-up (overlay on scene 4) — uses shared DateRangePicker
  // ─────────────────────────────────────────────────────────────────────────────
  const renderScene5 = () => (
    <SafeAreaView style={styles.safeArea}>
      {/* Dimmed underlying scene 4 view (hourly select OR weekly breakdown card) */}
      <View style={styles.scene5Dim} pointerEvents="none">
        {pricingStep === 'breakdown' ? renderScene4Breakdown() : renderScene4Select()}
      </View>

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
    height: 50,
    borderRadius: 25,
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
    right: W * 0.04,
    width: W * 0.12,
    height: W * 0.12,
    opacity: 0.9,
    tintColor: '#fff',
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
});
