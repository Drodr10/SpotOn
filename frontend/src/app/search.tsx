/**
 * search.tsx — Figma: "Search / Map Screen" (387-82) + listing detail (389-166).
 *
 * Full-screen map view with a draggable "Nearby Locations" bottom sheet panel
 * and an in-place listing detail state.
 */

// ─── React & React Native ────────────────────────────────────────────────────
import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
  ScrollView as RNScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

// ─── Expo Router ─────────────────────────────────────────────────────────────
import { useLocalSearchParams, useRouter } from 'expo-router';

// ─── Map ─────────────────────────────────────────────────────────────────────
import MapView, { Marker } from 'react-native-maps';

// ─── Icons ───────────────────────────────────────────────────────────────────
import { Ionicons } from '@expo/vector-icons';

// ─── Gestures + Animations (Reanimated v3+) ─────────────────────────────────
import { FlatList, Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';

// ─── Supabase / Stripe ───────────────────────────────────────────────────────
import { supabase } from '../utils/supabase';
import { StripeProvider } from '@stripe/stripe-react-native';
import { stripe } from '../utils/stripe';
import PaymentCard from '@/src/components/PaymentCard';

// ─── Constants / Components / Assets ─────────────────────────────────────────
import { CustomFonts, Palette } from '@/src/constants/theme';
import FilterToggle from '@/src/components/FilterToggle';
import HourScroller from '@/src/components/HourScroller';
import spotonLogoAsset from '@/assets/images/spotonlogo.png';
import cabinIconAsset from '@/assets/images/cabin.png';
import placeholderImageAsset from '@/assets/images/mapimageplaceholder.png';
import calendarImg from '@/assets/images/calendar.png';
import monthlyTagAsset from '@/assets/images/MonthlyTag.png';
import dailyTagAsset from '@/assets/images/DailyTag.png';

// ─── Booking utilities ───────────────────────────────────────────────────────
import {
  findOrCreateConversation,
  insertBookingConfirmationMessage,
} from '@/src/utils/conversations';
import DateRangePicker from '@/src/components/DateRangePicker';
import { triggerLightHaptic, withLightHaptic } from '@/src/utils/haptics';
import { usePricingPreview } from '@/src/hooks/usePricingPreview';
import { getPrimaryRate } from '@/src/utils/listingPrice';

// ─── Types ───────────────────────────────────────────────────────────────────
interface Listing {
  id: string;
  owner_id: string;
  address: string;
  latitude: number;
  longitude: number;
  price_per_hour: number | null;
  hourly_rate: number | null;
  daily_rate: number | null;
  weekly_rate: number | null;
  monthly_rate: number | null;
  is_active: boolean;
  photo_url: string | null;
  created_at: string;
  distance: number; // miles, computed client-side
}

// ─── Haversine helper ─────────────────────────────────────────────────────────
function getDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

// ─── NearbyLocationCard (image removed per Figma 387-82) ─────────────────────
function NearbyLocationCard({
  item,
  selected,
  onPress,
  fontTitle,
  fontLabel,
  fontPrice,
  fontDist,
  iconSize,
}: {
  item: Listing;
  selected: boolean;
  onPress: () => void;
  fontTitle: number;
  fontLabel: number;
  fontPrice: number;
  fontDist: number;
  iconSize: number;
}) {
  return (
    <TouchableOpacity
      onPress={() => {
        triggerLightHaptic();
        onPress();
      }}
      activeOpacity={0.85}
    >
      <View style={[cardStyles.card, selected && cardStyles.cardSelected]}>
        <Text style={[cardStyles.title, { fontSize: fontTitle }]} numberOfLines={2}>
          {item.address}
        </Text>

        <View style={cardStyles.detailsRow}>
          <View style={cardStyles.detailItem}>
            <Image
              source={cabinIconAsset}
              style={[cardStyles.detailIcon, { width: iconSize, height: iconSize }]}
              resizeMode="contain"
            />
            <Text style={[cardStyles.detailText, { fontSize: fontLabel }]}>
              Parking Spot
            </Text>
          </View>
        </View>

        <View style={cardStyles.bottomRow}>
          <View>
            {(() => {
              const r = getPrimaryRate(item);
              return (
                <Text style={[cardStyles.price, { fontSize: fontPrice }]}>
                  {r ? `$${r.value.toFixed(2)}` : '—'}
                  <Text style={cardStyles.priceUnit}>{r ? ` / ${r.unit}` : ''}</Text>
                </Text>
              );
            })()}
            {item.daily_rate != null && (
              <Image
                source={dailyTagAsset}
                style={[cardStyles.rateTag, { height: fontPrice }]}
                resizeMode="contain"
              />
            )}
            {item.monthly_rate != null && (
              <Image
                source={monthlyTagAsset}
                style={[cardStyles.rateTag, { height: fontPrice }]}
                resizeMode="contain"
              />
            )}
          </View>
          <Text style={[cardStyles.distance, { fontSize: fontDist }]}>
            {item.distance.toFixed(1)} mi away
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function SearchScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const listRef = useRef<FlatList<Listing>>(null);

  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  // Responsive sizing — recomputed when dimensions change
  const sizes = useMemo(() => {
    // Approximate height of the panel header area when detail view is open
    // (handle + logo row + location text, no FilterToggle).
    const DETAIL_HEADER_HEIGHT = Math.round(
      screenWidth * 0.02 +         // panel paddingTop (V_PAD * 0.5)
      21 +                          // handleArea (8+5+8)
      screenWidth * 0.09 +          // logo row height (LOGO_SIZE)
      screenWidth * 0.015 +         // marginBottom after header
      screenWidth * 0.031 * 1.4 +   // locationQuery line height
      screenWidth * 0.03,           // marginBottom after locationQuery
    );
    return {
      H_PAD: screenWidth * 0.045,
      V_PAD: screenWidth * 0.04,
      LOGO_SIZE: screenWidth * 0.09,
      BACK_SIZE: screenWidth * 0.06,
      ICON_SIZE: screenWidth * 0.045,
      FONT_TITLE: screenWidth * 0.042,
      FONT_LABEL: screenWidth * 0.032,
      FONT_HEADER: screenWidth * 0.05,
      FONT_QUERY: screenWidth * 0.031,
      FONT_DIST: screenWidth * 0.028,
      FONT_PRICE: screenWidth * 0.05,
      ESTIMATED_ITEM_HEIGHT: screenWidth * 0.32,
      DETAIL_HEADER_HEIGHT,
    };
  }, [screenWidth]);

  // Bottom-sheet panel heights.
  // COLLAPSED = floor; only handle + logo row visible.
  // MIN = default starting height (56% of screen).
  // MAX = fully expanded (88% of screen).
  const PANEL_COLLAPSED_HEIGHT = screenWidth * 0.25;
  const PANEL_MIN_HEIGHT = screenHeight * 0.56;
  const PANEL_MAX_HEIGHT = screenHeight * 0.88;
  const PANEL_DETAIL_HEIGHT = screenHeight * 0.7;

  const { query, lat: latParam, lng: lngParam, openListingId } = useLocalSearchParams<{
    query: string;
    lat: string;
    lng: string;
    openListingId: string;
  }>();

  const userLat = latParam ? parseFloat(latParam) : 29.6516;
  const userLng = lngParam ? parseFloat(lngParam) : -82.3248;

  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [publishableKey, setPublishableKey] = useState<string>('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [filterIndex, setFilterIndex] = useState(0); // FilterToggle: 0=Hourly, 1=Weekly
  /**
   * Three-state view machine:
   *  - 'list'    → map + draggable Nearby Locations panel
   *  - 'detail'  → list card pressed; image + selected card + Continue/Back
   *  - 'booking' → Continue pressed; full-screen booking view (Hourly Current/Schedule)
   */
  const [viewState, setViewState] = useState<'list' | 'detail' | 'booking'>('list');
  const isDetailView = viewState === 'detail';
  const [detailContentHeight, setDetailContentHeight] = useState(0);

  // ─── Animated panel state (Reanimated worklets) ────────────────────────
  const panelHeight = useSharedValue(PANEL_MIN_HEIGHT);
  const startHeight = useSharedValue(PANEL_MIN_HEIGHT);
  const isDetailViewSV = useSharedValue(0); // 0 = list, 1 = detail (gates pan gesture)
  const detailOpacity = useSharedValue(0);
  const listOpacity = useSharedValue(1);

  useEffect(() => {
    supabase.auth.getClaims().then(({ data }) => {
      if (data) setCurrentUserId(data.claims.sub);
    });
  }, []);

  const fetchPublishableKey = async () => {
    const key = await stripe.getKey();
    if (key) setPublishableKey(key);
    else console.log('Error fetching publishable key');
  };

  const initialRegion = {
    latitude: userLat,
    longitude: userLng,
    latitudeDelta: 0.04,
    longitudeDelta: 0.04,
  };

  // ─── Fetch listings ─────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      const latDelta = 0.0724;
      const lngDelta = 0.0724 / Math.cos((userLat * Math.PI) / 180);

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

  useEffect(() => {
    fetchPublishableKey();
  }, []);

  // Auto-open detail view when arriving from DynamicViewer's arrow button.
  // Waits for listings to load, then selects the target listing and enters detail view.
  useEffect(() => {
    if (!openListingId || loading || listings.length === 0) return;
    const target = listings.find((l) => l.id === openListingId);
    if (target) handleCardPress(target);
  }, [openListingId, listings, loading]);

  // ─── Detail view animation orchestration ────────────────────────────────
  useEffect(() => {
    if (isDetailView) {
      isDetailViewSV.value = 1;
      // Use measured content height when available; fall back to fixed constant.
      const targetH =
        detailContentHeight > 0
          ? Math.min(PANEL_MAX_HEIGHT, sizes.DETAIL_HEADER_HEIGHT + detailContentHeight + 24)
          : PANEL_DETAIL_HEIGHT;
      panelHeight.value = withSpring(targetH, { damping: 20, stiffness: 140 });
      detailOpacity.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
      listOpacity.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
    } else {
      isDetailViewSV.value = 0;
      panelHeight.value = withSpring(PANEL_MIN_HEIGHT, { damping: 22, stiffness: 140 });
      detailOpacity.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
      listOpacity.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
    }
  }, [isDetailView, PANEL_DETAIL_HEIGHT, PANEL_MIN_HEIGHT, PANEL_MAX_HEIGHT]);

  // Refine panel height once the detail content finishes measuring its layout.
  useEffect(() => {
    if (isDetailView && detailContentHeight > 0) {
      const target = Math.min(
        PANEL_MAX_HEIGHT,
        sizes.DETAIL_HEADER_HEIGHT + detailContentHeight + 24,
      );
      panelHeight.value = withSpring(target, { damping: 20, stiffness: 140 });
    }
  }, [detailContentHeight]);

  // ─── Pan gesture for the drag handle ───────────────────────────────────
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          if (isDetailViewSV.value === 1) return;
          startHeight.value = panelHeight.value;
        })
        .onUpdate((e) => {
          if (isDetailViewSV.value === 1) return;
          const next = startHeight.value - e.translationY;
          panelHeight.value = Math.min(
            PANEL_MAX_HEIGHT,
            Math.max(PANEL_COLLAPSED_HEIGHT, next),
          );
        })
        .onEnd(() => {
          if (isDetailViewSV.value === 1) return;
          panelHeight.value = withSpring(panelHeight.value, {
            damping: 22,
            stiffness: 180,
          });
        }),
    [PANEL_COLLAPSED_HEIGHT, PANEL_MAX_HEIGHT],
  );

  const animatedPanelStyle = useAnimatedStyle(() => ({
    height: panelHeight.value,
  }));
  const animatedListStyle = useAnimatedStyle(() => ({
    opacity: listOpacity.value,
  }));
  const animatedDetailStyle = useAnimatedStyle(() => ({
    opacity: detailOpacity.value,
    // pointerEvents handled via prop below
  }));

  // ─── Selection helpers ─────────────────────────────────────────────────
  const scrollListToListing = (listingId: string) => {
    const idx = filteredListings.findIndex((l) => l.id === listingId);
    if (idx < 0) return;
    listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0 });
  };

  // List → map (existing behavior). Pressing a list card opens detail view.
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
    setViewState('detail');
  };

  // Map pin → list. Selects + scrolls list, but does NOT open detail view.
  const handleMarkerPress = (listing: Listing) => {
    setSelectedId(listing.id);
    scrollListToListing(listing.id);
  };

  const handleBackFromDetail = () => {
    setViewState('list');
  };

  const handleContinueFromDetail = () => {
    setViewState('booking');
  };

  const handleBackFromBooking = () => {
    setViewState('detail');
  };

  const filteredListings = useMemo(() => {
    if (filterIndex === 0) {
      // Hourly tab: has an hourly/daily rate and no weekly/monthly rate
      return listings.filter(
        (l) =>
          (l.hourly_rate != null || l.daily_rate != null || l.price_per_hour != null) &&
          l.weekly_rate == null &&
          l.monthly_rate == null,
      );
    }
    // Weekly tab: has a weekly or monthly rate
    return listings.filter((l) => l.weekly_rate != null || l.monthly_rate != null);
  }, [listings, filterIndex]);

  const selectedListing = useMemo(
    () => listings.find((l) => l.id === selectedId) ?? null,
    [listings, selectedId],
  );

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <StripeProvider publishableKey={publishableKey} merchantIdentifier="merchant.identifier">
      <View style={[styles.screenContainer, { backgroundColor: Palette.chalkgrey }]}>
        <StatusBar style="dark" />

        {/* ── Map ──────────────────────────────────────────────────────── */}
        <MapView
          ref={mapRef}
          style={[styles.map, { width: screenWidth, height: screenHeight }]}
          initialRegion={initialRegion}
          showsUserLocation
          mapPadding={{ top: 0, right: 0, bottom: PANEL_MIN_HEIGHT, left: 0 }}
        >
          <Marker
            coordinate={{ latitude: userLat, longitude: userLng }}
            title={query ?? 'Searched Location'}
            pinColor="#007AFF"
          />
          {filteredListings.map((listing) => (
          <Marker
            key={listing.id}
            coordinate={{ latitude: listing.latitude, longitude: listing.longitude }}
            title={listing.address}
            pinColor={selectedId === listing.id ? '#007AFF' : '#E02020'}
              onPress={() => {
                triggerLightHaptic();
                handleMarkerPress(listing);
              }}
          />
          ))}
        </MapView>

        {/* ── Back Button ──────────────────────────────────────────────── */}
        <SafeAreaView style={styles.backButtonWrapper} edges={['top']}>
          <TouchableOpacity
            style={[
              styles.backButton,
              {
                margin: screenWidth * 0.04,
                padding: screenWidth * 0.02,
              },
            ]}
            onPress={withLightHaptic(() => router.back())}
          >
            <Ionicons name="arrow-back" size={sizes.BACK_SIZE} color="#000" />
          </TouchableOpacity>
        </SafeAreaView>

        {/* ── Animated Bottom Sheet Panel ─────────────────────────────── */}
        <Animated.View
          style={[
            styles.panel,
            {
              left: sizes.H_PAD * 0.25,
              right: sizes.H_PAD * 0.25,
              borderTopLeftRadius: screenWidth * 0.1,
              borderTopRightRadius: screenWidth * 0.1,
              paddingHorizontal: sizes.H_PAD,
              paddingTop: sizes.V_PAD * 0.5,
            },
            animatedPanelStyle,
          ]}
        >
          {/* Drag handle — only this responds to the pan gesture */}
          <GestureDetector gesture={panGesture}>
            <View style={styles.handleArea}>
              <View style={styles.handlePill} />
            </View>
          </GestureDetector>

          <View style={[styles.panelHeader, { marginBottom: screenWidth * 0.015 }]}>
            <Image
              source={spotonLogoAsset}
              style={{ width: sizes.LOGO_SIZE, height: sizes.LOGO_SIZE }}
              resizeMode="contain"
            />
            <Text style={[styles.panelHeaderText, { fontSize: sizes.FONT_HEADER }]}>
              SpotOn
            </Text>
          </View>

          <Text
            style={[
              styles.locationQuery,
              { fontSize: sizes.FONT_QUERY, marginBottom: screenWidth * 0.03 },
            ]}
            numberOfLines={1}
          >
            Location: {query ?? '—'}
          </Text>

          {/* Filter Selection (Figma 387-82) — hidden while detail view is open */}
          {!isDetailView && (
            <View style={{ marginBottom: screenWidth * 0.04 }}>
              <FilterToggle
                options={['Hourly', 'Weekly']}
                value={filterIndex}
                onChange={setFilterIndex}
              />
            </View>
          )}

          {/* Shared wrapper — detailOverlay's top:0 is relative to here (after the header) */}
          <View style={{ flex: 1 }}>

          {/* List view (fades out in detail state) */}
          <Animated.View
            style={[styles.listContainer, animatedListStyle]}
            pointerEvents={isDetailView ? 'none' : 'auto'}
          >
            {loading ? (
              <ActivityIndicator
                size="large"
                color="#000"
                style={{ marginTop: screenHeight * 0.08 }}
              />
            ) : filteredListings.length === 0 ? (
              <Text
                style={[
                  styles.emptyText,
                  { fontSize: sizes.FONT_LABEL, marginTop: screenHeight * 0.08 },
                ]}
              >
                No spots found within 5 miles
              </Text>
            ) : (
              <FlatList<Listing>
                ref={listRef}
                data={filteredListings}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <NearbyLocationCard
                    item={item}
                    selected={selectedId === item.id}
                    onPress={() => handleCardPress(item)}
                    fontTitle={sizes.FONT_TITLE}
                    fontLabel={sizes.FONT_LABEL}
                    fontPrice={sizes.FONT_PRICE}
                    fontDist={sizes.FONT_DIST}
                    iconSize={sizes.ICON_SIZE}
                  />
                )}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: sizes.V_PAD }}
                ItemSeparatorComponent={() => <View style={{ height: screenWidth * 0.025 }} />}
                onScrollToIndexFailed={(info) => {
                  // Safe fallback: estimate offset, then retry once layout is ready.
                  const offset = info.index * sizes.ESTIMATED_ITEM_HEIGHT;
                  listRef.current?.scrollToOffset({ offset, animated: true });
                  setTimeout(() => {
                    listRef.current?.scrollToIndex({
                      index: info.index,
                      animated: true,
                      viewPosition: 0,
                    });
                  }, 250);
                }}
              />
            )}
          </Animated.View>

          {/* Detail view (Figma 389-166) — overlays the list when a card is pressed */}
          <Animated.View
            style={[styles.detailOverlay, animatedDetailStyle]}
            pointerEvents={isDetailView ? 'auto' : 'none'}
          >
            {selectedListing && (
              <ListingDetailView
                listing={selectedListing}
                screenWidth={screenWidth}
                fontTitle={sizes.FONT_TITLE}
                fontLabel={sizes.FONT_LABEL}
                fontPrice={sizes.FONT_PRICE}
                fontDist={sizes.FONT_DIST}
                iconSize={sizes.ICON_SIZE}
                onBack={handleBackFromDetail}
                onContentHeight={setDetailContentHeight}
                onContinue={handleContinueFromDetail}
              />
            )}
          </Animated.View>

          </View>{/* end shared wrapper */}
        </Animated.View>

        {/* ── Booking View (Hourly Current / Schedule, Figma 389-196 / 389-224) ── */}
        {viewState === 'booking' && selectedListing && (
          <BookingView
            listing={selectedListing}
            mode={filterIndex === 0 ? 'hourly' : 'weekly'}
            currentUserId={currentUserId}
            screenWidth={screenWidth}
            screenHeight={screenHeight}
            sizes={sizes}
            onBack={handleBackFromBooking}
            onPaymentDone={() => setViewState('list')}
          />
        )}
      </View>
    </StripeProvider>
  );
}

