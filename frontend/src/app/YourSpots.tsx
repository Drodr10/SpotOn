/**
 * YourSpots — owner-facing page. Shows total earnings to date and the user's
 * active listings.
 */

import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  ImageBackground,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { supabase } from '@/src/utils/supabase';
import { type ListingForCard } from '@/src/utils/api';
import { CustomFonts } from '@/src/constants/theme';
import { withLightHaptic } from '@/src/utils/haptics';
import { getPrimaryRate } from '@/src/utils/listingPrice';
import ReservationInfoCard from '@/src/components/ProfilePageComponents/ReservationInfoCard';

import logoAsset from '@/assets/images/spotonlogo.png';
import auraGradient from '@/assets/images/profilePage/aura_gradient.png';

const { width: screenWidth } = Dimensions.get('window');
const H_PAD = screenWidth * 0.06;
const SECTION_GAP = screenWidth * 0.05;
const TITLE_SIZE = screenWidth * 0.07;
const SUB_TITLE = screenWidth * 0.045;
const LOGO_SIZE = screenWidth * 0.12;
const CARD_WIDTH = screenWidth - H_PAD * 2;

type OwnerListing = ListingForCard & { is_active?: boolean };

export default function YourSpots() {
  const [listings, setListings] = useState<OwnerListing[] | null>(null);
  const [totalEarnings, setTotalEarnings] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const { data: claimsResp } = await supabase.auth.getClaims();
      if (!claimsResp) {
        setListings([]);
        setTotalEarnings(0);
        return;
      }
      const ownerId = claimsResp.claims.sub;

      const { data: listingRows } = await supabase
        .from('listings')
        .select(
          'id, owner_id, address, price_per_hour, photo_url, hourly_rate, daily_rate, weekly_rate, monthly_rate, is_active',
        )
        .eq('owner_id', ownerId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      const ownerListings = (listingRows ?? []) as OwnerListing[];
      setListings(ownerListings);

      // Sum total_price across every reservation made on this owner's listings.
      // Done in a single query against listing_id IN (...) — works for both
      // active and historical owned listings.
      const allListingIdsResp = await supabase
        .from('listings')
        .select('id')
        .eq('owner_id', ownerId);
      const allListingIds = (allListingIdsResp.data ?? []).map((l: { id: string }) => l.id);
      if (allListingIds.length === 0) {
        setTotalEarnings(0);
      } else {
        const { data: earnRows } = await supabase
          .from('reservations')
          .select('total_price')
          .in('listing_id', allListingIds);
        const total = (earnRows ?? []).reduce(
          (sum, r: { total_price: number | null }) => sum + (r.total_price ?? 0),
          0,
        );
        setTotalEarnings(total);
      }
    })();
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backPill}
            onPress={withLightHaptic(() => router.back())}
            activeOpacity={0.85}
          >
            <Text style={styles.backLabel}>Back</Text>
          </TouchableOpacity>
          <Image source={logoAsset} style={styles.logo} resizeMode='contain' />
        </View>

        <Text style={styles.title}>Your Current Spots</Text>

        {/* Total earnings — aura-gradient pill card, same width as listings */}
        <ImageBackground
          source={auraGradient}
          style={styles.earningsCard}
          imageStyle={styles.earningsCardBg}
          resizeMode='cover'
        >
          <Text style={styles.earningsLabel}>Total Earnings</Text>
          <Text style={styles.earningsAmount}>
            {totalEarnings === null ? '—' : `$${totalEarnings.toFixed(2)}`}
          </Text>
        </ImageBackground>

        {/* My listings */}
        <Text style={styles.sectionLabel}>My Listings</Text>
        {listings === null ? (
          <ActivityIndicator color='#000' />
        ) : listings.length === 0 ? (
          <Text style={styles.emptyText}>You haven’t posted any listings yet.</Text>
        ) : (
          <View style={styles.list}>
            {listings.map((l) => {
              const rate = getPrimaryRate(l);
              const pillLabel = rate
                ? `$${rate.value.toFixed(2)} / ${rate.unit}`
                : 'Active';
              return (
                <ReservationInfoCard
                  key={l.id}
                  address={l.address}
                  photoUrl={l.photo_url}
                  variant='listing'
                  pillLabel={pillLabel}
                  width={CARD_WIDTH}
                />
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#DCDBD8',
  },
  scroll: {
    paddingHorizontal: H_PAD,
    paddingBottom: screenWidth * 0.4,
    gap: SECTION_GAP,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: screenWidth * 0.02,
  },
  backPill: {
    height: screenWidth * 0.12,
    paddingHorizontal: screenWidth * 0.07,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backLabel: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: screenWidth * 0.045,
    color: '#FFFFFF',
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
  title: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: TITLE_SIZE,
    color: '#000000',
  },
  sectionLabel: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: SUB_TITLE,
    color: '#000000',
  },
  list: {
    gap: SECTION_GAP,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.038,
    color: 'rgba(0,0,0,0.6)',
    textAlign: 'center',
  },
  earningsCard: {
    width: CARD_WIDTH,
    alignSelf: 'center',
    borderRadius: CARD_WIDTH * 0.085,
    paddingHorizontal: screenWidth * 0.06,
    paddingVertical: screenWidth * 0.05,
    overflow: 'hidden',
  },
  earningsCardBg: {
    borderRadius: CARD_WIDTH * 0.085,
  },
  earningsLabel: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: screenWidth * 0.042,
    color: '#000000',
  },
  earningsAmount: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: screenWidth * 0.085,
    color: '#000000',
    marginTop: screenWidth * 0.01,
  },
});
