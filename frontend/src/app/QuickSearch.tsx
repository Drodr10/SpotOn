/**
 * QuickSearch.tsx — Map-first search screen.
 * Shows full-screen map with user location, floating search bar, and profile pill.
 * This is the main landing screen after login.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Keyboard,
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import MapView from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { CustomFonts } from '@/src/constants/theme';
import { triggerLightHaptic, withLightHaptic } from '@/src/utils/haptics';
import { supabase } from '../utils/supabase';
import spotonLogoAsset from '@/assets/images/spotonlogo.png';
import profileIconAsset from '@/assets/images/temprofileicon.png';

const { width: screenWidth } = Dimensions.get('window');

const AVATAR_SIZE = screenWidth * 0.075;
const FONT_NAME = screenWidth * 0.035;
const FONT_SEARCH = screenWidth * 0.033;
const SEARCH_ICON = screenWidth * 0.04;
const H_PAD = screenWidth * 0.04;

const GAINESVILLE_REGION = {
  latitude: 29.6516,
  longitude: -82.3248,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};

type Suggestion = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
};

const SUGGESTION_LIMIT = 3;
const SUGGESTION_DEBOUNCE_MS = 250;
const SUGGESTION_STAGGER_MS = 130;
const SUGGESTION_FADE_MS = 340;
const SUGGESTION_TRANSLATE = 8;
const CONTAINER_ANIM_MS = 320;

// Android needs this opt-in before LayoutAnimation will run; iOS works without.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SUGGESTION_LAYOUT_ANIM = {
  duration: CONTAINER_ANIM_MS,
  create: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
  update: {
    type: LayoutAnimation.Types.easeInEaseOut,
    springDamping: 0.85,
  },
  delete: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
};

export default function QuickSearch() {
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);
  const [searchText, setSearchText] = useState('');
  const [firstName, setFirstName] = useState('');
  const [region, setRegion] = useState(GAINESVILLE_REGION);
  const [pressedCoord, setPressedCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const keyboardOffset = useRef(new Animated.Value(0)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  // Per-card opacity + translateY for staggered fade-in. Recreated on each
  // suggestion batch so cards always animate from scratch when they change.
  const suggestionOpacities = useRef<Animated.Value[]>([]).current;
  const suggestionTranslates = useRef<Animated.Value[]>([]).current;

  // Animate search bar above keyboard
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => {
      Animated.timing(keyboardOffset, {
        toValue: e.endCoordinates.height,
        duration: Platform.OS === 'ios' ? e.duration : 250,
        useNativeDriver: true,
      }).start();
    });

    const hideSub = Keyboard.addListener(hideEvent, (e) => {
      Animated.timing(keyboardOffset, {
        toValue: 0,
        duration: Platform.OS === 'ios' ? e.duration : 250,
        useNativeDriver: true,
      }).start();
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Load user profile
  useEffect(() => {
    supabase.auth.getClaims().then(async ({ data }) => {
      if (data) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', data.claims.sub)
          .single();
        if (profile?.full_name) {
          setFirstName(profile.full_name.split(' ')[0]);
        }
      }
    });
  }, []);

  // Get current location
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setRegion({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        });
      }
    })();
  }, []);

  // ── Suggestion fetch (debounced) ─────────────────────────────────────────
  // Uses OpenStreetMap Nominatim — no API key required. If the query is empty
  // or the bar isn't focused, suggestions collapse so the search card returns
  // to its resting height.
  useEffect(() => {
    if (!isFocused) {
      if (suggestions.length > 0) LayoutAnimation.configureNext(SUGGESTION_LAYOUT_ANIM);
      setSuggestions([]);
      return;
    }
    const trimmed = searchText.trim();
    if (trimmed.length < 2) {
      if (suggestions.length > 0) LayoutAnimation.configureNext(SUGGESTION_LAYOUT_ANIM);
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q: trimmed,
          format: 'json',
          addressdetails: '1',
          limit: String(SUGGESTION_LIMIT),
        });
        const resp = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
          headers: { 'Accept': 'application/json' },
        });
        if (!resp.ok) return;
        const json = (await resp.json()) as any[];
        if (cancelled) return;
        const next: Suggestion[] = json.slice(0, SUGGESTION_LIMIT).map((r, i) => ({
          id: String(r.place_id ?? `${r.lat},${r.lon},${i}`),
          label: r.display_name as string,
          latitude: parseFloat(r.lat),
          longitude: parseFloat(r.lon),
        }));
        LayoutAnimation.configureNext(SUGGESTION_LAYOUT_ANIM);
        setSuggestions(next);
      } catch (err) {
        if (!cancelled) console.warn('[QuickSearch] suggestion fetch failed', err);
      }
    }, SUGGESTION_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [searchText, isFocused]);

  // ── Stagger fade-in whenever the suggestion list changes ────────────────
  // Each card fades + slides up in sequence. The container itself reflows
  // smoothly via LayoutAnimation (see useEffect above).
  useEffect(() => {
    suggestionOpacities.length = 0;
    suggestionTranslates.length = 0;
    suggestions.forEach(() => {
      suggestionOpacities.push(new Animated.Value(0));
      suggestionTranslates.push(new Animated.Value(SUGGESTION_TRANSLATE));
    });
    if (suggestions.length === 0) return;

    const cardAnims = suggestions.map((_, i) =>
      Animated.parallel([
        Animated.timing(suggestionOpacities[i], {
          toValue: 1,
          duration: SUGGESTION_FADE_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(suggestionTranslates[i], {
          toValue: 0,
          duration: SUGGESTION_FADE_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    );

    Animated.stagger(SUGGESTION_STAGGER_MS, cardAnims).start();
  }, [suggestions]);

  const handleSuggestionPress = (s: Suggestion) => {
    triggerLightHaptic();
    inputRef.current?.blur();
    Keyboard.dismiss();
    router.push({
      pathname: '/search',
      params: { query: s.label, lat: String(s.latitude), lng: String(s.longitude) },
    });
    setSearchText('');
    setSuggestions([]);
    setPressedCoord(null);
  };

  const handleSubmit = () => {
    const trimmed = searchText.trim();
    if (!trimmed) return;
    triggerLightHaptic();
    const coord = pressedCoord ?? region;
    router.push({
      pathname: '/search',
      params: { query: trimmed, lat: String(coord.latitude), lng: String(coord.longitude) },
    });
    setSearchText('');
    setPressedCoord(null);
  };

  // Tapping or panning the map dismisses the keyboard and collapses the
  // suggestion list (suggestions only show while the input is focused).
  const handleMapPress = () => {
    Keyboard.dismiss();
    inputRef.current?.blur();
  };

  const handleMapLongPress = async (e: any) => {
    triggerLightHaptic();
    const { latitude, longitude } = e.nativeEvent.coordinate;

    // Flash effect
    flashOpacity.setValue(0.3);
    Animated.timing(flashOpacity, {
      toValue: 0,
      duration: 500,
      useNativeDriver: true,
    }).start();

    // Store the pressed coordinate for use in handleSubmit
    setPressedCoord({ latitude, longitude });

    // Reverse geocode
    try {
      const [result] = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (result) {
        const parts = [result.name, result.street, result.city].filter(Boolean);
        const address = parts.join(', ').replace(/,\s*,/g, ',').trim();
        if (address) {
          setSearchText(address);
          setTimeout(() => inputRef.current?.focus(), 100);
        }
      }
    } catch (err) {
      console.warn('Reverse geocode failed:', err);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      {/* Full-screen map — zIndex: base */}
      <MapView
        style={StyleSheet.absoluteFillObject}
        region={region}
        showsUserLocation={true}
        showsMyLocationButton={true}
        onPress={handleMapPress}
        onPanDrag={handleMapPress}
        onLongPress={handleMapLongPress}
      />

      {/* Brightness flash on long-press — zIndex: 5 */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: '#FFFFFF', opacity: flashOpacity, zIndex: 5 },
        ]}
      />

      {/* Header overlay — zIndex: 10, profile pill only */}
      <SafeAreaView style={styles.headerSafe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.profilePill}
            onPress={withLightHaptic(() => router.push('/Homescreen'))}
          >
            <Image source={profileIconAsset} style={styles.avatar} />
            <Text style={styles.profileName}>{firstName || 'User'}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Floating search bar — zIndex: 10, animates above keyboard */}
      <Animated.View
        style={[
          styles.searchWrapper,
          { transform: [{ translateY: Animated.multiply(keyboardOffset, -1) }] },
        ]}
      >
        <View style={styles.searchOuter}>
          {/* Row 1: Logo + brand name */}
          <View style={styles.pillBrandRow}>
            <Image source={spotonLogoAsset} style={styles.pillLogo} resizeMode="contain" />
            <Text style={styles.pillBrandText}>SpotOn</Text>
          </View>

          {/* Row 2: Search input */}
          <TouchableOpacity
            activeOpacity={1}
            onPress={withLightHaptic(() => inputRef.current?.focus())}
          >
            <View style={styles.searchInner}>
              <Ionicons name="search" size={SEARCH_ICON} color="rgba(0,0,0,0.6)" />
              <TextInput
                ref={inputRef}
                style={styles.searchInput}
                value={searchText}
                onChangeText={setSearchText}
                onSubmitEditing={handleSubmit}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder="Where Are We Going Today?"
                placeholderTextColor="rgba(0,0,0,0.5)"
                returnKeyType="search"
              />
            </View>
          </TouchableOpacity>

          {/* Suggestion cards — only present while focused with results. The
              container reflows to grow as cards mount. */}
          {isFocused && suggestions.length > 0 && (
            <View style={styles.suggestionsList}>
              {suggestions.map((s, i) => (
                <Animated.View
                  key={s.id}
                  style={{
                    opacity: suggestionOpacities[i] ?? 0,
                    transform: [
                      { translateY: suggestionTranslates[i] ?? new Animated.Value(0) },
                    ],
                  }}
                >
                  <TouchableOpacity
                    activeOpacity={0.85}
                    style={styles.suggestionCard}
                    onPress={() => handleSuggestionPress(s)}
                  >
                    <Ionicons
                      name="location-outline"
                      size={SEARCH_ICON}
                      color="rgba(0,0,0,0.7)"
                      style={styles.suggestionIcon}
                    />
                    <Text
                      style={styles.suggestionText}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {s.label}
                    </Text>
                  </TouchableOpacity>
                </Animated.View>
              ))}
            </View>
          )}

          <Text style={styles.helperText}>press and hold to autoselect address</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // Header
  headerSafe: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: H_PAD,
    paddingVertical: screenWidth * 0.02,
  },
  // Profile pill
  profilePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 200,
    paddingHorizontal: screenWidth * 0.025,
    paddingVertical: screenWidth * 0.015,
    gap: screenWidth * 0.015,
  },
  avatar: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: 999 },
  profileName: { fontFamily: CustomFonts.SwitzerLight, fontSize: FONT_NAME, color: '#FFF' },
  // Search bar
  searchWrapper: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
    zIndex: 10,
  },
  searchOuter: {
    backgroundColor: 'rgba(220,219,216,0.75)',
    borderRadius: 40,
    paddingHorizontal: screenWidth * 0.04,
    paddingVertical: screenWidth * 0.035,
    width: '100%',
    gap: screenWidth * 0.02,
  },
  pillBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: screenWidth * 0.01,
    paddingLeft: screenWidth * 0.01,
  },
  pillLogo: {
    width: screenWidth * 0.08,
    height: screenWidth * 0.08,
  },
  pillBrandText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: screenWidth * 0.04,
    color: '#000',
  },
  searchInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(3,3,3,0.14)',
    borderWidth: 1,
    borderColor: '#000',
    borderRadius: 200,
    paddingHorizontal: screenWidth * 0.035,
    paddingVertical: screenWidth * 0.035,
    gap: screenWidth * 0.02,
  },
  searchInput: {
    flex: 1,
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: FONT_SEARCH,
    color: '#000',
    padding: 0,
  },
  helperText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.03,
    color: 'rgba(0,0,0,0.65)',
    marginTop: screenWidth * 0.005,
    textAlign: 'center',
  },

  // Suggestion list inside the search card
  suggestionsList: {
    gap: screenWidth * 0.02,
    marginTop: screenWidth * 0.005,
  },
  suggestionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#C0BFBD',
    borderRadius: 200,
    paddingHorizontal: screenWidth * 0.035,
    paddingVertical: screenWidth * 0.03,
    gap: screenWidth * 0.02,
  },
  suggestionIcon: {
    flexShrink: 0,
  },
  suggestionText: {
    flex: 1,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: FONT_SEARCH,
    color: '#000',
  },
});
