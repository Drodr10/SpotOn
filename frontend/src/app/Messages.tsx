/**
 * Messages — conversation list (Figma 724:4 "Messaging v2").
 *
 * Layout mirrors the Profile page: a dark title pill in the top-left ("Messages")
 * using the exact same pill size + lettering. Conversations tied to a reservation
 * that is scheduled or currently in progress are grouped inside a black-outlined
 * container with a live status line; past meetings sit underneath as standalone
 * bubbles. Each row shows the other participant's own profile picture. The global
 * floating MenuBar (rendered in _layout) stays at the bottom.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { supabase } from '../utils/supabase';
import { CustomFonts } from '@/src/constants/theme';
import { withLightHaptic } from '@/src/utils/haptics';
import { MENU_BAR_HEIGHT } from '@/src/components/MenuBar';

import defaultAvatar from '@/assets/images/temprofileicon.png';

const { width: screenWidth } = Dimensions.get('window');

const H_PAD = screenWidth * 0.05;
const HEADER_BTN_HEIGHT = screenWidth * 0.12;
const ACTIVE_AVATAR = screenWidth * 0.125;
const PAST_AVATAR = screenWidth * 0.12;

interface ReservationInfo {
  start: Date;
  end: Date;
  status: string | null;
}

interface Conversation {
  id: string;
  renter_id: string;
  owner_id: string;
  last_message: string | null;
  updated_at: string;
  otherUserName: string;
  otherUserId: string;
  otherAvatarUrl: string | null;
  reservation: ReservationInfo | null;
  category: 'active' | 'past';
}

// Compact "time remaining" string — mirrors the Figma "21min 45s" treatment.
function formatRemaining(end: Date): string {
  const diff = end.getTime() - Date.now();
  if (diff <= 0) return 'Ended';
  const totalSec = Math.floor(diff / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min ${s}s`;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatStart(d: Date): string {
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Live-ticking countdown used by in-progress rows. */
function LiveStatus({ end }: { end: Date }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <Text style={styles.subtitle}>{formatRemaining(end)}</Text>;
}

function statusLine(conv: Conversation) {
  const now = Date.now();
  if (conv.category === 'active' && conv.reservation) {
    const { start, end } = conv.reservation;
    if (start.getTime() <= now && now < end.getTime()) {
      // Currently in progress → live countdown of time remaining.
      return <LiveStatus end={end} />;
    }
    // Scheduled but not yet started.
    return <Text style={styles.subtitle}>Reservation starting {formatStart(start)}</Text>;
  }
  const when = conv.reservation ? conv.reservation.start : new Date(conv.updated_at);
  return <Text style={styles.subtitle}>Booking Confirmed {formatDate(when)}</Text>;
}

/** Pick the more relevant of two active reservations for the same person:
 *  an in-progress one outranks an upcoming one; ties break on soonest end. */
function moreRelevant(a: ReservationInfo, b: ReservationInfo, now: number): ReservationInfo {
  const aStarted = a.start.getTime() <= now;
  const bStarted = b.start.getTime() <= now;
  if (aStarted !== bStarted) return aStarted ? a : b;
  return a.end.getTime() <= b.end.getTime() ? a : b;
}

