/**
 * search.tsx — Figma: "Search / Map Screen"
 *
 * Full-screen map view with a semi-transparent "Nearby Locations" bottom panel.
 *
 * Layout:
 *   1. MapView — fills the entire screen as a background layer
 *   2. Nearby Locations panel — absolute overlay anchored to the bottom (~53% height)
 *      ├── Header row: SpotOn logo + "SpotOn" text
 *      ├── "Location: [query]" subtitle
 *      └── Scrollable FlatList of nearby parking listing cards
 *
 * Navigation:
 *   Arrives from SearchBar via:
 *     router.push({ pathname: '/search', params: { query: '...' } })
 *
 * Install dependency (if not already installed):
 *   npx expo install react-native-maps
 */

// ─── React & React Native ────────────────────────────────────────────────────
import React from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

// ─── Expo Router ─────────────────────────────────────────────────────────────
import { useLocalSearchParams, useRouter } from 'expo-router';

// ─── Map ─────────────────────────────────────────────────────────────────────
import MapView, { Marker } from 'react-native-maps';

// ─── Icons ───────────────────────────────────────────────────────────────────
import { Ionicons } from '@expo/vector-icons';

// ─── Constants ───────────────────────────────────────────────────────────────
import { CustomFonts, Palette } from '@/src/constants/theme';

// ─── Assets ──────────────────────────────────────────────────────────────────
import spotonLogoAsset from '@/assets/images/spotonlogo.png';
import cabinIconAsset  from '@/assets/images/cabin.png';
import clockIconAsset  from '@/assets/images/clock.png';

// ─── Responsive sizing ───────────────────────────────────────────────────────
const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const H_PAD        = screenWidth * 0.045;   // horizontal padding inside the panel
const V_PAD        = screenWidth * 0.04;   // vertical padding inside the panel
const PANEL_HEIGHT = screenHeight * 0.56;   // bottom panel takes ~53% of screen

const LOGO_SIZE    = screenWidth * 0.09;    // SpotOn logo in panel header
const ICON_SIZE    = screenWidth * 0.045;   // cabin / clock icon in cards
const BACK_SIZE    = screenWidth * 0.06;    // back-button icon

const FONT_TITLE   = screenWidth * 0.042;   // card location title
const FONT_LABEL   = screenWidth * 0.032;   // card details text
const FONT_HEADER  = screenWidth * 0.05;    // "SpotOn" header text
const FONT_QUERY   = screenWidth * 0.031;   // "Location: ..." subtitle

// ─── Types ───────────────────────────────────────────────────────────────────
interface NearbyLocation {
  id: string;
  title: string;
  housingType: string;
  timing: string;
  price: string;
}

// ─── Placeholder Data ─────────────────────────────────────────────────────────
// TODO: Replace with real data from backend search API.
// These listings should come from a nearby-locations query (0–5 mile radius)
// using the geocoded coordinates of the searched query.
const NEARBY_LOCATIONS_DATA: NearbyLocation[] = [
  { id: '1', title: 'Univ. Avenue',   housingType: 'Residential', timing: '3 - 7 PM | Wed 15th.',    price: '$3.85 / hr' },
  { id: '2', title: 'SW 34th Street', housingType: 'Commercial',  timing: '8 AM - 6 PM | Mon-Fri',   price: '$2.50 / hr' },
  { id: '3', title: 'Archer Road',    housingType: 'Residential', timing: '5 - 10 PM | Thu 16th.',   price: '$4.25 / hr' },
  { id: '4', title: 'NW 13th Street', housingType: 'Commercial',  timing: '9 AM - 5 PM | Sat 18th.', price: '$1.75 / hr' },
  { id: '5', title: 'Museum Road',    housingType: 'Residential', timing: '12 - 8 PM | Fri 17th.',   price: '$5.00 / hr' },
];

// ─── Default map region ───────────────────────────────────────────────────────
// Centered on Gainesville, FL. latitudeDelta / longitudeDelta control zoom level.
// TODO: Geocode the search query to coordinates and center map on result.
const DEFAULT_REGION = {
  latitude: 29.6516,
  longitude: -82.3248,
  latitudeDelta: 0.04,
  longitudeDelta: 0.04,
};

// Placeholder marker — same as map center until geocoding is implemented.
// TODO: Replace with geocoded coordinates derived from the search query.
const MARKER_COORDINATE = {
  latitude: DEFAULT_REGION.latitude,
  longitude: DEFAULT_REGION.longitude,
};

// ─── NearbyLocationCard (inline component) ────────────────────────────────────
// Figma: "Listing 1 / 2 / ..." cards inside the Nearby Locations panel.
// Kept inline here to avoid over-extracting for a simple card.
function NearbyLocationCard({ item }: { item: NearbyLocation }) {
  return (
    <View style={cardStyles.card}>
      {/* Location Title — Figma: "Univ. Avenue" */}
      <Text style={cardStyles.title}>{item.title}</Text>

      {/* ── Details section ──────────────────────────────────────────────── */}
      <View style={cardStyles.detailsRow}>

        {/* Type Of Housing — Figma: "Type Of Housing" */}
        <View style={cardStyles.detailItem}>
          <Image source={cabinIconAsset} style={cardStyles.detailIcon} resizeMode="contain" />
          <Text style={cardStyles.detailText}>{item.housingType}</Text>
        </View>

        {/* Timing — Figma: "Timing" */}
        <View style={cardStyles.detailItem}>
          <Image source={clockIconAsset} style={cardStyles.detailIcon} resizeMode="contain" />
          <Text style={cardStyles.detailText}>{item.timing}</Text>
        </View>

      </View>

      {/* Price — Figma: "$3.85 / hr" */}
      <Text style={cardStyles.price}>{item.price}</Text>
    </View>
  );
}