// ─── Listing Detail Subview (Figma 389-166) ─────────────────────────────────
function ListingDetailView({
  listing,
  screenWidth,
  fontTitle,
  fontLabel,
  fontPrice,
  fontDist,
  iconSize,
  onBack,
  onContinue,
  onContentHeight,
}: {
  listing: Listing;
  screenWidth: number;
  fontTitle: number;
  fontLabel: number;
  fontPrice: number;
  fontDist: number;
  iconSize: number;
  onBack: () => void;
  onContinue: () => void;
  onContentHeight: (h: number) => void;
}) {
  const imgSource = listing.photo_url ? { uri: listing.photo_url } : placeholderImageAsset;
  const actionButtonHeight = screenWidth * 0.11;
  return (
    <View style={detailStyles.wrap}>
      {/* Inner view measured so the panel can auto-fit its height */}
      <View onLayout={(e) => onContentHeight(e.nativeEvent.layout.height)}>
      {/* Image */}
      <Image
        source={imgSource}
        style={[
          detailStyles.image,
          {
            aspectRatio: 16 / 9,
            borderRadius: screenWidth * 0.04,
          },
        ]}
        resizeMode="cover"
      />

      {/* Card */}
      <View style={[cardStyles.card, cardStyles.cardSelected, { marginTop: screenWidth * 0.02 }]}>
        <Text style={[cardStyles.title, { fontSize: fontTitle }]} numberOfLines={2}>
          {listing.address}
        </Text>
        <View style={cardStyles.detailsRow}>
          <View style={cardStyles.detailItem}>
            <Image
              source={cabinIconAsset}
              style={[cardStyles.detailIcon, { width: iconSize, height: iconSize }]}
              resizeMode="contain"
            />
            <Text style={[cardStyles.detailText, { fontSize: fontLabel }]}>Parking Spot</Text>
          </View>
        </View>
        <View style={cardStyles.bottomRow}>
          {(() => {
            const r = getPrimaryRate(listing);
            return (
              <Text style={[cardStyles.price, { fontSize: fontPrice }]}>
                {r ? `$${r.value.toFixed(2)}` : '—'}
                <Text style={cardStyles.priceUnit}>{r ? ` / ${r.unit}` : ''}</Text>
              </Text>
            );
          })()}
          <Text style={[cardStyles.distance, { fontSize: fontDist }]}>
            {listing.distance.toFixed(1)} mi away
          </Text>
        </View>
      </View>

      {/* Action buttons */}
      <View style={[detailStyles.actionsRow, { marginTop: screenWidth * 0.025 }]}>
        <TouchableOpacity
          style={[
            detailStyles.backBtn,
            {
              width: actionButtonHeight,
              height: actionButtonHeight,
              borderRadius: actionButtonHeight / 2,
            },
          ]}
          onPress={withLightHaptic(onBack)}
          activeOpacity={0.85}
        >
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[detailStyles.continueBtn, { height: actionButtonHeight }]}
          onPress={withLightHaptic(onContinue)}
          activeOpacity={0.85}
        >
          <Text style={[detailStyles.continueBtnText, { fontSize: screenWidth * 0.04 }]}>
            Continue
          </Text>
        </TouchableOpacity>
      </View>
      </View>{/* end measurement wrapper */}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screenContainer: { flex: 1 },
  map: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  backButtonWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  backButton: {
    backgroundColor: 'rgba(220,219,216,0.85)',
    borderRadius: 999,
  },
  panel: {
    position: 'absolute',
    bottom: 0,
    backgroundColor: 'rgba(220, 219, 216, 0.92)',
    overflow: 'hidden',
  },
  handleArea: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  handlePill: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  panelHeaderText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    color: '#000000',
  },
  locationQuery: {
    fontFamily: CustomFonts.SwitzerLight,
    color: '#000000',
  },
  listContainer: {
    flex: 1,
  },
  emptyText: {
    fontFamily: CustomFonts.SwitzerLight,
    color: 'rgba(0,0,0,0.55)',
    textAlign: 'center',
  },
  detailOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 0,
    paddingTop: 0,
  },
});

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(3, 3, 3, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.85)',
    borderRadius: 12,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cardSelected: {
    borderColor: '#007AFF',
    borderWidth: 1.5,
  },
  title: {
    fontFamily: CustomFonts.SwitzerSemibold,
    color: '#000000',
    marginBottom: 6,
  },
  detailsRow: {
    flexDirection: 'column',
    gap: 6,
    marginBottom: 8,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailIcon: {},
  detailText: {
    fontFamily: CustomFonts.SwitzerLight,
    color: '#000000',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
  },
  rateTag: {
    aspectRatio: 2,
    marginTop: 2,
    alignSelf: 'flex-start',
  },
  price: {
    fontFamily: CustomFonts.BevellierMedium,
    color: '#000000',
  },
  priceUnit: {
    fontFamily: CustomFonts.BevellierMedium,
    color: 'rgba(0,0,0,0.7)',
  },
  distance: {
    fontFamily: CustomFonts.SwitzerLight,
    color: 'rgba(0,0,0,0.55)',
    alignSelf: 'flex-end',
    textAlign: 'right',
  },
});