export default function MessagesScreen() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      const { data: claims } = await supabase.auth.getClaims();
      if (!claims) {
        if (mounted.current) setLoading(false);
        return;
      }
      const userId = claims.claims.sub;

      const { data: convData, error } = await supabase
        .from('conversations')
        .select('id, renter_id, owner_id, last_message, updated_at')
        .or(`renter_id.eq.${userId},owner_id.eq.${userId}`)
        .order('updated_at', { ascending: false });

      if (error || !convData || convData.length === 0) {
        if (mounted.current) setLoading(false);
        return;
      }

      // Other participants → profile (name + their own avatar).
      const otherIds = [
        ...new Set(
          convData.map((c: any) => (c.renter_id === userId ? c.owner_id : c.renter_id)),
        ),
      ];
      const { data: profileData } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', otherIds);
      const profileMap: Record<string, { name: string; avatar: string | null }> =
        Object.fromEntries(
          (profileData ?? []).map((p: any) => [
            p.id,
            { name: p.full_name, avatar: p.avatar_url ?? null },
          ]),
        );

      // A conversation belongs in the scheduled/in-progress container when the
      // user has a reservation with the OTHER participant that hasn't ended yet.
      // Conversations aren't reliably linked to a reservation row, so we match
      // on the (renter, owner) relationship instead:
      //   • reservations I made (renter) → other user = the listing's owner
      //   • reservations on my listings (owner) → other user = the renter
      const now = Date.now();
      const nowIso = new Date().toISOString();
      const activeByOther: Record<string, ReservationInfo> = {};
      const consider = (otherId: string | undefined | null, r: any) => {
        if (!otherId) return;
        const info: ReservationInfo = {
          start: new Date(r.start_time),
          end: new Date(r.end_time),
          status: r.status ?? null,
        };
        const existing = activeByOther[otherId];
        activeByOther[otherId] = existing ? moreRelevant(info, existing, now) : info;
      };

      // Reservations where I'm the renter — resolve each listing's owner.
      const { data: renterRes } = await supabase
        .from('reservations')
        .select('listing_id, start_time, end_time, status')
        .eq('renter_id', userId)
        .gt('end_time', nowIso);
      const listingIds = [...new Set((renterRes ?? []).map((r: any) => r.listing_id))];
      let listingOwner: Record<string, string> = {};
      if (listingIds.length > 0) {
        const { data: ls } = await supabase
          .from('listings')
          .select('id, owner_id')
          .in('id', listingIds);
        listingOwner = Object.fromEntries((ls ?? []).map((l: any) => [l.id, l.owner_id]));
      }
      for (const r of renterRes ?? []) consider(listingOwner[r.listing_id], r);

      // Reservations on my own listings — the other user is the renter.
      const { data: myListings } = await supabase
        .from('listings')
        .select('id')
        .eq('owner_id', userId);
      const myListingIds = (myListings ?? []).map((l: any) => l.id);
      if (myListingIds.length > 0) {
        const { data: ownerRes } = await supabase
          .from('reservations')
          .select('renter_id, start_time, end_time, status')
          .in('listing_id', myListingIds)
          .gt('end_time', nowIso);
        for (const r of ownerRes ?? []) consider(r.renter_id, r);
      }

      const enriched: Conversation[] = convData.map((c: any) => {
        const otherId = c.renter_id === userId ? c.owner_id : c.renter_id;
        const reservation = activeByOther[otherId] ?? null;
        return {
          id: c.id,
          renter_id: c.renter_id,
          owner_id: c.owner_id,
          last_message: c.last_message,
          updated_at: c.updated_at,
          otherUserName: profileMap[otherId]?.name ?? 'Unknown',
          otherUserId: otherId,
          otherAvatarUrl: profileMap[otherId]?.avatar ?? null,
          reservation,
          category: reservation ? 'active' : 'past',
        };
      });

      if (mounted.current) {
        setConversations(enriched);
        setLoading(false);
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, []);

  const openChat = (conv: Conversation) =>
    withLightHaptic(() =>
      router.push({
        pathname: './Chat',
        params: { conversationId: conv.id, otherUserName: conv.otherUserName },
      } as any),
    );

  const activeConvs = conversations
    .filter((c) => c.category === 'active')
    .sort((a, b) => (a.reservation!.end.getTime() - b.reservation!.end.getTime()));
  const pastConvs = conversations.filter((c) => c.category === 'past');

  const Avatar = ({ url, size }: { url: string | null; size: number }) => (
    <Image
      source={url ? { uri: url } : defaultAvatar}
      style={{ width: size, height: size, borderRadius: size / 2 }}
    />
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Title pill — same size + lettering as the Profile page pill. */}
      <View style={styles.header}>
        <View style={styles.titlePill}>
          <Text style={styles.titlePillText}>Messages</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#000" style={styles.loader} />
      ) : conversations.length === 0 ? (
        <Text style={styles.empty}>No conversations yet</Text>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Scheduled / in-progress — black-outlined container. */}
          {activeConvs.length > 0 && (
            <View style={styles.activeContainer}>
              {activeConvs.map((conv) => (
                <TouchableOpacity
                  key={conv.id}
                  style={styles.activeRow}
                  activeOpacity={0.8}
                  onPress={openChat(conv)}
                >
                  <Avatar url={conv.otherAvatarUrl} size={ACTIVE_AVATAR} />
                  <View style={styles.rowText}>
                    <Text style={styles.name} numberOfLines={1}>
                      {conv.otherUserName}
                    </Text>
                    {statusLine(conv)}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Past meetings — standalone bubbles with margins between each. */}
          {pastConvs.map((conv) => (
            <TouchableOpacity
              key={conv.id}
              style={styles.pastRow}
              activeOpacity={0.8}
              onPress={openChat(conv)}
            >
              <Avatar url={conv.otherAvatarUrl} size={PAST_AVATAR} />
              <View style={styles.rowText}>
                <Text style={styles.name} numberOfLines={1}>
                  {conv.otherUserName}
                </Text>
                {statusLine(conv)}
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#DCDBD8' },

  // Header pill (mirrors Profile page).
  header: {
    paddingHorizontal: H_PAD,
    paddingTop: screenWidth * 0.02,
    paddingBottom: screenWidth * 0.03,
  },
  titlePill: {
    height: HEADER_BTN_HEIGHT,
    paddingHorizontal: screenWidth * 0.07,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  titlePillText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: screenWidth * 0.045,
    color: '#FFFFFF',
  },

  loader: { marginTop: 40 },
  empty: {
    textAlign: 'center',
    marginTop: 60,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: screenWidth * 0.04,
    color: 'rgba(0,0,0,0.5)',
  },

  scroll: {
    paddingHorizontal: H_PAD,
    paddingBottom: MENU_BAR_HEIGHT + screenWidth * 0.1,
    gap: screenWidth * 0.03,
  },

  // Outlined container for scheduled / in-progress conversations.
  // Fully rounded like the message pills so the stroke tracks their curve.
  activeContainer: {
    borderWidth: 3.0,
    borderColor: '#000000',
    borderRadius: 45,
    padding: screenWidth * 0.03,
    gap: screenWidth * 0.025,
  },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F4F4F4',
    borderRadius: 999,
    paddingVertical: screenWidth * 0.05,
    paddingHorizontal: screenWidth * 0.05,
    gap: screenWidth * 0.03,
  },

  // Past-meeting bubbles.
  pastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F4F4F4',
    borderRadius: 999,
    paddingVertical: screenWidth * 0.05,
    paddingHorizontal: screenWidth * 0.05,
    gap: screenWidth * 0.035,
  },

  rowText: { flex: 1 },
  name: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: screenWidth * 0.04,
    color: '#000000',
  },
  subtitle: {
    marginTop: 2,
    fontFamily: CustomFonts.BevellierMedium,
    fontSize: screenWidth * 0.03,
    color: 'rgba(0,0,0,0.5)',
  },
});
