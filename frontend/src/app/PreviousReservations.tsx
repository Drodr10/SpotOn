/**
 * PreviousReservations — Renter reservation history. Lists past reservations
 * (end_time < now) in a vertical list using the ReservationInfoCard.
 */

import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { supabase } from '@/src/utils/supabase';
import { api, type ActiveReservation } from '@/src/utils/api';
import { CustomFonts } from '@/src/constants/theme';
import { withLightHaptic } from '@/src/utils/haptics';
import ReservationInfoCard from '@/src/components/ProfilePageComponents/ReservationInfoCard';

import logoAsset from '@/assets/images/spotonlogo.png';

const { width: screenWidth } = Dimensions.get('window');
const H_PAD = screenWidth * 0.06;
const SECTION_GAP = screenWidth * 0.05;
const TITLE_SIZE = screenWidth * 0.07;
const LOGO_SIZE = screenWidth * 0.12;

export default function PreviousReservations() {
  const [items, setItems] = useState<ActiveReservation[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data: claimsResp } = await supabase.auth.getClaims();
      if (!claimsResp) {
        setItems([]);
        return;
      }
      const userId = claimsResp.claims.sub;

      const list = await api.getReservations(userId);
      const now = Date.now();
      const past = (list ?? []).filter((r) => r.end_time.getTime() < now);
      setItems(past);
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

        <Text style={styles.title}>Your Reservations</Text>

        <Text style={styles.sectionLabel}>Past Reservations</Text>
        {items === null ? (
          <ActivityIndicator color='#000' style={{ marginTop: SECTION_GAP }} />
        ) : items.length === 0 ? (
          <Text style={styles.emptyText}>You haven’t completed a reservation yet.</Text>
        ) : (
          <View style={styles.list}>
            {items.map((r) => (
              <ReservationInfoCard
                key={r.id}
                address={r.listingData.address}
                startTime={r.start_time}
                endTime={r.end_time}
                totalPrice={r.total_price}
                photoUrl={r.listingData.photo_url}
                variant='past'
                width={screenWidth - H_PAD * 2}
              />
            ))}
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
    fontSize: screenWidth * 0.045,
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
    marginTop: SECTION_GAP,
  },
});
