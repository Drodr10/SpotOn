/**
 * Activity Details (Figma 746:68) — opened by tapping any card on Activity
 * (renter) or Seller Account (host). The viewer's role is derived from the
 * reservation itself (renter_id === signed-in user), never from a parameter.
 *
 * Card: map of the spot with a live status badge, address, date/time, vehicle,
 * and a black price-breakdown card. Secondary actions (message, cancel under the
 * renter 24h rule, report an issue, report listing) live in the title pill's dropdown.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';

import { CustomFonts } from '@/src/constants/theme';
import { MENU_BAR_HEIGHT } from '@/src/components/MenuBar';
import { PillMenuBackdrop, type PillMenuItem } from '@/src/components/PillMenu';
import ReportSheet, { type ReportTarget } from '@/src/components/ReportSheet';
import ActivityHeader, { goBack } from '@/src/components/activity/ActivityHeader';
import Entrance from '@/src/components/activity/Entrance';
import PressableCard from '@/src/components/activity/PressableCard';
import { LiveLabel } from '@/src/components/activity/RollingText';
import { ErrorNote, LoadingNote } from '@/src/components/activity/Notes';
import { useCancelBooking } from '@/src/components/activity/useCancelBooking';
import { useNow } from '@/src/components/activity/useNow';
import { CARD_GAP, CARD_W, H_PAD, PAPER, SECTION_GAP, SW } from '@/src/components/activity/layout';
import {
  bookingAddress,
  bookingPhase,
  canCancelBooking,
  CANCELLATION_WINDOW_HOURS,
  feePercent,
  fetchBookingById,
  fetchBookingVehicle,
  formatBookingRange,
  formatCountdown,
  formatStartsIn,
  formatVehicle,
  getChatTarget,
  getCurrentUserId,
  inferRateLabel,
  money,
  openInMaps,
  openIssueEmail,
  type Booking,
  type BookingRole,
  type VehicleSummary,
} from '@/src/utils/activity';

import auraGradient from '@/assets/images/profilePage/aura_gradient.png';

const P = CARD_W * 0.04;
const RADIUS = CARD_W * 0.12;
const BORDER = Math.max(2, CARD_W * 0.008);
const MAP_H = CARD_W * 0.64;

const PAYOUT_NOTE: Record<string, string> = {
  held: 'Paid out to you after the booking ends.',
  payout_ready: 'Finished. Set up payouts to receive this.',
  paid_out: 'Paid out to your account.',
  refunded: 'Cancelled and refunded. No payout.',
  refunding: 'Cancelled and refunding. No payout.',
};

export default function ActivityDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const now = useNow(15_000);

  const [booking, setBooking] = useState<Booking | null>(null);
  const [role, setRole] = useState<BookingRole>('renter');
  const [vehicle, setVehicle] = useState<VehicleSummary | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setState('missing');
      return;
    }
    try {
      const [b, userId] = await Promise.all([fetchBookingById(String(id)), getCurrentUserId()]);
      if (!b || !userId) {
        setState('missing');
        return;
      }
      const r: BookingRole = b.renterId === userId ? 'renter' : 'host';
      setBooking(b);
      setRole(r);
      setState('ready');
      setVehicle(await fetchBookingVehicle(b, r));
    } catch (err) {
      console.warn('[ActivityDetails] load failed', err);
      setState((s) => (s === 'ready' ? s : 'error'));
    }
  }, [id]);

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

  const messageOther = useCallback(async () => {
    if (!booking || messaging) return;
    setMessaging(true);
    try {
      const target = await getChatTarget(booking, role);
      router.push({ pathname: '/Chat', params: target } as any);
    } catch (err: any) {
      Alert.alert('Could not open chat', err?.message ?? 'Please try again.');
    } finally {
      setMessaging(false);
    }
  }, [booking, role, messaging]);

  const openReport = useCallback(() => {
    if (!booking) return;
    setReportTarget({
      kind: 'listing',
      listingId: booking.listingId,
      listingTitle: bookingAddress(booking),
    } as ReportTarget);
    setReportOpen(true);
  }, [booking]);

  const phase = booking ? bookingPhase(booking, now) : 'hidden';
  const cancelable = booking ? canCancelBooking(booking, role, now) : false;
  const showWindowNote =
    !!booking &&
    role === 'renter' &&
    phase === 'scheduled' &&
    booking.payoutStatus === 'held' &&
    !cancelable;

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const toggleMenu = useCallback(() => setMenuOpen((o) => !o), []);

  const menuItems = useMemo<PillMenuItem[]>(() => {
    if (state !== 'ready' || !booking) return [];
    const items: PillMenuItem[] = [
      {
        key: 'message',
        label: role === 'renter' ? 'Message host' : 'Message renter',
        icon: 'chatbubble-ellipses-outline',
        busy: messaging,
        onPress: messageOther,
      },
    ];
    if (cancelable) {
      items.push({
        key: 'cancel',
        label: 'Cancel booking',
        icon: 'close-circle-outline',
        busy: cancellingId === booking.id,
        onPress: () => requestCancel(booking),
      });
    } else if (showWindowNote) {
      items.push({
        key: 'cancel',
        label: 'Cancel booking',
        icon: 'close-circle-outline',
        disabled: true,
        subtitle: `Only up to ${CANCELLATION_WINDOW_HOURS} hours before the start`,
        onPress: () => {},
      });
    }
    items.push({
      key: 'issue',
      label: 'Report an issue',
      icon: 'mail-outline',
      onPress: () => openIssueEmail(booking),
    });
    if (role === 'renter') {
      items.push({
        key: 'report',
        label: 'Report listing',
        icon: 'flag-outline',
        destructive: true,
        onPress: openReport,
      });
    }
    return items;
  }, [
    state,
    booking,
    role,
    messaging,
    messageOther,
    cancelable,
    showWindowNote,
    cancellingId,
    requestCancel,
    openReport,
  ]);

  const body = useMemo(() => {
    if (state === 'loading') return <LoadingNote />;
    if (state === 'error') return <ErrorNote message='We couldn’t load this booking.' onRetry={load} />;
    if (state === 'missing' || !booking) {
      return <ErrorNote message='This booking isn’t available.' onRetry={goBack} />;
    }
    return null;
  }, [state, booking, load]);

  let order = 0;

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: MENU_BAR_HEIGHT + insets.bottom + SW * 0.12 },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor='#000' />}
        >
          {menuOpen && <PillMenuBackdrop onPress={closeMenu} />}
          <Entrance index={order++} style={styles.headerWrap}>
            <ActivityHeader
              title='Activity Details'
              menu={
                menuItems.length > 0
                  ? { open: menuOpen, onToggle: toggleMenu, onClose: closeMenu, items: menuItems }
                  : undefined
              }
            />
          </Entrance>

          {body}

          {state === 'ready' && booking && (
            <>
              <Entrance index={order++}>
                <View style={styles.card}>
                  <SpotMap booking={booking} phase={phase} role={role} />

                  <Text style={styles.address} numberOfLines={2}>
                    {bookingAddress(booking)}
                  </Text>
                  <Text style={styles.date}>{formatBookingRange(booking.start, booking.end)}</Text>
                  {vehicle ? (
                    <Text style={styles.date}>
                      {role === 'renter' ? 'Used ' : 'Vehicle: '}
                      {formatVehicle(vehicle, role === 'host')}
                    </Text>
                  ) : role === 'host' && phase !== 'active' ? (
                    <Text style={styles.dateMuted}>Vehicle details are shared while the booking is in progress.</Text>
                  ) : null}

                  <Breakdown booking={booking} role={role} />
                </View>
              </Entrance>
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      <ReportSheet
        visible={reportOpen}
        target={reportTarget}
        onClose={() => setReportOpen(false)}
      />
    </View>
  );
}

// ─── Map + badge ─────────────────────────────────────────────────────────────

function SpotMap({
  booking,
  phase,
  role,
}: {
  booking: Booking;
  phase: ReturnType<typeof bookingPhase>;
  role: BookingRole;
}) {
  const l = booking.listing;
  const hasCoords = l?.latitude != null && l?.longitude != null;
  const region = hasCoords
    ? {
        latitude: l!.latitude as number,
        longitude: l!.longitude as number,
        latitudeDelta: 0.006,
        longitudeDelta: 0.006,
      }
    : null;

  // Native map views mount on first frame; deferring one tick keeps the card entrance smooth.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={styles.mapBox}>
      {region && ready ? (
        <MapView
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
          liteMode={Platform.OS === 'android'}
          pointerEvents='none'
        >
          <Marker coordinate={region} pinColor='#000000' />
        </MapView>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.mapFallback]}>
          {region ? (
            <ActivityIndicator color='rgba(0,0,0,0.4)' />
          ) : (
            <>
              <Ionicons name='map-outline' size={MAP_H * 0.25} color='rgba(0,0,0,0.35)' />
              <Text style={styles.dateMuted}>Map unavailable for this listing</Text>
            </>
          )}
        </View>
      )}

      <View style={styles.badge}>
        {phase === 'active' ? (
          <LiveLabel
            style={styles.badgeText}
            getLabel={(t) => formatCountdown(booking.end.getTime() - t, role === 'host')}
          />
        ) : phase === 'scheduled' ? (
          <LiveLabel
            style={styles.badgeText}
            getLabel={(t) => `Starts ${formatStartsIn(booking.start.getTime() - t)}`}
          />
        ) : (
          <Text style={styles.badgeText}>{phase === 'cancelled' ? 'Cancelled' : 'Completed'}</Text>
        )}
      </View>

      {hasCoords && (
        <PressableCard
          onPress={() => openInMaps(bookingAddress(booking))}
          hitSlop={6}
          accessibilityLabel='Open in Maps'
          style={styles.navBtn}
        >
          <ImageBackground
            source={auraGradient}
            style={styles.navBtnFill}
            imageStyle={{ borderRadius: CARD_W * 0.05 }}
            resizeMode='cover'
          >
            <Ionicons name='navigate' size={CARD_W * 0.055} color='#000' />
          </ImageBackground>
        </PressableCard>
      )}
    </View>
  );
}

// ─── Price breakdown ─────────────────────────────────────────────────────────

function Breakdown({ booking, role }: { booking: Booking; role: BookingRole }) {
  const pct = feePercent(booking);
  const hasSplit = booking.hostPayout > 0 && booking.platformFee > 0;
  const cancelled = booking.status === 'cancelled';
  const feeLabel = pct != null ? `SpotOn fee (${pct}%)` : 'SpotOn fee';

  return (
    <View style={styles.breakdown}>
      <Text style={styles.rateType}>{inferRateLabel(booking)}</Text>

      {role === 'renter' ? (
        <>
          {hasSplit && (
            <>
              <BreakdownRow label='Parking' value={money(booking.hostPayout)} />
              <BreakdownRow label={feeLabel} value={`+${money(booking.platformFee)}`} />
              <View style={styles.divider} />
            </>
          )}
          <BreakdownRow label={cancelled ? 'Refunded' : 'Total'} value={money(booking.totalPrice)} strong />
        </>
      ) : (
        <>
          {hasSplit && (
            <>
              <BreakdownRow label='Renter paid' value={money(booking.totalPrice)} />
              <BreakdownRow label={feeLabel} value={`-${money(booking.platformFee)}`} />
              <View style={styles.divider} />
            </>
          )}
          <BreakdownRow label='You earn' value={money(booking.hostPayout)} strong />
          {PAYOUT_NOTE[booking.payoutStatus] ? (
            <Text style={styles.payoutNote}>{PAYOUT_NOTE[booking.payoutStatus]}</Text>
          ) : null}
        </>
      )}
    </View>
  );
}

function BreakdownRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.bRow}>
      <Text style={[styles.bLabel, strong && styles.bLabelStrong]}>{label}</Text>
      <Text style={[styles.bValue, strong && styles.bValueStrong]}>{value}</Text>
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
  card: {
    width: CARD_W,
    padding: P,
    borderRadius: RADIUS,
    borderWidth: BORDER,
    borderColor: '#000',
    overflow: 'hidden',
  },
  mapBox: {
    height: MAP_H,
    borderRadius: RADIUS * 0.8,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  mapFallback: { alignItems: 'center', justifyContent: 'center', gap: CARD_GAP },
  badge: {
    position: 'absolute',
    top: MAP_H * 0.06,
    right: 0,
    height: CARD_W * 0.085,
    paddingLeft: CARD_W * 0.05,
    paddingRight: CARD_W * 0.05,
    backgroundColor: '#fff',
    borderTopLeftRadius: 999,
    borderBottomLeftRadius: 999,
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: CARD_W * 0.046,
    color: '#000',
  },
  navBtn: {
    position: 'absolute',
    right: CARD_W * 0.03,
    bottom: CARD_W * 0.03,
    width: CARD_W * 0.1,
    height: CARD_W * 0.1,
    borderRadius: CARD_W * 0.05,
    overflow: 'hidden',
  },
  navBtnFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  address: {
    marginTop: CARD_W * 0.04,
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: CARD_W * 0.054,
    color: '#000',
  },
  date: {
    marginTop: CARD_W * 0.015,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: CARD_W * 0.038,
    color: '#000',
  },
  dateMuted: {
    marginTop: CARD_W * 0.015,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: CARD_W * 0.034,
    color: 'rgba(0,0,0,0.55)',
  },
  breakdown: {
    marginTop: CARD_W * 0.045,
    backgroundColor: '#000',
    borderRadius: RADIUS * 0.7,
    padding: CARD_W * 0.05,
    gap: CARD_W * 0.025,
  },
  rateType: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: CARD_W * 0.058,
    color: '#fff',
    marginBottom: CARD_W * 0.01,
  },
  bRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  bLabel: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: CARD_W * 0.038,
    color: 'rgba(255,255,255,0.8)',
  },
  bLabelStrong: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: CARD_W * 0.046,
    color: '#fff',
  },
  bValue: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: CARD_W * 0.04,
    color: '#fff',
  },
  bValueStrong: { fontSize: CARD_W * 0.06 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.28)' },
  payoutNote: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: CARD_W * 0.034,
    color: 'rgba(255,255,255,0.6)',
    marginTop: CARD_W * 0.005,
  },
  headerWrap: { zIndex: 20 },
});