const detailStyles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingTop: 8,
    paddingBottom: 16,
  },
  image: {
    width: '100%',
    backgroundColor: 'rgba(0,0,0,0.06)',
    marginBottom: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  continueBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
    borderRadius: 12,
  },
  continueBtnText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    color: '#fff',
  },
});

// ─── Booking View (Figma 389-196 / 389-224) ─────────────────────────────────
// Hourly Current (default) and Hourly Schedule modes. Weekly placeholder.

function tierUnitLabel(tier: string): string {
  switch (tier) {
    case 'hourly': return 'h';
    case 'daily': return 'd';
    case 'weekly': return 'w';
    case 'monthly': return 'mo';
    default: return '';
  }
}

type SizesShape = {
  H_PAD: number;
  V_PAD: number;
  LOGO_SIZE: number;
  ICON_SIZE: number;
  FONT_TITLE: number;
  FONT_LABEL: number;
  FONT_HEADER: number;
  FONT_QUERY: number;
  FONT_DIST: number;
  FONT_PRICE: number;
  ESTIMATED_ITEM_HEIGHT: number;
  DETAIL_HEADER_HEIGHT: number;
};

const HARD_CAP_HOURS = 96; // 4 days
const HARD_CAP_WEEKS = 52;    // 1-year cap
const HOURS_PER_WEEK = 168;   // 24 × 7
const WEEKS_PER_MONTH = 4;    // billing month = 4 weeks

