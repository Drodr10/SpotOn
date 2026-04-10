/**
 * search.tsx — Figma: "Search / Map Screen"
 *
 * Full-screen map view with a semi-transparent "Nearby Locations" bottom panel.
 * Queries Supabase for active listings within a 5-mile radius of the user's location.
 */

// ─── React & React Native ────────────────────────────────────────────────────
import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

// ─── Expo Router ─────────────────────────────────────────────────────────────
import { useLocalSearchParams, useRouter } from 'expo-router';

// ─── Map ─────────────────────────────────────────────────────────────────────
import MapView, { Marker } from 'react-native-maps';

// ─── Icons ───────────────────────────────────────────────────────────────────
import { Ionicons } from '@expo/vector-icons';

// ─── Supabase ─────────────────────────────────────────────────────────────────
import { supabase } from '../utils/supabase';

// ─── Constants ───────────────────────────────────────────────────────────────
import { CustomFonts, Palette } from '@/src/constants/theme';

// ─── Assets ──────────────────────────────────────────────────────────────────
import spotonLogoAsset from '@/assets/images/spotonlogo.png';
import cabinIconAsset  from '@/assets/images/cabin.png';

// ─── Responsive sizing ───────────────────────────────────────────────────────
const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const H_PAD        = screenWidth * 0.045;
const V_PAD        = screenWidth * 0.04;
const PANEL_HEIGHT = screenHeight * 0.56;

const LOGO_SIZE    = screenWidth * 0.09;
const BACK_SIZE    = screenWidth * 0.06;
const ICON_SIZE    = screenWidth * 0.045;

const FONT_TITLE   = screenWidth * 0.042;
const FONT_LABEL   = screenWidth * 0.032;
const FONT_HEADER  = screenWidth * 0.05;
const FONT_QUERY   = screenWidth * 0.031;
const FONT_DIST    = screenWidth * 0.028;

// ─── Types ───────────────────────────────────────────────────────────────────
interface Listing {
  id: string;
  owner_id: string;
  address: string;
  latitude: number;
  longitude: number;
  price_per_hour: number;
  is_active: boolean;
  photo_url: string | null;
  created_at: string;
  distance: number; // computed client-side (miles)
}

// ─── Haversine helper ─────────────────────────────────────────────────────────
function getDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── NearbyLocationCard ───────────────────────────────────────────────────────
function NearbyLocationCard({
  item,
  selected,
  onPress,
}: {
  item: Listing;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
      <View style={[cardStyles.card, selected && cardStyles.cardSelected]}>
        <Text style={cardStyles.title}>{item.address}</Text>

        <View style={cardStyles.detailsRow}>
          <View style={cardStyles.detailItem}>
            <Image source={cabinIconAsset} style={cardStyles.detailIcon} resizeMode="contain" />
            <Text style={cardStyles.detailText}>Parking Spot</Text>
          </View>
        </View>

        <Text style={cardStyles.price}>${Number(item.price_per_hour).toFixed(2)} / hr</Text>
        <Text style={cardStyles.distance}>{item.distance.toFixed(1)} mi away</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Main Screen Component ────────────────────────────────────────────────────
export default function SearchScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);

  const { query, lat: latParam, lng: lngParam } = useLocalSearchParams<{
    query: string;
    lat: string;
    lng: string;
  }>();

  const userLat = latParam ? parseFloat(latParam) : 29.6516;
  const userLng = lngParam ? parseFloat(lngParam) : -82.3248;

  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const initialRegion = {
    latitude: userLat,
    longitude: userLng,
    latitudeDelta: 0.04,
    longitudeDelta: 0.04,
  };

  // ─── Fetch listings from Supabase ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      const latDelta = 0.0724;
      const lngDelta = 0.0724 / Math.cos(userLat * Math.PI / 180);

      const { data, error } = await supabase
        .from('listings')
        .select('*')
        .eq('is_active', true)
        .gte('latitude', userLat - latDelta)
        .lte('latitude', userLat + latDelta)
        .gte('longitude', userLng - lngDelta)
        .lte('longitude', userLng + lngDelta);

      if (error) {
        console.error('Supabase listings error:', error);
        setLoading(false);
        return;
      }

      // Client-side exact 5-mile Haversine filter + sort by distance
      const withDistance: Listing[] = (data ?? [])
        .map((l: any) => ({
          ...l,
          distance: getDistanceMiles(userLat, userLng, l.latitude, l.longitude),
        }))
        .filter((l: Listing) => l.distance <= 5)
        .sort((a: Listing, b: Listing) => a.distance - b.distance);

      setListings(withDistance);
      setLoading(false);
    })();
  }, []);

  const handleCardPress = (listing: Listing) => {
    setSelectedId(listing.id);
    mapRef.current?.animateToRegion(
      {
        latitude: listing.latitude,
        longitude: listing.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      },
      500,
    );
  };

  return (
    <View style={styles.screenContainer}>
      <StatusBar style="dark" />

      {/* ── Map ────────────────────────────────────────────────────────────── */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation={true}
        mapPadding={{ top: 0, right: 0, bottom: PANEL_HEIGHT, left: 0 }}
      >
        {/* Blue pin at the searched/pressed location */}
        <Marker
          coordinate={{ latitude: userLat, longitude: userLng }}
          title={query ?? 'Searched Location'}
          pinColor="#007AFF"
        />

        {listings.map((listing) => (
          <Marker
            key={listing.id}
            coordinate={{ latitude: listing.latitude, longitude: listing.longitude }}
            title={listing.address}
            pinColor={selectedId === listing.id ? '#007AFF' : '#E02020'}
            onPress={() => handleCardPress(listing)}
          />
        ))}
      </MapView>

      {/* ── Back Button ────────────────────────────────────────────────────── */}
      <SafeAreaView style={styles.backButtonWrapper} edges={['top']}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={BACK_SIZE} color="#000" />
        </TouchableOpacity>
      </SafeAreaView>

      {/* ── Nearby Locations Panel ─────────────────────────────────────────── */}
      <View style={styles.panel}>

        <View style={styles.panelHeader}>
          <Image source={spotonLogoAsset} style={styles.panelLogo} resizeMode="contain" />
          <Text style={styles.panelHeaderText}>SpotOn</Text>
        </View>

        <Text style={styles.locationQuery} numberOfLines={1}>
          Location: {query ?? '—'}
        </Text>

        {loading ? (
          <ActivityIndicator
            size="large"
            color="#000"
            style={styles.loader}
          />
        ) : listings.length === 0 ? (
          <Text style={styles.emptyText}>No spots found within 5 miles</Text>
        ) : (
          <FlatList<Listing>
            data={listings}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <NearbyLocationCard
                item={item}
                selected={selectedId === item.id}
                onPress={() => handleCardPress(item)}
              />
            )}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.cardSeparator} />}
          />
        )}

      </View>
    </View>
  );
}