// ─── Main Screen Component ────────────────────────────────────────────────────
export default function SearchScreen() {
  const router = useRouter();

  // Read the search query passed from SearchBar via Expo Router params
  const { query } = useLocalSearchParams<{ query: string }>();

  return (
    // flex: 1 fills the screen; map and panel are layered inside via position: absolute
    <View style={styles.screenContainer}>
      {/* Dark status bar icons — light map background */}
      <StatusBar style="dark" />

      {/* ── 1. Mapping System API — Figma: "Mapping System API" ──────────── */}
      {/*
        position: 'absolute' + full width/height lets the map sit behind
        the Nearby Locations panel while still covering the whole screen.
        mapPadding shifts the visible map center upward so the marker renders
        in the upper half of the screen, above the Nearby Locations panel.
      */}
      <MapView
        style={styles.map}
        initialRegion={DEFAULT_REGION}
        mapPadding={{ top: 0, right: 0, bottom: PANEL_HEIGHT, left: 0 }}
      >
        {/* Placeholder marker — TODO: replace with geocoded query location */}
        <Marker
          coordinate={MARKER_COORDINATE}
          title={query ?? 'Search Result'}
        />
      </MapView>

      {/* Back button — absolute overlay in the top-left, above the map */}
      <SafeAreaView style={styles.backButtonWrapper} edges={['top']}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={BACK_SIZE} color="#000" />
        </TouchableOpacity>
      </SafeAreaView>

      {/* ── 2. Nearby Locations Panel — Figma: "Nearby Locations" ────────── */}
      {/*
        Absolutely anchored to the bottom of the screen.
        Semi-transparent warm gray with rounded top corners.
        Takes up ~53% of screen height.
      */}
      <View style={styles.panel}>

        {/* ── Panel Header ────────────────────────────────────────────────── */}
        {/* Figma: SpotOn logo (left) + "SpotOn" label (right of logo) */}
        <View style={styles.panelHeader}>
          <Image
            source={spotonLogoAsset}
            style={styles.panelLogo}
            resizeMode="contain"
          />
          <Text style={styles.panelHeaderText}>SpotOn</Text>
        </View>

        {/* ── Location Searched Text ─────────────────────────────────────── */}
        {/* Figma: small subtitle showing what the user searched */}
        <Text style={styles.locationQuery} numberOfLines={1}>
          Location: {query ?? '—'}
        </Text>

        {/* ── ListView of Nearby Locations ───────────────────────────────── */}
        {/* Figma: scrollable list of listing cards */}
        <FlatList<NearbyLocation>
          data={NEARBY_LOCATIONS_DATA}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <NearbyLocationCard item={item} />}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.cardSeparator} />}
        />

      </View>
    </View>
  );
}

// ─── Screen Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: Palette.chalkgrey
  },

  // ── Map ─────────────────────────────────────────────────────────────────────
  map: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: screenWidth,
    height: screenHeight,
  },

  // ── Back Button ─────────────────────────────────────────────────────────────
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

  // ── Nearby Locations Panel ───────────────────────────────────────────────────
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

  // ── Panel Header row ─────────────────────────────────────────────────────────
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

  // ── Location query subtitle ──────────────────────────────────────────────────
  locationQuery: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: FONT_QUERY,
    color: '#000000',
    marginBottom: screenWidth * 0.05,
  },

  // ── FlatList content ─────────────────────────────────────────────────────────
  listContent: {
    paddingBottom: V_PAD,
  },
  cardSeparator: {
    height: screenWidth * 0.025,
  },
});

// ─── Card Styles ──────────────────────────────────────────────────────────────
const cardStyles = StyleSheet.create({
  // Figma: listing card — subtle dark transparent bg, black border, rounded corners
  card: {
    backgroundColor: 'rgba(3, 3, 3, 0.14)',
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 10,
    overflow: 'hidden',
    paddingHorizontal: screenWidth * 0.04,
    paddingVertical: screenWidth * 0.03,
  },

  // Location title — Figma: "Univ. Avenue"
  title: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: FONT_TITLE,
    color: '#000000',
    marginBottom: screenWidth * 0.015,
  },

  // Column that stacks Type Of Housing above Timing
  detailsRow: {
    flexDirection: 'column',
    gap: screenWidth * 0.015,
    marginBottom: screenWidth * 0.015,
  },

  // A single icon + text pair (housing type OR timing)
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

  // Price — Figma: "$3.85 / hr"
  price: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: FONT_LABEL,
    color: '#000000',
  },
});