function format12Hour(h: number): string {
  const local = ((h % 24) + 24) % 24;
  const period = local >= 12 ? 'PM' : 'AM';
  const display = local % 12 === 0 ? 12 : local % 12;
  return `${display} ${period}`;
}

function format12HourRich(h: number): { primary: string; secondary: string } {
  const local = ((h % 24) + 24) % 24;
  const period = local >= 12 ? 'PM' : 'AM';
  const display = local % 12 === 0 ? 12 : local % 12;
  return { primary: String(display), secondary: period };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatTimeWithMinutes(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const period = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:${pad2(m)} ${period}`;
}

function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function shortDateWithDay(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function BookingView({
  listing,
  mode,
  currentUserId,
  screenWidth,
  screenHeight,
  sizes,
  onBack,
  onPaymentDone,
}: {
  listing: Listing;
  mode: 'hourly' | 'weekly';
  currentUserId: string | null;
  screenWidth: number;
  screenHeight: number;
  sizes: SizesShape;
  onBack: () => void;
  onPaymentDone: () => void;
}) {
  const router = useRouter();

  // Mount-time anchor — minutes captured once, never drifts with wall clock.
  const mountTime = useMemo(() => new Date(), []);

  // ─── Booking-mode state (Current is default per Figma) ───────────────────
  const [bookingMode, setBookingMode] = useState<'current' | 'schedule'>('current');

  // ─── Hourly Current state ───────────────────────────────────────────────
  const [currentHours, setCurrentHours] = useState(1);

  // ─── Hourly Schedule state ──────────────────────────────────────────────
  const initialStartHour = mountTime.getHours();
  const [startHour, setStartHour] = useState(initialStartHour);
  // End hour is "extended" — can exceed 23 for day rollover.
  const [endHour, setEndHour] = useState(initialStartHour + 2);
  const [scheduleStart, setScheduleStart] = useState<Date>(() => {
    const d = new Date(mountTime);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [scheduleEndDate, setScheduleEndDate] = useState<Date | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  // True while the user is interacting with any of the picker wheels — gates
  // the parent page ScrollView so the page doesn't slide while the user
  // scrolls a number wheel.
  const [pickerActive, setPickerActive] = useState(false);
  const lockPicker = useCallback(() => setPickerActive(true), []);
  const unlockPicker = useCallback(() => setPickerActive(false), []);

  // Clamp Schedule end > start; respect 4-day cap.
  useEffect(() => {
    if (endHour <= startHour) {
      setEndHour(startHour + 1);
    } else if (endHour - startHour > HARD_CAP_HOURS) {
      setEndHour(startHour + HARD_CAP_HOURS);
    }
  }, [startHour, endHour]);

  // ─── Weekly state ────────────────────────────────────────────────────────
  const [currentWeeks, setCurrentWeeks] = useState(1);
  // Start off-screen right; springs in on first month, eases back out off-screen.
  // Image width ≈ screenWidth * 0.225 (LOGO_SIZE * aspectRatio 2.5).
  // ▼ TUNE exit distance: increase to push the tag further right when hiding ▼
  const MONTHLY_TAG_EXIT_X = screenWidth * 0.5;
  const monthlyTagTranslateX = useSharedValue(MONTHLY_TAG_EXIT_X);
  useEffect(() => {
    if (currentWeeks >= WEEKS_PER_MONTH) {
      // ▼ TUNE spring: damping controls overshoot (higher = less bounce), stiffness controls speed ▼
      monthlyTagTranslateX.value = withSpring(0, { damping: 33, stiffness: 200 });
    } else {
      monthlyTagTranslateX.value = withTiming(MONTHLY_TAG_EXIT_X, {
        duration: 220,
        easing: Easing.in(Easing.cubic),
      });
    }
  }, [currentWeeks]);
  const monthlyTagAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: monthlyTagTranslateX.value }],
  }));

  // ─── DailyTag animation (hourly mode) ───────────────────────────────────
  const DAILY_TAG_EXIT_X = screenWidth * 0.5;
  const dailyTagTranslateX = useSharedValue(DAILY_TAG_EXIT_X);
  const dailyTagAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dailyTagTranslateX.value }],
  }));

  // ─── Mode-switch animation ──────────────────────────────────────────────
  const isCurrentSV = useSharedValue(1); // 1 = current (default), 0 = schedule
  useEffect(() => {
    isCurrentSV.value = withTiming(bookingMode === 'current' ? 1 : 0, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [bookingMode]);

  const calendarBtnAnimStyle = useAnimatedStyle(() => ({
    opacity: 1 - isCurrentSV.value,
    transform: [{ scale: 0.9 + (1 - isCurrentSV.value) * 0.1 }],
  }));
  const segmentedAnimStyle = useAnimatedStyle(() => {
    // Segmented control fills row in schedule mode, slightly narrower & centered in current.
    return {
      flex: 1,
      // No translation needed — using flex layout. The icon's space collapses via opacity+width.
    };
  });
  const currentScrollerAnimStyle = useAnimatedStyle(() => ({
    opacity: isCurrentSV.value,
  }));
  const scheduleScrollerAnimStyle = useAnimatedStyle(() => ({
    opacity: 1 - isCurrentSV.value,
  }));
  const calendarBtnContainerAnimStyle = useAnimatedStyle(() => ({
    width: (1 - isCurrentSV.value) * (sizes.H_PAD + 44 + 12), // 44 btn + 12 gap
    opacity: 1 - isCurrentSV.value,
    overflow: 'hidden',
  }));

  // ─── Derived booking math ───────────────────────────────────────────────
  const { startDateTime, endDateTime, hoursBooked } = useMemo(() => {
    if (bookingMode === 'current') {
      const start = mountTime;
      const end = new Date(start.getTime() + currentHours * 3600 * 1000);
      return { startDateTime: start, endDateTime: end, hoursBooked: currentHours };
    }
    // schedule
    const start = new Date(scheduleStart);
    start.setHours(startHour, mountTime.getMinutes(), 0, 0);
    const end = new Date(start.getTime() + (endHour - startHour) * 3600 * 1000);
    return { startDateTime: start, endDateTime: end, hoursBooked: endHour - startHour };
  }, [bookingMode, currentHours, mountTime, scheduleStart, startHour, endHour]);

  // ─── Summary line ───────────────────────────────────────────────────────
  const sameDay =
    startDateTime.toDateString() === endDateTime.toDateString();
  const summaryLine = sameDay
    ? `${shortDate(startDateTime)} | ${formatTimeWithMinutes(startDateTime)} - ${formatTimeWithMinutes(endDateTime)}`
    : `${shortDateWithDay(startDateTime)} → ${shortDateWithDay(endDateTime)} | ${formatTimeWithMinutes(startDateTime)} - ${formatTimeWithMinutes(endDateTime)}`;

  // ─── Weekly derived values ───────────────────────────────────────────────
  const weeklyEnd = useMemo(
    () => new Date(mountTime.getTime() + currentWeeks * 7 * 24 * 3_600_000),
    [mountTime, currentWeeks],
  );
  const weeklySummary = `${shortDate(mountTime)} → ${shortDate(weeklyEnd)}`;
  const weeklyHours   = currentWeeks * HOURS_PER_WEEK;

  // ─── Pricing preview (replaces client-side tax + totals math) ───────────
  const previewStart = mode === 'hourly' ? startDateTime : mountTime;
  const previewEnd   = mode === 'hourly' ? endDateTime   : weeklyEnd;
  const { pricing, loading: pricingLoading, error: pricingError } = usePricingPreview(
    listing.id,
    previewStart,
    previewEnd,
  );

  // ─── DailyTag animation trigger ─────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'hourly') return;
    const hasDaily =
      pricing?.tier === 'daily' ||
      pricing?.line_items?.some((li) => li.tier === 'daily') === true;
    if (hasDaily) {
      dailyTagTranslateX.value = withSpring(0, { damping: 33, stiffness: 200 });
    } else {
      dailyTagTranslateX.value = withTiming(DAILY_TAG_EXIT_X, {
        duration: 220,
        easing: Easing.in(Easing.cubic),
      });
    }
  }, [pricing, mode]);

  // ─── Post-payment routing ──────────────────────────────────────────────
  const handlePaymentSuccess = async () => {
    if (!currentUserId) {
      Alert.alert('Reservation booked', 'Could not open chat (not signed in).');
      onPaymentDone();
      return;
    }
    if (currentUserId === listing.owner_id) {
      Alert.alert(
        'Reservation booked',
        'You booked your own listing — no chat to open.',
      );
      onPaymentDone();
      return;
    }
    try {
      const { conversationId, ownerName } = await findOrCreateConversation(
        currentUserId,
        listing.owner_id,
      );
      // Auto-generated booking confirmation message.
      const body = `Booking confirmed: ${listing.address} · ${hoursBooked}h · $${(pricing?.total ?? 0).toFixed(2)}. Hi! I just booked your spot.`;
      try {
        await insertBookingConfirmationMessage(conversationId, currentUserId, body);
      } catch (e) {
        console.warn('[booking] auto-message insert failed', e);
      }
      router.push({
        pathname: './Chat',
        params: { conversationId, otherUserName: ownerName },
      } as any);
    } catch (e: any) {
      Alert.alert(
        'Payment succeeded',
        `Couldn't open chat (${e?.message ?? 'unknown error'}). Your booking went through.`,
      );
      onPaymentDone();
    }
  };

  // ─── Weekly post-payment routing ────────────────────────────────────────
  const handleWeeklyPaymentSuccess = async () => {
    if (!currentUserId) {
      Alert.alert('Reservation booked', 'Could not open chat (not signed in).');
      onPaymentDone();
      return;
    }
    if (currentUserId === listing.owner_id) {
      Alert.alert('Reservation booked', 'You booked your own listing — no chat to open.');
      onPaymentDone();
      return;
    }
    try {
      const { conversationId, ownerName } = await findOrCreateConversation(
        currentUserId,
        listing.owner_id,
      );
      const body = `Booking confirmed: ${listing.address} · ${currentWeeks}w · $${(pricing?.total ?? 0).toFixed(2)}. Hi! I just booked your spot.`;
      try {
        await insertBookingConfirmationMessage(conversationId, currentUserId, body);
      } catch (e) {
        console.warn('[booking] auto-message insert failed', e);
      }
      router.push({
        pathname: './Chat',
        params: { conversationId, otherUserName: ownerName },
      } as any);
    } catch (e: any) {
      Alert.alert(
        'Payment succeeded',
        `Couldn't open chat (${e?.message ?? 'unknown error'}). Your booking went through.`,
      );
      onPaymentDone();
    }
  };

  // ─── Weekly mode ─────────────────────────────────────────────────────────
  if (mode === 'weekly') {
    return (
      <View style={[bookingStyles.screen, { backgroundColor: Palette.chalkgrey }]}>
        <SafeAreaView style={bookingStyles.safeArea} edges={['top']}>
          <RNScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 12 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            scrollEnabled={!pickerActive}
          >
            {/* Header */}
            <View style={[bookingStyles.brandHeader, { paddingHorizontal: sizes.H_PAD, marginTop: 4 }]}>
              <Image
                source={spotonLogoAsset}
                style={{ width: sizes.LOGO_SIZE, height: sizes.LOGO_SIZE }}
                resizeMode="contain"
              />
              <Text style={[bookingStyles.brandText, { fontSize: sizes.FONT_HEADER }]}>
                SpotOn Payment
              </Text>
              <Animated.View
                style={[{ marginLeft: 'auto' }, monthlyTagAnimStyle]}
                pointerEvents="none"
              >
                <Image
                  source={monthlyTagAsset}
                  style={{ height: sizes.LOGO_SIZE, aspectRatio: 2.5 }}
                  resizeMode="contain"
                />
              </Animated.View>
            </View>

            {/* Listing card */}
            <View style={[bookingStyles.cardWrap, { paddingHorizontal: sizes.H_PAD }]}>
              <View style={[cardStyles.card, cardStyles.cardSelected]}>
                <Text style={[cardStyles.title, { fontSize: sizes.FONT_TITLE }]} numberOfLines={2}>
                  {listing.address}
                </Text>
                <View style={cardStyles.detailsRow}>
                  <View style={cardStyles.detailItem}>
                    <Image
                      source={cabinIconAsset}
                      style={[cardStyles.detailIcon, { width: sizes.ICON_SIZE, height: sizes.ICON_SIZE }]}
                      resizeMode="contain"
                    />
                    <Text style={[cardStyles.detailText, { fontSize: sizes.FONT_LABEL }]}>
                      Parking Spot
                    </Text>
                  </View>
                </View>
                <View style={cardStyles.bottomRow}>
                  {(() => {
                    const r = getPrimaryRate(listing);
                    return (
                      <Text style={[cardStyles.price, { fontSize: sizes.FONT_PRICE }]}>
                        {r ? `$${r.value.toFixed(2)}` : '—'}
                        <Text style={cardStyles.priceUnit}>{r ? ` / ${r.unit}` : ''}</Text>
                      </Text>
                    );
                  })()}
                  <Text style={[cardStyles.distance, { fontSize: sizes.FONT_DIST }]}>
                    {listing.distance.toFixed(1)} mi away
                  </Text>
                </View>
              </View>
            </View>

            {/* Week scroller */}
            <View
              style={[
                bookingStyles.scrollerArea,
                {
                  paddingHorizontal: sizes.H_PAD,
                  marginTop: screenWidth * 0.06,
                  height: 360,
                },
              ]}
            >
              <View style={bookingStyles.scrollerLayer}>
                <Text style={bookingStyles.scrollerLabel}>Weeks</Text>
                <HourScroller
                  value={currentWeeks}
                  onChange={setCurrentWeeks}
                  min={1}
                  max={HARD_CAP_WEEKS}
                  fontSize={Math.min(48, screenWidth * 0.12)}
                  visibleCount={5}
                  onInteractionStart={lockPicker}
                  onInteractionEnd={unlockPicker}
                />
              </View>
            </View>

            {/* Summary line */}
            <View style={[bookingStyles.summaryRow, { paddingHorizontal: sizes.H_PAD }]}>
              <Text style={bookingStyles.summaryText}>{weeklySummary}</Text>
            </View>

            {/* Total block */}
            <View style={[bookingStyles.totalBlock, { paddingHorizontal: sizes.H_PAD }]}>
              <Text style={bookingStyles.totalLabel}>Total</Text>

              {pricing?.tier === 'monthly' ? (
                <View style={bookingStyles.totalLine}>
                  <Text style={bookingStyles.totalSubtotal}>
                    {pricing ? `$${pricing.rate.toFixed(2)} × ${pricing.units} month${pricing.units > 1 ? 's' : ''}` : '—'}
                  </Text>
                  <Text style={bookingStyles.totalSubtotalAmount}>
                    {pricing ? `$${pricing.subtotal.toFixed(2)}` : ''}
                  </Text>
                </View>
              ) : (
                <View style={bookingStyles.totalLine}>
                  <Text style={bookingStyles.totalSubtotal}>
                    {pricing ? `$${pricing.rate.toFixed(2)} × ${pricing.units} week${pricing.units > 1 ? 's' : ''}` : '—'}
                  </Text>
                  <Text style={bookingStyles.totalSubtotalAmount}>
                    {pricing ? `$${pricing.subtotal.toFixed(2)}` : ''}
                  </Text>
                </View>
              )}

              {/* Platform fee row */}
              <View style={bookingStyles.totalLine}>
                <Text style={bookingStyles.totalTaxLabel}>
                  {pricingLoading ? 'Calculating…' : pricingError ? pricingError : 'Platform fee'}
                </Text>
                {!pricingLoading && !pricingError && pricing && (
                  <Text style={bookingStyles.totalTaxAmount}>${pricing.platform_fee.toFixed(2)}</Text>
                )}
              </View>

              {/* Final total */}
              <View style={[bookingStyles.totalLine, bookingStyles.totalFinalRow]}>
                <Text style={bookingStyles.totalFinalLabel}>Total</Text>
                <Text style={bookingStyles.totalFinalAmount}>
                  {pricingLoading || pricingError || !pricing ? '—' : `$${pricing.total.toFixed(2)}`}
                </Text>
              </View>
            </View>
          </RNScrollView>

          {/* Bottom bar */}
          <View style={[bookingStyles.bottomBar, { paddingHorizontal: sizes.H_PAD }]}>
            <TouchableOpacity
              onPress={withLightHaptic(onBack)}
              style={bookingStyles.backCircle}
              activeOpacity={0.85}
            >
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </TouchableOpacity>
            <View style={bookingStyles.payWrap}>
              <PaymentCard
                listingId={listing.id}
                price={pricing?.total ?? 0}
                hours={weeklyHours}
                disabled={!pricing || !!pricingError}
                onPaymentSuccess={handleWeeklyPaymentSuccess}
              />
            </View>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ─── Render: Hourly (Current + Schedule) ────────────────────────────────
  return (
    <View style={[bookingStyles.screen, { backgroundColor: Palette.chalkgrey }]}>
      {/* Top safe area only — bottom bar manages its own offset so it lines
          up with the detail-view's Back/Continue row (which is also ~16px
          from the screen bottom, ignoring the home-indicator safe area). */}
      <SafeAreaView style={bookingStyles.safeArea} edges={['top']}>
        {/* Upper content lives in a ScrollView so the Pay/Back row at the
            bottom stays visible even on smaller phones where the picker +
            total push everything past the viewport.
            Uses RN's native ScrollView (not RNGH's) so its UIScrollView
            hierarchy plays well with the inner FlatList pickers on iOS, and
            nestedScrollEnabled handles Android. RNGH's ScrollView intercepts
            gestures at the JS layer even when scrollEnabled=false, which was
            preventing the picker wheels from receiving touches after the page
            had been scrolled. */}
        <RNScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 12 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={!pickerActive}
        >
        {/* Header — SpotOn logo + "SpotOn Payment" (matches search-panel header style) */}
        <View
          style={[
            bookingStyles.brandHeader,
            { paddingHorizontal: sizes.H_PAD, marginTop: 4 },
          ]}
        >
          <Image
            source={spotonLogoAsset}
            style={{ width: sizes.LOGO_SIZE, height: sizes.LOGO_SIZE }}
            resizeMode="contain"
          />
          <Text style={[bookingStyles.brandText, { fontSize: sizes.FONT_HEADER }]}>
            SpotOn Payment
          </Text>
          <Animated.View
            style={[{ marginLeft: 'auto' }, dailyTagAnimStyle]}
            pointerEvents="none"
          >
            <Image
              source={dailyTagAsset}
              style={{ height: sizes.LOGO_SIZE, aspectRatio: 2.5 }}
              resizeMode="contain"
            />
          </Animated.View>
        </View>

        {/* Listing card pinned at top — same visual as detail view's card */}
        <View style={[bookingStyles.cardWrap, { paddingHorizontal: sizes.H_PAD }]}>
          <View style={[cardStyles.card, cardStyles.cardSelected]}>
            <Text
              style={[cardStyles.title, { fontSize: sizes.FONT_TITLE }]}
              numberOfLines={2}
            >
              {listing.address}
            </Text>
            <View style={cardStyles.detailsRow}>
              <View style={cardStyles.detailItem}>
                <Image
                  source={cabinIconAsset}
                  style={[
                    cardStyles.detailIcon,
                    { width: sizes.ICON_SIZE, height: sizes.ICON_SIZE },
                  ]}
                  resizeMode="contain"
                />
                <Text
                  style={[cardStyles.detailText, { fontSize: sizes.FONT_LABEL }]}
                >
                  Parking Spot
                </Text>
              </View>
            </View>
            <View style={cardStyles.bottomRow}>
              {(() => {
                const r = getPrimaryRate(listing);
                return (
                  <Text style={[cardStyles.price, { fontSize: sizes.FONT_PRICE }]}>
                    {r ? `$${r.value.toFixed(2)}` : '—'}
                    <Text style={cardStyles.priceUnit}>{r ? ` / ${r.unit}` : ''}</Text>
                  </Text>
                );
              })()}
              <Text
                style={[cardStyles.distance, { fontSize: sizes.FONT_DIST }]}
              >
                {listing.distance.toFixed(1)} mi away
              </Text>
            </View>
          </View>
        </View>

        {/* Mode controls row: [Current | Schedule] + animated calendar icon */}
        <View
          style={[
            bookingStyles.modeRow,
            { paddingHorizontal: sizes.H_PAD, marginTop: screenWidth * 0.04 },
          ]}
        >
          <Animated.View style={[segmentedAnimStyle]}>
            <FilterToggle
              options={['Current', 'Schedule']}
              value={bookingMode === 'current' ? 0 : 1}
              onChange={(i) => setBookingMode(i === 0 ? 'current' : 'schedule')}
            />
          </Animated.View>
          <Animated.View style={calendarBtnContainerAnimStyle}>
            <Animated.View
              style={[
                bookingStyles.calendarBtnInner,
                calendarBtnAnimStyle,
                { marginLeft: 12 },
              ]}
            >
              <TouchableOpacity
                onPress={withLightHaptic(() => setShowCalendar(true))}
                disabled={bookingMode === 'current'}
                style={bookingStyles.calendarBtn}
                activeOpacity={0.8}
              >
                <Image
                  source={calendarImg}
                  style={bookingStyles.calendarIcon}
                  resizeMode="contain"
                />
              </TouchableOpacity>
            </Animated.View>
          </Animated.View>
        </View>

        {/* Number scroller area — cross-fade between Current and Schedule.
            ▼ Adjust `height` here if you want the picker bigger/smaller. ▼ */}
        <View
          style={[
            bookingStyles.scrollerArea,
            {
              paddingHorizontal: sizes.H_PAD,
              marginTop: screenWidth * 0.04,
              // Fixed height so it's predictable across phones; the page
              // ScrollView absorbs any overflow on small screens.
              height: 360,
            },
          ]}
        >
          {/* Current mode: 1 centered scroller (hours booked) */}
          <Animated.View
            style={[bookingStyles.scrollerLayer, currentScrollerAnimStyle]}
            pointerEvents={bookingMode === 'current' ? 'auto' : 'none'}
          >
            <Text style={bookingStyles.scrollerLabel}>Hours</Text>
            <HourScroller
              value={currentHours}
              onChange={setCurrentHours}
              min={1}
              max={HARD_CAP_HOURS}
              fontSize={Math.min(48, screenWidth * 0.12)}
              visibleCount={5}
              onInteractionStart={lockPicker}
              onInteractionEnd={unlockPicker}
            />
          </Animated.View>

          {/* Schedule mode: 2 scrollers side-by-side (start | end) */}
          <Animated.View
            style={[
              bookingStyles.scrollerLayer,
              { flexDirection: 'row', justifyContent: 'space-around' },
              scheduleScrollerAnimStyle,
            ]}
            pointerEvents={bookingMode === 'schedule' ? 'auto' : 'none'}
          >
            <View style={bookingStyles.scrollerCol}>
              <Text style={bookingStyles.scrollerLabel}>Start</Text>
              <HourScroller
                value={startHour}
                onChange={(v) => {
                  const clamped = Math.max(0, Math.min(23, v));
                  setStartHour(clamped);
                  if (endHour <= clamped) setEndHour(clamped + 1);
                  if (endHour - clamped > HARD_CAP_HOURS) {
                    setEndHour(clamped + HARD_CAP_HOURS);
                  }
                }}
                min={0}
                max={23}
                formatRich={format12HourRich}
                fontSize={Math.min(40, screenWidth * 0.1)}
                visibleCount={5}
                onInteractionStart={lockPicker}
                onInteractionEnd={unlockPicker}
              />
            </View>
            <View style={bookingStyles.scrollerCol}>
              <Text style={bookingStyles.scrollerLabel}>End</Text>
              <HourScroller
                value={endHour}
                onChange={(v) => {
                  const max = startHour + HARD_CAP_HOURS;
                  setEndHour(Math.max(startHour + 1, Math.min(max, v)));
                }}
                min={startHour + 1}
                max={startHour + HARD_CAP_HOURS}
                formatRich={format12HourRich}
                fontSize={Math.min(40, screenWidth * 0.1)}
                visibleCount={5}
                onInteractionStart={lockPicker}
                onInteractionEnd={unlockPicker}
              />
            </View>
          </Animated.View>
        </View>

        {/* Summary line */}
        <View style={[bookingStyles.summaryRow, { paddingHorizontal: sizes.H_PAD }]}>
          <Text style={bookingStyles.summaryText} numberOfLines={2}>
            {summaryLine}
          </Text>
        </View>

        {/* Total block */}
        <View style={[bookingStyles.totalBlock, { paddingHorizontal: sizes.H_PAD }]}>
          <Text style={bookingStyles.totalLabel}>Total</Text>
          {pricing?.line_items ? (
            pricing.line_items.map((li, idx) => (
              <View key={idx} style={bookingStyles.totalLine}>
                <Text style={bookingStyles.totalSubtotal}>
                  {`$${li.rate.toFixed(2)} × ${Math.round(li.units)}${tierUnitLabel(li.tier)}`}
                </Text>
                <Text style={bookingStyles.totalSubtotalAmount}>
                  {`$${li.subtotal.toFixed(2)}`}
                </Text>
              </View>
            ))
          ) : (
            <View style={bookingStyles.totalLine}>
              <Text style={bookingStyles.totalSubtotal}>
                {pricing
                  ? `$${pricing.rate.toFixed(2)} × ${Math.round(pricing.units)}${tierUnitLabel(pricing.tier)}`
                  : '—'}
              </Text>
              <Text style={bookingStyles.totalSubtotalAmount}>
                {pricing ? `$${pricing.subtotal.toFixed(2)}` : ''}
              </Text>
            </View>
          )}
          <View style={bookingStyles.totalLine}>
            <Text style={bookingStyles.totalTaxLabel}>
              {pricingLoading
                ? 'Calculating…'
                : pricingError
                ? pricingError
                : 'Platform fee'}
            </Text>
            {!pricingLoading && !pricingError && pricing && (
              <Text style={bookingStyles.totalTaxAmount}>
                ${pricing.platform_fee.toFixed(2)}
              </Text>
            )}
          </View>
          <View style={[bookingStyles.totalLine, bookingStyles.totalFinalRow]}>
            <Text style={bookingStyles.totalFinalLabel}>Total</Text>
            <Text style={bookingStyles.totalFinalAmount}>
              {pricingLoading || pricingError || !pricing ? '—' : `$${pricing.total.toFixed(2)}`}
            </Text>
          </View>
        </View>

        </RNScrollView>

        {/* Bottom row pinned outside RNScrollView — always visible. */}
        <View style={[bookingStyles.bottomBar, { paddingHorizontal: sizes.H_PAD }]}>
          <TouchableOpacity
            onPress={withLightHaptic(onBack)}
            style={bookingStyles.backCircle}
            activeOpacity={0.85}
          >
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={bookingStyles.payWrap}>
            <PaymentCard
              listingId={listing.id}
              price={pricing?.total ?? 0}
              hours={hoursBooked}
              disabled={!pricing || !!pricingError}
              onPaymentSuccess={handlePaymentSuccess}
            />
          </View>
        </View>

        {/* Single-date picker overlay (Schedule mode) */}
        <DateRangePicker
          visible={showCalendar}
          initialStart={scheduleStart}
          singleSelect
          helperText="Pick the day for your reservation."
          confirmLabel="Confirm date"
          popupOpacity={0.85}
          sideMarginPercent={2}
          onClose={() => setShowCalendar(false)}
          onConfirm={(start) => {
            setScheduleStart(start);
            setScheduleEndDate(null);
            setShowCalendar(false);
          }}
        />
      </SafeAreaView>
    </View>
  );
}

const bookingStyles = StyleSheet.create({
  screen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  safeArea: { flex: 1 },
  brandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 8,
    paddingBottom: 12,
  },
  brandText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    color: '#000',
  },
  backCircle: {
    width: 48,
    height: 48,
    // marginTop/Bottom mirror PaymentCard.container margins so the back
    // button's visible frame lines up with the Stripe button's frame
    // exactly (same top, same bottom, same height).
    marginTop: 4,
    marginBottom: 8,
    borderRadius: 999,
    backgroundColor: '#000',
    alignItems: 'center',
    alignSelf: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'stretch', // both children stretch to the row's height
    gap: 12,
    height: 60,
    // 16px from the screen edge — matches the detail-view (page 2) buttons.
    marginBottom: 16,
  },
  payWrap: {
    flex: 1,
  },
  cardWrap: {
    paddingTop: 4,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  calendarBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarIcon: {
    width: 26,
    height: 26,
  },
  scrollerArea: {
    position: 'relative',
    // Hard clip so wheel-edge items (which fade + tilt heavily) can't bleed
    // into the toggle above or the listing card below if the picker happens
    // to render slightly taller than its container on a small screen.
    overflow: 'hidden',
  },
  scrollerLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollerCol: {
    flex: 1,
    alignItems: 'center',
  },
  scrollerLabel: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: 13,
    color: 'rgba(0,0,0,0.5)',
    marginBottom: 6,
  },
  summaryRow: {
    marginTop: 18,
    alignItems: 'center',
  },
  summaryText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 15,
    color: '#000',
    textAlign: 'center',
  },
  totalBlock: {
    marginTop: 28,
    // Extra space below the total before the bottom Back/Pay row.
    marginBottom: 28,
  },
  totalLabel: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 16,
    color: '#000',
    marginBottom: 8,
  },
  totalLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  totalSubtotal: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: 14,
    color: 'rgba(0,0,0,0.7)',
  },
  totalSubtotalAmount: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: 14,
    color: 'rgba(0,0,0,0.7)',
  },
  totalTaxLabel: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: 13,
    color: 'rgba(0,0,0,0.55)',
  },
  totalTaxAmount: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: 13,
    color: 'rgba(0,0,0,0.55)',
  },
  totalFinalRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.12)',
  },
  totalFinalLabel: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: 18,
    color: '#000',
  },
  totalFinalAmount: {
    // ▼ TUNE THIS to make the final total bigger or smaller. ▼
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: 36,
    color: '#000',
  },
});
