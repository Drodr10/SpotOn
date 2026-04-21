/**
 * CreateListing — "Add a Parking Spot" screen.
 *
 * Form fields (from DB schema):
 *   - Address (text)
 *   - Price per hour (numeric)
 *   - Location (tap on map to drop a pin)
 *
 * Navigated to from the AddListingFAB on Homescreen.
 */

// ─── React & React Native ────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

// ─── Navigation ──────────────────────────────────────────────────────────────
import { useRouter } from 'expo-router';

// ─── Icons ───────────────────────────────────────────────────────────────────
import { Ionicons } from '@expo/vector-icons';

// ─── Map ─────────────────────────────────────────────────────────────────────
import MapView, { Marker, MapPressEvent } from 'react-native-maps';

// ─── Constants ───────────────────────────────────────────────────────────────
import { CustomFonts } from '@/src/constants/theme';

// ─── Auth & Supabase ─────────────────────────────────────────────────────────
import { supabase } from '../utils/supabase';

// ─── Responsive sizing ───────────────────────────────────────────────────────
const { width: screenWidth } = Dimensions.get('window');

const H_PAD        = screenWidth * 0.06;
const INPUT_HEIGHT = screenWidth * 0.13;
const INPUT_RADIUS = 999;
const FONT_TITLE   = screenWidth * 0.065;
const FONT_LABEL   = screenWidth * 0.038;
const FONT_INPUT   = screenWidth * 0.038;
const FONT_BUTTON  = screenWidth * 0.042;
const BACK_SIZE    = screenWidth * 0.06;
const MAP_HEIGHT   = screenWidth * 0.65;
const MAP_RADIUS   = screenWidth * 0.05;
const FONT_HINT    = screenWidth * 0.032;

// Default region centered on Gainesville, FL
const GAINESVILLE_REGION = {
  latitude: 29.6516,
  longitude: -82.3248,
  latitudeDelta: 0.04,
  longitudeDelta: 0.04,
};

// ─── Component ───────────────────────────────────────────────────────────────
export default function CreateListing() {
  const router = useRouter();

  const [address, setAddress]       = useState('');
  const [pricePerHour, setPricePerHour] = useState('');
  const [pin, setPin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ownerId, setOwnerId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        setOwnerId(data.session.user.id);
      }
    });
  }, []);

  /** Drop a pin wherever the user taps on the map */
  const handleMapPress = (e: MapPressEvent) => {
    setPin(e.nativeEvent.coordinate);
  };

  const handleSubmit = async () => {
    // ── Basic validation ──────────────────────────────────────────────────
    const trimmedAddress = address.trim();
    if (!trimmedAddress) {
      Alert.alert('Missing Field', 'Please enter an address.');
      return;
    }

    const price = parseFloat(pricePerHour);
    if (isNaN(price) || price <= 0) {
      Alert.alert('Invalid Price', 'Please enter a valid price per hour.');
      return;
    }

    if (!pin) {
      Alert.alert('Missing Location', 'Please tap on the map to drop a pin for your spot.');
      return;
    }

    if (!ownerId) {
      Alert.alert('Not Logged In', 'Please log in before creating a listing.');
      return;
    }

    // ── Submit to Supabase ────────────────────────────────────────────────
    setSubmitting(true);
    try {
      const { error } = await supabase.from('listings').insert({
        owner_id: ownerId,
        address: trimmedAddress,
        price_per_hour: price,
        latitude: pin.latitude,
        longitude: pin.longitude,
      });

      if (error) throw new Error(error.message);

      Alert.alert('Success', 'Your parking spot has been listed!', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Header ──────────────────────────────────────────────────── */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-back" size={BACK_SIZE} color="#000" />
            </TouchableOpacity>

            <Text style={styles.title}>Add a Spot</Text>
          </View>

          {/* ── Address ─────────────────────────────────────────────────── */}
          <Text style={styles.label}>Address</Text>
          <TextInput
            style={styles.input}
            value={address}
            onChangeText={setAddress}
            placeholder="e.g. 1234 University Ave"
            placeholderTextColor="rgba(0,0,0,0.35)"
            autoCorrect={false}
          />

          {/* ── Price ───────────────────────────────────────────────────── */}
          <Text style={styles.label}>Price per Hour ($)</Text>
          <TextInput
            style={styles.input}
            value={pricePerHour}
            onChangeText={setPricePerHour}
            placeholder="e.g. 3.50"
            placeholderTextColor="rgba(0,0,0,0.35)"
            keyboardType="decimal-pad"
          />

          {/* ── Location Picker (Map) ──────────────────────────────────── */}
          <Text style={styles.label}>Location</Text>
          <Text style={styles.hint}>Tap the map to drop a pin on your spot</Text>
          <View style={styles.mapContainer}>
            <MapView
              style={styles.map}
              initialRegion={GAINESVILLE_REGION}
              onPress={handleMapPress}
            >
              {pin && (
                <Marker
                  coordinate={pin}
                  draggable
                  onDragEnd={(e) => setPin(e.nativeEvent.coordinate)}
                  title="Your Spot"
                />
              )}
            </MapView>
          </View>
          {pin && (
            <Text style={styles.coordText}>
              {pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}
            </Text>
          )}

          {/* ── Submit Button ───────────────────────────────────────────── */}
          <TouchableOpacity
            style={[styles.submitButton, submitting && styles.submitDisabled]}
            onPress={handleSubmit}
            activeOpacity={0.8}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.submitText}>Create Listing</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  flex: { flex: 1 },

  safeArea: {
    flex: 1,
    backgroundColor: '#DCDBD8',
  },

  scrollContent: {
    paddingHorizontal: H_PAD,
    paddingBottom: screenWidth * 0.1,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: screenWidth * 0.03,
    paddingTop: screenWidth * 0.02,
    marginBottom: screenWidth * 0.08,
  },
  backButton: {
    backgroundColor: 'rgba(0,0,0,0.08)',
    borderRadius: 999,
    padding: screenWidth * 0.02,
  },
  title: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: FONT_TITLE,
    color: '#000000',
  },

  // ── Labels & Inputs ───────────────────────────────────────────────────────
  label: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: FONT_LABEL,
    color: '#000000',
    marginBottom: screenWidth * 0.02,
    marginTop: screenWidth * 0.04,
  },
  input: {
    width: '100%',
    height: INPUT_HEIGHT,
    backgroundColor: '#FFFFFF',
    borderRadius: INPUT_RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(0,0,0,0.15)',
    paddingHorizontal: screenWidth * 0.05,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: FONT_INPUT,
    color: '#000000',
  },

  // ── Map picker ────────────────────────────────────────────────────────────
  hint: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: FONT_HINT,
    color: 'rgba(0,0,0,0.5)',
    marginBottom: screenWidth * 0.025,
  },
  mapContainer: {
    height: MAP_HEIGHT,
    borderRadius: MAP_RADIUS,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: 'rgba(0,0,0,0.15)',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  coordText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: FONT_HINT,
    color: 'rgba(0,0,0,0.45)',
    marginTop: screenWidth * 0.015,
    textAlign: 'center',
  },

  // ── Submit ────────────────────────────────────────────────────────────────
  submitButton: {
    marginTop: screenWidth * 0.08,
    height: INPUT_HEIGHT,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: INPUT_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitDisabled: {
    opacity: 0.6,
  },
  submitText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: FONT_BUTTON,
    color: '#FFFFFF',
  },
});