// ─── Screen Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: Palette.chalkgrey,
  },
  map: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: screenWidth,
    height: screenHeight,
  },
  backButtonWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  backButton: {
    margin: screenWidth * 0.04,
    backgroundColor: 'rgba(220,219,216,0.85)',
    borderRadius: 999,
    padding: screenWidth * 0.02,
  },
  panel: {
    position: 'absolute',
    bottom: 0,
    left: H_PAD * 0.25,
    right: H_PAD * 0.25,
    height: PANEL_HEIGHT,
    backgroundColor: 'rgba(220, 219, 216, 0.75)',
    borderTopLeftRadius: screenWidth * 0.1,
    borderTopRightRadius: screenWidth * 0.1,
    overflow: 'hidden',
    paddingHorizontal: H_PAD,
    paddingTop: V_PAD,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: screenWidth * 0.005,
    marginBottom: screenWidth * 0.015,
  },
  panelLogo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
  panelHeaderText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: FONT_HEADER,
    color: '#000000',
  },
  locationQuery: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: FONT_QUERY,
    color: '#000000',
    marginBottom: screenWidth * 0.05,
  },
  listContent: {
    paddingBottom: V_PAD,
  },
  cardSeparator: {
    height: screenWidth * 0.025,
  },
  loader: {
    marginTop: screenHeight * 0.08,
  },
  emptyText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: FONT_LABEL,
    color: 'rgba(0,0,0,0.55)',
    textAlign: 'center',
    marginTop: screenHeight * 0.08,
  },
});

// ─── Card Styles ──────────────────────────────────────────────────────────────
const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(3, 3, 3, 0.14)',
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 10,
    overflow: 'hidden',
    paddingHorizontal: screenWidth * 0.04,
    paddingVertical: screenWidth * 0.03,
  },
  cardSelected: {
    borderColor: '#007AFF',
    borderWidth: 1.5,
  },
  title: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: FONT_TITLE,
    color: '#000000',
    marginBottom: screenWidth * 0.015,
  },
  detailsRow: {
    flexDirection: 'column',
    gap: screenWidth * 0.015,
    marginBottom: screenWidth * 0.015,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: screenWidth * 0.015,
  },
  detailIcon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
  },
  detailText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: FONT_LABEL,
    color: '#000000',
  },
  price: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: FONT_LABEL,
    color: '#000000',
  },
  distance: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: FONT_DIST,
    color: 'rgba(0,0,0,0.5)',
    marginTop: screenWidth * 0.008,
  },
});
