/**
 * Edit Listing — opened by tapping a row in Seller Account → Manage Listings.
 *
 *   Rates          hourly / daily / weekly / monthly; blank = priced from the next tier
 *   Availability   available_from / available_until via the shared DateRangePicker
 *   Remove spot    same rules as the swipe-to-remove in ListingsSheet
 *
 * Out of scope for now: changing the address/pin or the photo (both need the
 * map + camera steps from CreateListing2).
 *
 * Writes go straight through the `listings_owner_update` RLS policy. Rate
 * changes never touch existing bookings — each reservation stores its own
 * total_price / platform_fee / host_payout from booking time.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { CustomFonts } from '@/src/constants/theme';
import ActivityHeader from '@/src/components/activity/ActivityHeader';
import SectionTab from '@/src/components/activity/SectionTab';
import PressableCard from '@/src/components/activity/PressableCard';
import { ListingThumb } from '@/src/components/activity/BookingCards';
import { ErrorNote, LoadingNote } from '@/src/components/activity/Notes';
import { CARD_GAP, CARD_W, H_PAD, HEADER_TOP_GAP, PAPER, SECTION_GAP, SW } from '@/src/components/activity/layout';
import DateRangePicker from '@/src/components/DateRangePicker';
import { hapticSuccess, hapticWarning } from '@/src/components/activity/motion';
import {
  fetchEditableListing,
  fetchListingBookings,
  getCurrentUserId,
  listingRemovalBlock,
  removeListingChecked,
  updateListing,
  type Booking,
  type EditableListing,
} from '@/src/utils/activity';
import {
  RATE_KEYS,
  RATE_LABELS,
  rateInputsFrom,
  validateRates,
  windowConflict,
  type RateInputs,
  type RateKey,
} from '@/src/utils/listingEdit';

const RATE_UNITS: Record<RateKey, string> = {
  hourly_rate: '/ hour',
  daily_rate: '/ day',
  weekly_rate: '/ week',
  monthly_rate: '/ month',
};

const fmtDate = (d: Date) =>
  d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function describeWindow(from: Date | null, until: Date | null): string {
  if (!from && !until) return 'Available any time';
  if (from && until) return `${fmtDate(from)} – ${fmtDate(until)}`;
  if (from) return `From ${fmtDate(from)}, no end date`;
  return `Until ${fmtDate(until as Date)}`;
}

const parseIso = (s: string | null) => (s ? new Date(s) : null);

export default function EditListing() {
  const insets = useSafeAreaInsets();
  const { listingId } = useLocalSearchParams<{ listingId: string }>();

  const [listing, setListing] = useState<EditableListing | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rates, setRates] = useState<RateInputs | null>(null);
  const [from, setFrom] = useState<Date | null>(null);
  const [until, setUntil] = useState<Date | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const userId = await getCurrentUserId();
      if (!userId || !listingId) {
        setError('You appear to be signed out. Please sign in again.');
        return;
      }
      const [l, b] = await Promise.all([
        fetchEditableListing(String(listingId), userId),
        fetchListingBookings(String(listingId)),
      ]);
      if (!l) {
        setError('We couldn’t find this listing. It may have been removed.');
        return;
      }
      setListing(l);
      setBookings(b);
      setRates(rateInputsFrom(l));
      setFrom(parseIso(l.available_from));
      setUntil(parseIso(l.available_until));
    } catch (err) {
      console.warn('[EditListing] load failed', err);
      setError('We couldn’t load this listing. Check your connection and try again.');
    }
  }, [listingId]);

  useEffect(() => {
    load();
  }, [load]);

  const removalBlock = useMemo(
    () => (listing ? listingRemovalBlock(listing.id, bookings, Date.now()) : null),
    [listing, bookings],
  );

  const save = async () => {
    if (!listing || !rates || saving) return;
    const checked = validateRates(rates);
    if (!checked.ok) {
      hapticWarning();
      Alert.alert('Check your rates', checked.message);
      return;
    }
    setSaving(true);
    try {
      const userId = await getCurrentUserId();
      if (!userId) throw new Error('You appear to be signed out. Please sign in again.');

      // Fresh rows, not the ones loaded when the screen opened: a booking may
      // have come in since.
      const fresh = await fetchListingBookings(listing.id);
      const clash = windowConflict(fresh, from, until, Date.now());
      if (clash) {
        hapticWarning();
        Alert.alert(
          'These dates leave out a booking',
          `Someone has booked this spot for ${fmtDate(clash.start)} – ${fmtDate(clash.end)}. ` +
            'Pick dates that still include every upcoming booking. ' +
            'Availability ends at the start of the end date you pick, so choose the day after the last booking.',
        );
        return;
      }

      const ok = await updateListing(listing.id, userId, {
        ...checked.update,
        available_from: from ? from.toISOString() : null,
        available_until: until ? until.toISOString() : null,
      });
      if (!ok) throw new Error('We couldn’t save your changes. Please try again.');
      hapticSuccess();
      Alert.alert('Saved', 'Your listing has been updated.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      hapticWarning();
      Alert.alert('Couldn’t save', err?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!listing || removing) return;
    if (removalBlock) {
      Alert.alert('This spot can’t be removed yet', removalBlock);
      return;
    }
    hapticWarning();
    Alert.alert(
      'Remove this spot?',
      `${listing.address} will stop showing up on the marketplace. You can list it again later by creating a new listing.`,
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemoving(true);
            const result = await removeListingChecked(listing.id);
            setRemoving(false);
            if (result.ok) {
              hapticSuccess();
              router.back();
            } else {
              hapticWarning();
              Alert.alert('Could not remove this spot', result.message);
            }
          },
        },
      ],
    );
  };

  let body: React.ReactNode;
  if (error) body = <ErrorNote message={error} onRetry={load} />;
  else if (!listing || !rates) body = <LoadingNote />;
  else {
    body = (
      <>
        <View style={styles.spotCard}>
          <ListingThumb uri={listing.photo_url} size={SW * 0.14} radius={SW * 0.07} />
          <View style={{ flex: 1 }}>
            <Text style={styles.address} numberOfLines={2}>
              {listing.address}
            </Text>
            <Text style={styles.muted}>The address and photo can’t be changed yet.</Text>
          </View>
        </View>

        <View style={styles.section}>
          <SectionTab label='Rates' />
          {/* Not "blank = not offered": pricing falls back across tiers, so a
              blank hourly rate still allows short stays, priced from the next
              rate you set (e.g. daily ÷ 24). */}
          <Text style={styles.help}>
            Leave a rate blank to skip it — shorter stays are then priced from your next rate (e.g. daily ÷ 24 per hour).
          </Text>
          {RATE_KEYS.map((k) => (
            <View key={k} style={styles.rateRow}>
              <Text style={styles.rateLabel}>{RATE_LABELS[k]}</Text>
              <View style={styles.rateField}>
                <Text style={styles.dollar}>$</Text>
                <TextInput
                  style={styles.rateInput}
                  value={rates[k]}
                  onChangeText={(t) => setRates((r) => (r ? { ...r, [k]: t } : r))}
                  placeholder='Not offered'
                  placeholderTextColor='rgba(0,0,0,0.35)'
                  keyboardType='decimal-pad'
                  returnKeyType='done'
                  accessibilityLabel={`${RATE_LABELS[k]} rate in dollars`}
                />
                <Text style={styles.unit}>{RATE_UNITS[k]}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <SectionTab label='Availability' />
          <Text style={styles.windowText}>{describeWindow(from, until)}</Text>
          <View style={styles.windowButtons}>
            <PressableCard
              onPress={() => setPickerOpen(true)}
              style={styles.secondaryBtn}
              accessibilityLabel='Change available dates'
            >
              <Text style={styles.secondaryText}>Change dates</Text>
            </PressableCard>
            {(from || until) && (
              <PressableCard
                onPress={() => {
                  setFrom(null);
                  setUntil(null);
                }}
                style={styles.secondaryBtn}
                accessibilityLabel='Make available any time'
              >
                <Text style={styles.secondaryText}>Any time</Text>
              </PressableCard>
            )}
          </View>
        </View>

        <PressableCard
          onPress={save}
          disabled={saving}
          style={styles.primaryBtn}
          accessibilityLabel='Save changes'
        >
          {saving ? <ActivityIndicator color='#fff' /> : <Text style={styles.primaryText}>Save changes</Text>}
        </PressableCard>

        <View style={styles.removeBox}>
          <PressableCard
            onPress={remove}
            disabled={removing}
            style={[styles.removeBtn, removalBlock ? styles.removeBtnLocked : null]}
            accessibilityLabel={removalBlock ? `Remove spot. Unavailable: ${removalBlock}` : 'Remove spot'}
          >
            {removing ? (
              <ActivityIndicator color='#7A1F1F' />
            ) : (
              <Text style={[styles.removeText, removalBlock ? styles.removeTextLocked : null]}>
                Remove spot
              </Text>
            )}
          </PressableCard>
          {removalBlock && <Text style={styles.muted}>{removalBlock}</Text>}
        </View>
      </>
    );
  }

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + SW * 0.1 }]}
            keyboardShouldPersistTaps='handled'
            showsVerticalScrollIndicator={false}
          >
            <ActivityHeader title='Edit Listing' />
            {body}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <DateRangePicker
        visible={pickerOpen}
        initialStart={from}
        initialEnd={until}
        helperText='When can renters book this spot?'
        confirmLabel='Use these dates'
        onClose={() => setPickerOpen(false)}
        onConfirm={(start, end) => {
          setFrom(start);
          setUntil(end);
          setPickerOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAPER },
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: H_PAD,
    paddingTop: HEADER_TOP_GAP,
    gap: SECTION_GAP,
  },
  section: { gap: CARD_GAP },
  spotCard: {
    width: CARD_W,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SW * 0.035,
    padding: SW * 0.04,
    borderRadius: SW * 0.06,
    borderWidth: 2,
    borderColor: '#000',
  },
  address: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: SW * 0.042,
    color: '#000',
  },
  muted: {
    marginTop: SW * 0.01,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: SW * 0.033,
    color: 'rgba(0,0,0,0.6)',
  },
  help: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: SW * 0.035,
    color: 'rgba(0,0,0,0.65)',
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rateLabel: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: SW * 0.042,
    color: '#000',
  },
  rateField: {
    width: CARD_W * 0.62,
    height: SW * 0.12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SW * 0.04,
    borderRadius: 999,
    backgroundColor: '#fff',
  },
  dollar: { fontFamily: CustomFonts.BevellierMedium, fontSize: SW * 0.045, color: '#000' },
  rateInput: {
    flex: 1,
    marginLeft: SW * 0.01,
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: SW * 0.045,
    color: '#000',
  },
  unit: { fontFamily: CustomFonts.SwitzerLight, fontSize: SW * 0.033, color: 'rgba(0,0,0,0.6)' },
  windowText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: SW * 0.042,
    color: '#000',
  },
  windowButtons: { flexDirection: 'row', gap: SW * 0.03 },
  secondaryBtn: {
    height: SW * 0.11,
    paddingHorizontal: SW * 0.06,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { fontFamily: CustomFonts.SwitzerSemibold, fontSize: SW * 0.037, color: '#000' },
  primaryBtn: {
    height: SW * 0.14,
    borderRadius: 999,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontFamily: CustomFonts.SwitzerSemibold, fontSize: SW * 0.045, color: '#fff' },
  removeBox: { alignItems: 'center', gap: SW * 0.02 },
  removeBtn: {
    height: SW * 0.12,
    paddingHorizontal: SW * 0.08,
    borderRadius: 999,
    backgroundColor: '#FCAFAF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtnLocked: { backgroundColor: 'rgba(0,0,0,0.08)' },
  removeText: { fontFamily: CustomFonts.SwitzerSemibold, fontSize: SW * 0.04, color: '#7A1F1F' },
  removeTextLocked: { color: 'rgba(0,0,0,0.45)' },
});
