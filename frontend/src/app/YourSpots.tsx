/**
 * Seller Account — the host's page (Figma 786:2 / 787:39 / 787:122). File name is
 * kept as YourSpots so the existing Profile entry point and route keep working.
 *
 *   Stat cards   Payouts Remaining + Lifetime Earnings (per-month breakdown),
 *                both derived from the host's reservations and their payout state
 *   Active       a booking of one of your spots happening now (live countdown)
 *   Scheduled    upcoming bookings of your spots
 *   Past         finished / cancelled bookings (compact rows)
 *   Manage Listings -> dark sheet; swipe a listing left to remove it
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { CustomFonts } from '@/src/constants/theme';
import ActivityHeader from '@/src/components/activity/ActivityHeader';
import SectionTab from '@/src/components/activity/SectionTab';
import Entrance from '@/src/components/activity/Entrance';
import { ActiveBookingCard, CompactBookingRow } from '@/src/components/activity/BookingCards';
import { EmptyNote, ErrorNote, LoadingNote } from '@/src/components/activity/Notes';
import { openBookingDetails } from '@/src/components/activity/nav';
import { useNow } from '@/src/components/activity/useNow';
import { CARD_GAP, H_PAD, PAPER, SECTION_GAP, SW } from '@/src/components/activity/layout';
import StatCards from '@/src/components/seller/StatCards';
import PayoutSheet from '@/src/components/seller/PayoutSheet';
import ListingsSheet, { type RemoveResult } from '@/src/components/seller/ListingsSheet';
import {
  computeEarnings,
  deactivateListing,
  fetchHostDashboard,
  fetchListingBookings,
  fetchPayoutsEnabled,
  getChatTarget,
  getCurrentUserId,
  groupBookings,
  listingRemovalBlock,
  type Booking,
  type BookingListing,
  type HostDashboard,
} from '@/src/utils/activity';

export default function YourSpots() {
  const insets = useSafeAreaInsets();
  const [dash, setDash] = useState<HostDashboard | null>(null);
  const [payoutsEnabled, setPayoutsEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [listingsOpen, setListingsOpen] = useState(false);
  const [payoutsOpen, setPayoutsOpen] = useState(false);
  const now = useNow(15_000);

  const load = useCallback(async () => {
    try {
      const userId = await getCurrentUserId();
      if (!userId) {
        setDash({ listings: [], bookings: [] });
        return;
      }
      const [dashboard, enabled] = await Promise.all([
        fetchHostDashboard(userId),
        fetchPayoutsEnabled(userId),
      ]);
      setDash(dashboard);
      setPayoutsEnabled(enabled);
      setError(null);
    } catch (err) {
      console.warn('[SellerAccount] load failed', err);
      setError('We couldn’t load your seller account. Check your connection and try again.');
    }
  }, []);

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

  const bookings = dash?.bookings;
  const earnings = useMemo(() => (bookings ? computeEarnings(bookings, now) : null), [bookings, now]);
  const grouped = useMemo(() => groupBookings(bookings ?? [], now), [bookings, now]);

  const messageRenter = useCallback(async (b: Booking) => {
    try {
      const target = await getChatTarget(b, 'host');
      router.push({ pathname: '/Chat', params: target } as any);
    } catch (err: any) {
      Alert.alert('Could not open chat', err?.message ?? 'Please try again.');
    }
  }, []);

  const removeListing = useCallback(async (listing: BookingListing): Promise<RemoveResult> => {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { ok: false, message: 'You appear to be signed out. Please sign in again.' };
      // Re-check against fresh rows: the on-screen list may be stale.
      const fresh = await fetchListingBookings(listing.id);
      const reason = listingRemovalBlock(listing.id, fresh, Date.now());
      if (reason) return { ok: false, message: reason };
      const done = await deactivateListing(listing.id, userId);
      if (!done) return { ok: false, message: 'We couldn’t remove this listing. Please try again.' };
      return { ok: true };
    } catch (err: any) {
      return { ok: false, message: err?.message ?? 'Something went wrong. Please try again.' };
    }
  }, []);

  const onRemoved = useCallback((listingId: string) => {
    setDash((prev) =>
      prev && {
        listings: prev.listings.filter((l) => l.id !== listingId),
        bookings: prev.bookings.filter((b) => b.listingId !== listingId),
      },
    );
  }, []);

  const loading = dash === null && error === null;
  const noListings = dash !== null && dash.listings.length === 0;
  let order = 0;

  return (
    <View style={styles.root}>
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
            <ActivityHeader title='Seller Account' />
          </Entrance>

          {error !== null && dash === null ? (
            <ErrorNote message={error} onRetry={load} />
          ) : (
            <>
              <Entrance index={order++}>
                <StatCards
                  earnings={earnings}
                  hasListings={!noListings}
                  onPayoutsPress={() => setPayoutsOpen(true)}
                  onManagePress={() => setListingsOpen(true)}
                />
              </Entrance>

              <View style={styles.section}>
                <SectionTab label='Active' />
                {loading ? (
                  <LoadingNote />
                ) : grouped.active.length === 0 ? (
                  <EmptyNote
                    text={
                      noListings
                        ? 'You haven’t posted any listings yet. Tap + to list your first spot.'
                        : 'No active bookings on your spots.'
                    }
                  />
                ) : (
                  grouped.active.map((b) => (
                    <Entrance key={b.id} index={order++}>
                      <ActiveBookingCard
                        now={now}
                        booking={b}
                        role='host'
                        badge='remaining'
                        onPress={() => openBookingDetails(b.id)}
                        onMessage={() => messageRenter(b)}
                      />
                    </Entrance>
                  ))
                )}
              </View>

              <View style={styles.section}>
                <SectionTab label='Scheduled' />
                {loading ? (
                  <LoadingNote />
                ) : grouped.scheduled.length === 0 ? (
                  <EmptyNote text='No upcoming bookings yet.' />
                ) : (
                  grouped.scheduled.map((b) => (
                    <Entrance key={b.id} index={order++}>
                      <ActiveBookingCard
                        now={now}
                        booking={b}
                        role='host'
                        badge='starts'
                        onPress={() => openBookingDetails(b.id)}
                        onMessage={() => messageRenter(b)}
                      />
                    </Entrance>
                  ))
                )}
              </View>

              <View style={styles.section}>
                <SectionTab label='Past' />
                {loading ? (
                  <LoadingNote />
                ) : grouped.past.length === 0 ? (
                  <EmptyNote text='Finished bookings will show up here.' />
                ) : (
                  grouped.past.map((b) => (
                    <Entrance key={b.id} index={order++}>
                      <CompactBookingRow
                        now={now}
                        booking={b}
                        role='host'
                        onPress={() => openBookingDetails(b.id)}
                      />
                    </Entrance>
                  ))
                )}
              </View>

              {dash !== null && (
                <Text style={styles.footnote}>
                  Amounts are your payout. SpotOn’s service fee is paid by the renter on top of your rate.
                </Text>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      <ListingsSheet
        visible={listingsOpen}
        onClose={() => setListingsOpen(false)}
        listings={dash?.listings ?? []}
        bookings={dash?.bookings ?? []}
        now={now}
        onRemove={removeListing}
        onRemoved={onRemoved}
      />
      <PayoutSheet
        visible={payoutsOpen}
        onClose={() => setPayoutsOpen(false)}
        remaining={earnings?.remaining ?? 0}
        payoutsEnabled={payoutsEnabled}
        onSetupReturned={load}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAPER },
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: H_PAD,
    paddingTop: SW * 0.02,
    gap: SECTION_GAP,
  },
  section: { gap: CARD_GAP },
  footnote: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: SW * 0.032,
    color: 'rgba(0,0,0,0.55)',
    textAlign: 'center',
    paddingHorizontal: SW * 0.04,
  },
});
