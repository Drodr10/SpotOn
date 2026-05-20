import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';

import { supabase } from '../../utils/supabase';
import { CustomFonts } from '../../constants/theme';
import { getPrimaryRate } from '../../utils/listingPrice';

interface NearbyListing {
  id: string;
  address: string;
  latitude: number;
  longitude: number;
  price_per_hour: number | null;
  hourly_rate: number | null;
  daily_rate: number | null;
  weekly_rate: number | null;
  monthly_rate: number | null;
  photo_url: string;
  distance: number;
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const DEFAULT_LAT = 29.6516;
const DEFAULT_LNG = -82.3248;

export default function DynamicViewer() {
  const { width: W, height: H } = useWindowDimensions();
  const router = useRouter();

  // ═══════════════════════════════════════════════════════════════════════════
  // ▼▼▼ LAYOUT CONTROLS — adjust these to tune the visual ▼▼▼
  // ═══════════════════════════════════════════════════════════════════════════

  const CARD_HEIGHT       = H * 0.50;   // active (centered) card height
  const CARD_HEIGHT_SMALL = H * 0.40;   // adjacent card height
  const CARD_WIDTH        = W * 0.70;   // card width
  const SIDE_INSET        = W * 0.15;   // space each side (shows edges of adjacent cards)
  const CARD_GAP          = W * 0.03;   // gap between cards
  const RADIUS            = W * 0.09;   // ← #1 border radius — increase for more curve
  const PILL_H_PAD        = W * 0.03;   // pill horizontal padding
  const PILL_V_PAD        = W * 0.022;  // ← #3 pill vertical padding — increase for taller pills
  const PILL_MARGIN       = W * 0.025;  // distance from pill to card edge
  const ARROW_SIZE        = W * 0.078;
  const FONT_PRICE        = W * 0.05;
  const FONT_UNIT         = W * 0.032;
  const FONT_DIST         = W * 0.031;
  const FONT_ADDR         = W * 0.034;
  const WALK_ICON         = W * 0.033;

  // ═══════════════════════════════════════════════════════════════════════════

  const SNAP_INTERVAL = CARD_WIDTH + CARD_GAP;

  const [listings, setListings] = useState<NearbyListing[]>([]);
  const [loading, setLoading]   = useState(true);
  const [userLat, setUserLat]   = useState(DEFAULT_LAT);
  const [userLng, setUserLng]   = useState(DEFAULT_LNG);

  // Tracks raw horizontal scroll offset for height interpolation
  const scrollX        = useRef(new Animated.Value(0)).current;
  const activeIndexRef = useRef(0);

  // ── Location ──────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setUserLat(loc.coords.latitude);
          setUserLng(loc.coords.longitude);
          return;
        }
      } catch {
        // fall through to defaults
      }
      fetchListings(DEFAULT_LAT, DEFAULT_LNG);
    })();
  }, []);

  // ── Fetch listings ────────────────────────────────────────────────────────
  const fetchListings = async (lat: number, lng: number) => {
    setLoading(true);
    const latDelta = 0.09;
    const lngDelta = 0.09 / Math.cos((lat * Math.PI) / 180);

    const { data, error } = await supabase
      .from('listings')
      .select(
        'id, address, latitude, longitude, price_per_hour, hourly_rate, daily_rate, weekly_rate, monthly_rate, photo_url',
      )
      .eq('is_active', true)
      .not('photo_url', 'is', null)
      .gte('latitude', lat - latDelta)
      .lte('latitude', lat + latDelta)
      .gte('longitude', lng - lngDelta)
      .lte('longitude', lng + lngDelta);

    if (!error && data) {
      const sorted: NearbyListing[] = data
        .filter((l: any) => l.photo_url && l.photo_url.trim() !== '')
        .map((l: any) => ({
          ...l,
          distance: haversineMiles(lat, lng, l.latitude, l.longitude),
        }))
        .filter((l: NearbyListing) => l.distance <= 5)
        .sort((a: NearbyListing, b: NearbyListing) => a.distance - b.distance);
      setListings(sorted);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchListings(userLat, userLng);
  }, [userLat, userLng]);

  // ── Arrow tap — bypasses search list, opens listing detail directly ───────
  const handleArrow = (listing: NearbyListing) => {
    router.push({
      pathname: '/search',
      params: {
        query: listing.address,
        lat: String(userLat),
        lng: String(userLng),
        openListingId: listing.id,
      },
    } as any);
  };

  // ── Haptics on card change ────────────────────────────────────────────────
  const handleMomentumScrollEnd = (e: any) => {
    const offset   = e.nativeEvent.contentOffset.x;
    const newIndex = Math.round(offset / SNAP_INTERVAL);
    if (newIndex !== activeIndexRef.current) {
      activeIndexRef.current = newIndex;
      Haptics.selectionAsync().catch(() => {});
    }
  };

  // ── Loading / empty ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={{ height: CARD_HEIGHT, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#000" />
      </View>
    );
  }

  if (listings.length === 0) return null;

  // ── Card (height animates with scroll position) ───────────────────────────
  const renderCard = ({ item, index }: { item: NearbyListing; index: number }) => {
    const rate     = getPrimaryRate(item);
    const priceStr = rate
      ? `$${Number.isInteger(rate.value) ? rate.value : rate.value.toFixed(2)}`
      : '—';
    const unitStr  = rate ? `/${rate.unit.charAt(0)}` : '';

    // Height interpolates: adjacent cards are CARD_HEIGHT_SMALL, centered card is CARD_HEIGHT
    const animHeight = scrollX.interpolate({
      inputRange: [
        (index - 1) * SNAP_INTERVAL,
        index * SNAP_INTERVAL,
        (index + 1) * SNAP_INTERVAL,
      ],
      outputRange: [CARD_HEIGHT_SMALL, CARD_HEIGHT, CARD_HEIGHT_SMALL],
      extrapolate: 'clamp',
    });

    return (
      <Animated.View
        style={{
          width: CARD_WIDTH,
          height: animHeight,
          borderRadius: RADIUS,
          overflow: 'hidden',
          backgroundColor: '#222',
          alignSelf: 'center',
        }}
      >
        {/* Background image — fills the entire card, no overlays */}
        <Image
          source={{ uri: item.photo_url }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
        />

        {/* Top pill — price + walk distance */}
        <View
          style={[
            styles.pill,
            {
              position: 'absolute',
              top: PILL_MARGIN,
              left: PILL_MARGIN,
              right: PILL_MARGIN,
              paddingHorizontal: PILL_H_PAD,
              paddingVertical: PILL_V_PAD,
            },
          ]}
        >
          <Text style={[styles.priceText, { fontSize: FONT_PRICE }]}>
            {priceStr}
            <Text style={[styles.unitText, { fontSize: FONT_UNIT }]}>{unitStr}</Text>
          </Text>
          <View style={styles.distRow}>
            <Ionicons name="walk" size={WALK_ICON} color="#fff" />
            <Text style={[styles.distText, { fontSize: FONT_DIST }]}>
              {item.distance.toFixed(1)}mi
            </Text>
          </View>
        </View>

        {/* Bottom pill — address + yellow navigation arrow */}
        <View
          style={[
            styles.pill,
            {
              position: 'absolute',
              bottom: PILL_MARGIN,
              left: PILL_MARGIN,
              right: PILL_MARGIN,
              paddingHorizontal: PILL_H_PAD,
              paddingVertical: PILL_V_PAD,
            },
          ]}
        >
          <Text
            style={[styles.addrText, { fontSize: FONT_ADDR }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {item.address}
          </Text>
          <TouchableOpacity
            onPress={() => handleArrow(item)}
            activeOpacity={0.8}
            style={[
              styles.arrowBtn,
              {
                width: ARROW_SIZE,
                height: ARROW_SIZE,
                borderRadius: ARROW_SIZE / 2,
                marginLeft: PILL_H_PAD,
              },
            ]}
          >
            <Ionicons name="navigate" size={ARROW_SIZE * 0.46} color="#000" />
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  };

  return (
    <FlatList
      horizontal
      data={listings}
      keyExtractor={(item) => item.id}
      renderItem={renderCard}
      showsHorizontalScrollIndicator={false}
      snapToInterval={SNAP_INTERVAL}
      snapToAlignment="start"
      decelerationRate="fast"
      // Feed raw scroll offset into scrollX so each card can interpolate its height
      onScroll={Animated.event(
        [{ nativeEvent: { contentOffset: { x: scrollX } } }],
        { useNativeDriver: false },
      )}
      scrollEventThrottle={16}
      onMomentumScrollEnd={handleMomentumScrollEnd}
      contentContainerStyle={{
        paddingHorizontal: SIDE_INSET,
        alignItems: 'center', // vertically center shorter adjacent cards
      }}
      ItemSeparatorComponent={() => <View style={{ width: CARD_GAP }} />}
      style={{ height: CARD_HEIGHT }}
    />
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 999,
  },
  priceText: {
    fontFamily: CustomFonts.BevellierMedium,
    color: '#fff',
  },
  unitText: {
    fontFamily: CustomFonts.SwitzerLight,
    color: 'rgba(255,255,255,0.85)',
  },
  distRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  distText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    color: '#fff',
  },
  addrText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    color: '#fff',
    flex: 1,
  },
  arrowBtn: {
    backgroundColor: '#FFFF1E',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
