/**
 * UpcomingReservationBanner — Figma 707:3
 *
 * Home-screen pill shown when the signed-in renter has an upcoming
 * (not-yet-started) reservation. Tapping the body opens Your Reservations;
 * tapping the yellow arrow opens the spot's address in the device maps app.
 */
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Image, Dimensions, Linking, Platform } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { CustomFonts } from '@/src/constants/theme';
import { supabase } from '@/src/utils/supabase';
import { api, type ActiveReservation } from '@/src/utils/api';
import { type TimerData, formatRemaining } from '@/src/utils/timeFormat';
import { withLightHaptic } from '@/src/utils/haptics';
import { BANNER_SIDE_MARGIN, BANNER_RADIUS, BANNER_HEIGHT, BANNER_H_PAD } from './bannerStyle';

import arrowInsert from '@/assets/images/homescreen/arrow_insert.png';

// Sized to match the Payout/TooFar banner family so all three Homescreen
// pills render at identical height/thickness and corner curvature.
const { width: screenWidth } = Dimensions.get('window');
const SIDE_MARGIN = BANNER_SIDE_MARGIN;
const RADIUS = BANNER_RADIUS;
const H_PAD = BANNER_H_PAD;
const ARROW_SIZE = screenWidth * 0.1;

function openMaps(address: string) {
  const encoded = encodeURIComponent(address);
  const url = Platform.select({
    ios: `maps://maps.apple.com/?q=${encoded}`,
    android: `geo:0,0?q=${encoded}`,
    default: `https://www.google.com/maps/search/?api=1&query=${encoded}`,
  })!;
  Linking.openURL(url);
}

function timerSegments(timer: TimerData): { value: number; unit: string }[] {
  switch (timer.mode) {
    case 'months': return [{ value: timer.months, unit: 'mnth' }];
    case 'weeks':  return [{ value: timer.weeks,  unit: 'wks' }];
    case 'days':   return [{ value: timer.days,  unit: 'd' }, { value: timer.hours, unit: 'h' }];
    case 'hours':  return [{ value: timer.hours, unit: 'h' }, { value: timer.mins,  unit: 'm' }];
    case 'mins':   return [{ value: timer.mins,  unit: 'm' }, { value: timer.secs,  unit: 's' }];
  }
}

export default function UpcomingReservationBanner() {
  const router = useRouter();
  const [reservation, setReservation] = useState<ActiveReservation | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setReservation(null);
      return;
    }
    const upcoming = await api.getUpcomingReservation(user.id);
    setReservation(upcoming);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Tick every second so the countdown stays accurate and the banner hides
  // itself the moment start_time arrives, without needing a refocus.
  useEffect(() => {
    if (!reservation) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [reservation]);

  const remainingMs = reservation ? reservation.start_time.getTime() - now : 0;
  if (!reservation || remainingMs <= 0) return null;

  const address = reservation.listingData.address;
  const segments = timerSegments(formatRemaining(remainingMs));

  return (
    <View style={{ marginHorizontal: SIDE_MARGIN, marginBottom: screenWidth * 0.05 }}>
      <TouchableOpacity
        style={styles.container}
        activeOpacity={0.85}
        onPress={withLightHaptic(() => router.push('/PreviousReservations'))}
      >
        <View style={styles.textCol}>
          <Text style={styles.label}>Reservation in</Text>
          <View style={styles.timerRow}>
            {segments.map((seg, i) => (
              <View key={i} style={[styles.segment, i > 0 && { marginLeft: 8 }]}>
                <Text style={styles.timerNumber}>{seg.value}</Text>
                <Text style={styles.timerUnit}>{seg.unit}</Text>
              </View>
            ))}
          </View>
        </View>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={withLightHaptic((e: any) => {
            e?.stopPropagation?.();
            openMaps(address);
          })}
          style={[styles.arrowCircle, { width: ARROW_SIZE, height: ARROW_SIZE, borderRadius: ARROW_SIZE / 2 }]}
        >
          <Image source={arrowInsert} style={{ width: ARROW_SIZE * 0.42, height: ARROW_SIZE * 0.42 }} resizeMode="contain" />
        </TouchableOpacity>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F4F4F4',
    borderRadius: RADIUS,
    minHeight: BANNER_HEIGHT,
    paddingHorizontal: H_PAD,
    paddingVertical: screenWidth * 0.03,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  textCol: {
    flexShrink: 1,
    alignItems: 'flex-start',
    paddingRight: 12,
  },
  label: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: screenWidth * 0.034,
    color: '#000000',
    textTransform: 'lowercase',
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: screenWidth * 0.008,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  timerNumber: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: screenWidth * 0.06,
    color: '#000000',
  },
  timerUnit: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.03,
    color: 'rgba(0,0,0,0.6)',
    marginLeft: 2,
  },
  arrowCircle: {
    backgroundColor: '#FFFF1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
