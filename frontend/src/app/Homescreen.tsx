/**
 * Homescreen — Figma: "HomeScreen"
 *
 * Main screen of the SpotOn app. Composed of:
 *   1. Header row: ProfilePill (left) + SpotOn logo (right)
 *   2. SearchBar
 *   3. SuggestionsList (vertical, static)
 *   4. "Your Previous Spots" section label
 *   5. PreviousSpotsList (horizontal FlatList)
 *   6. AddListingFAB (absolute, bottom-right)
 *
 * Background: #DCDBD8 (warm light gray)
 */

// ─── React & React Native ────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  RefreshControl,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';

// ─── Components ──────────────────────────────────────────────────────────────
import ProfilePill from '@/src/components/HomescreenComponents/ProfilePill';
import SearchBar from '@/src/components/HomescreenComponents/SearchBar';
import SuggestionsList from '@/src/components/HomescreenComponents/SuggestionsList';
import PreviousSpotsList from '@/src/components/HomescreenComponents/PreviousSpotsList';
import AddListingFAB from '@/src/components/HomescreenComponents/AddListingFAB';
import CurrentListingCard from '@/src/components/HomescreenComponents/currentListingCard';

// ─── Icons ───────────────────────────────────────────────────────────────────
import { Ionicons } from '@expo/vector-icons';

// ─── Constants ───────────────────────────────────────────────────────────────
import { CustomFonts } from '@/src/constants/theme';

// ─── Assets ──────────────────────────────────────────────────────────────────
import logoAsset from '@/assets/images/spotonlogo.png';

// ─── Auth & Supabase ───────────────────────────────────────────────────────────────
import { supabase } from '../utils/supabase';
import { JwtPayload } from '@supabase/supabase-js';
import { api } from "../utils/api"

// ─── Responsive sizing ───────────────────────────────────────────────────────
const { width: screenWidth } = Dimensions.get('window');
const H_PAD          = screenWidth * 0.05;   // horizontal padding for sections
const SECTION_GAP    = screenWidth * 0.05;   // vertical spacing between sections
const LOGO_SIZE      = screenWidth * 0.12;   // ~47px
const SECTION_LABEL  = screenWidth * 0.045;  // ~18px — "Your Previous Spots"

//
type ProfileData = {
  id: string;
  full_name: string;
  email: string;
  rating_avg: number;
  created_at: string;
}

type SpotsListProp = {
  listingData: {
    id: string;
    owner_id: string;
    address: string;
    price_per_hour: number;
    photo_url: string;
  },
  end_time: Date;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function Homescreen() {

  //Load logged in user data from supabase.
  const [claims, setClaims] = useState<JwtPayload | null>(null);
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [pastReservationData, setPastReservationData] = useState<SpotsListProp[] | null>(null);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    // Small delay so the spinner is visible
    setTimeout(() => setRefreshing(false), 600);
  }, []);

  useEffect(() => {
    supabase.auth.getClaims().then(async (resp) => {
      const {data, error} = resp;

      if (error || !data) {
        console.log("Error in finding matching user ID: " + (error ? error : "Data error"));
        return;
      }
      setClaims(data.claims);
      const { data: profileData, error: profileError } =  await supabase.from('profiles').select('*').eq('id', data.claims.sub).single();

      if (profileError || !profileData) {
        console.log("Error in retriving user profile data: " + (profileError ? profileError : "Data error"));
        return;
      }

      setProfileData(profileData);
    });
  }, []);

  useEffect(() =>{
    if (!claims) return;
    const fetchPastReservations = async () => {
      setPastReservationData(await api.getReservations(claims.sub));
    };
    fetchPastReservations();
  }, [claims]);

  return (
    // SafeAreaView keeps content away from notch/status bar/home indicator
    <SafeAreaView style={styles.safeArea}>
      {/* Dark status bar icons to contrast against light background */}
      <StatusBar style="dark" />

      {/*
        Outer container is `position: relative` so AddListingFAB can use
        `position: absolute` relative to the screen edges.
      */}
      <View style={styles.screen}>
        {/*
          Single ScrollView wraps all content so everything scrolls together.
          PreviousSpotsList (horizontal FlatList) is safe inside a vertical
          ScrollView — only vertical FlatLists cause nesting warnings.
          SuggestionsList was converted to .map() to avoid any nesting issues.
        */}
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >

          {/* ── 1. Header Row ─────────────────────────────────────────────── */}
          {/* Figma: profile pill left, logo right */}
          <View style={styles.header}>
            {/* Profile Pill — Figma: "profile" */}
            <ProfilePill username={profileData ? profileData.full_name : "not logged in" }/>

            <View style={styles.headerRight}>
              {/* Messages button */}
              <TouchableOpacity
                style={styles.messagesBtn}
                onPress={() => router.push('./Messages' as any)}
              >
                <Ionicons name="chatbubbles-outline" size={LOGO_SIZE * 0.72} color="#000" />
              </TouchableOpacity>

              {/* SpotOn Logo — Figma: "SpotOn Logo", ~75% opacity */}
              <Image
                source={logoAsset}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>
          </View>

          {/* ── 2. Search Bar ─────────────────────────────────────────────── */}
          <View style={styles.section}>
            <SearchBar />
          </View>
          
          <View style={styles.section}>
            { claims ? 
            <CurrentListingCard userId={claims!.sub}/>
          : <Text>Loading...</Text>}
          </View>

          {/* ── 4. Section Label: "Your Previous Spots" ───────────────────── */}
          <View style={[styles.section, styles.sectionLabelRow]}>
            <Text style={styles.sectionLabel}>Your Previous Spots</Text>
          </View>

          {/* ── 5. Previous Spots List ────────────────────────────────────── */}
          {/* Sits directly below the label and scrolls with the page */}
          <View style={styles.previousSpotsContainer}>
            <PreviousSpotsList spots={pastReservationData}/>
          </View>

        </ScrollView>

        {/* ── 6. Add Listing FAB ────────────────────────────────────────── */}
        {/* Absolutely positioned over all content, bottom-right */}
        <AddListingFAB
          onPress={() => router.push('./CreateListing2' as any)}
        />
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#DCDBD8',
  },
  screen: {
    flex: 1,
    // Relative so AddListingFAB can position absolutely within this View
    position: 'relative',
  },
  scrollContent: {
    paddingHorizontal: H_PAD,
    paddingBottom: SECTION_GAP,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: screenWidth * 0.02,
    paddingBottom: SECTION_GAP,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: screenWidth * 0.03,
  },
  messagesBtn: {
    padding: screenWidth * 0.01,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    opacity: 0.75,
  },

  // ── Generic section spacing ───────────────────────────────────────────────
  section: {
    marginBottom: SECTION_GAP,
  },

  // ── Section label row ─────────────────────────────────────────────────────
  sectionLabelRow: {
    marginBottom: screenWidth * 0.03,
  },
  sectionLabel: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: SECTION_LABEL,
    color: '#000000',
  },

  // ── Previous Spots List ───────────────────────────────────────────────────
  previousSpotsContainer: {
    // Negative horizontal margin lets the list bleed edge-to-edge
    // while the rest of the scrollContent has H_PAD on both sides
    marginHorizontal: -H_PAD,
  },
});
