/**
 * Activity — the renter's bookings (Figma 746:6). File name is kept as
 * PreviousReservations so the existing Profile entry point and route keep working.
 *
 *   Active     a booking in progress right now (live countdown badge)
 *   Scheduled  booked but not started yet (starts-in badge, cancel pill when the 24h window is open)
 *   Past       finished or cancelled bookings (compact rows)
 *
 * Tapping any card opens Activity Details.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import ActivityHeader from '@/src/components/activity/ActivityHeader';
import SectionTab from '@/src/components/activity/SectionTab';
import Entrance from '@/src/components/activity/Entrance';
import { ActiveBookingCard, CompactBookingRow } from '@/src/components/activity/BookingCards';
import { EmptyNote, ErrorNote, LoadingNote } from '@/src/components/activity/Notes';
import { useCancelBooking } from '@/src/components/activity/useCancelBooking';
import { openBookingDetails } from '@/src/components/activity/nav';
import { useNow } from '@/src/components/activity/useNow';
import { CARD_GAP, H_PAD, PAPER, SECTION_GAP, SW } from '@/src/components/activity/layout';
import {
  canCancelBooking,
  fetchRenterBookings,
  getCurrentUserId,
  groupBookings,
  type Booking,
} from '@/src/utils/activity';

export default function PreviousReservations() {
  const insets = useSafeAreaInsets();
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Phase boundaries (scheduled -> active -> past) re-evaluate on this tick.
  const now = useNow(15_000);

  const load = useCallback(async () => {
    try {
      const userId = await getCurrentUserId();
      if (!userId) {
        setBookings([]);
        return;
      }
      setBookings(await fetchRenterBookings(userId));
      setError(null);
    } catch (err) {
      console.warn('[Activity] load failed', err);
      setError('We couldn’t load your activity. Check your connection and try again.');
    }
  }, []);

  // Reload whenever the page regains focus (e.g. back from a cancellation on the details screen).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const { cancellingId, requestCancel } = useCancelBooking(() => {
    load();
  });

  const grouped = useMemo(() => groupBookings(bookings ?? [], now), [bookings, now]);
  const loading = bookings === null && error === null;
  let order = 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + SW * 0.06 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor='#000' />}
      >
        <Entrance index={order++}>
          <ActivityHeader title='Activity' />
        </Entrance>

        {error !== null && bookings === null ? (
          <ErrorNote message={error} onRetry={load} />
        ) : (
          <>
            <View style={styles.section}>
              <SectionTab label='Active' />
              {loading ? (
                <LoadingNote />
              ) : grouped.active.length === 0 ? (
                <EmptyNote text='Nothing in progress right now.' />
              ) : (
                grouped.active.map((b) => (
                  <Entrance key={b.id} index={order++}>
                    <ActiveBookingCard
                      now={now}
                      booking={b}
                      role='renter'
                      badge='remaining'
                      onPress={() => openBookingDetails(b.id)}
                    />
                  </Entrance>
                ))
              )}
            </View>

            {grouped.scheduled.length > 0 && (
              <View style={styles.section}>
                <SectionTab label='Scheduled' />
                {grouped.scheduled.map((b) => (
                  <Entrance key={b.id} index={order++}>
                    <ActiveBookingCard
                      now={now}
                      booking={b}
                      role='renter'
                      badge='starts'
                      onPress={() => openBookingDetails(b.id)}
                      onCancel={canCancelBooking(b, 'renter', now) ? () => requestCancel(b) : undefined}
                      cancelling={cancellingId === b.id}
                    />
                  </Entrance>
                ))}
              </View>
            )}

            <View style={styles.section}>
              <SectionTab label='Past' />
              {loading ? (
                <LoadingNote />
              ) : grouped.past.length === 0 ? (
                <EmptyNote text='You haven’t completed a reservation yet.' />
              ) : (
                grouped.past.map((b) => (
                  <Entrance key={b.id} index={order++}>
                    <CompactBookingRow
                      now={now}
                      booking={b}
                      role='renter'
                      onPress={() => openBookingDetails(b.id)}
                    />
                  </Entrance>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAPER },
  scroll: {
    paddingHorizontal: H_PAD,
    paddingTop: SW * 0.02,
    gap: SECTION_GAP,
  },
  section: { gap: CARD_GAP },
});
