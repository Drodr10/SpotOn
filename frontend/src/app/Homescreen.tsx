/**
 * Homescreen — Figma: "HomeScreen"
 *
 * Main screen of the SpotOn app. Composed of:
 *   1. Header row: ProfilePill (left) + SpotOn logo (right)  ← fixed, does not scroll
 *   2. ScrollView:
 *      a. CarModel3D — 3D car (~280 px), intro tilt + device-motion parallax
 *      b. SearchBar
 *      c. SuggestionsList (vertical, static)
 *      d. "Your Previous Spots" section label
 *      e. PreviousSpotsList (horizontal FlatList)
 *   3. AddListingFAB (absolute, bottom-right)              ← fixed, does not scroll
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
import CarModel3D from '@/src/components/HomescreenComponents/CarModel3D';

// ─── Constants ───────────────────────────────────────────────────────────────
import { CustomFonts } from '@/src/constants/theme';

// ─── Assets ──────────────────────────────────────────────────────────────────
import logoAsset from '@/assets/images/spotonlogo.png';

// ─── Auth & Supabase ───────────────────────────────────────────────────────────────
import { supabase } from '../utils/supabase';
import { JwtPayload } from '@supabase/supabase-js';

// ─── Responsive sizing ───────────────────────────────────────────────────────
const { width: screenWidth } = Dimensions.get('window');
const H_PAD          = screenWidth * 0.05;   // horizontal padding for sections
const SECTION_GAP    = screenWidth * 0.05;   // vertical spacing between sections
/** Vertical gap between 3D car block and SearchBar. Larger value ⇒ more space (try 0.02–0.06 * screenWidth or a fixed px). */
const CAR_TO_SEARCH_GAP = -5;
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

// ─── Component ───────────────────────────────────────────────────────────────
export default function Homescreen() {

  //Load logged in user data from supabase.
  const [claims, setClaims] = useState<JwtPayload | null>(null);
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
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

        {/* ── 1. Header Row (fixed — does not scroll) ───────────────────── */}
        {/* Figma: profile pill left, logo right */}
        <View style={styles.header}>
          {/* Profile Pill — Figma: "profile" */}
          <ProfilePill username={profileData ? profileData.full_name : "not logged in" }/>

          {/* SpotOn Logo — Figma: "SpotOn Logo", ~75% opacity */}
          <Image
            source={logoAsset}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        {/*
          ScrollView wraps everything below the header.
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

          {/* ── 2. 3D Car Model ────────────────────────────────────────── */}
          {/* Bleeds edge-to-edge (negative horizontal margins cancel H_PAD) */}
          <View style={styles.carModelSection}>
            <CarModel3D />
          </View>

          {/* ── 3. Search Bar ─────────────────────────────────────────────── */}
          <View style={styles.section}>
            <SearchBar />
          </View>

          {/* ── 4. Suggestions List ───────────────────────────────────────── */}
          <View style={styles.section}>
            <SuggestionsList refreshKey={refreshKey} />
          </View>

          {/* ── 5. Section Label: "Your Previous Spots" ───────────────────── */}
          <View style={[styles.section, styles.sectionLabelRow]}>
            <Text style={styles.sectionLabel}>Your Previous Spots</Text>
          </View>

          {/* ── 6. Previous Spots List ────────────────────────────────────── */}
          {/* Sits directly below the label and scrolls with the page */}
          <View style={styles.previousSpotsContainer}>
            <PreviousSpotsList spots={null}/>
          </View>

        </ScrollView>

        {/* ── 7. Add Listing FAB ────────────────────────────────────────── */}
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

  // ── Header (fixed above scroll) ───────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: H_PAD,
    paddingTop: screenWidth * 0.02,
    paddingBottom: SECTION_GAP,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    opacity: 0.75,
  },

  // ── Scroll content ────────────────────────────────────────────────────────
  scrollContent: {
    paddingHorizontal: H_PAD,
    paddingBottom: SECTION_GAP,
  },

  // ── 3D Car Model — edge-to-edge ───────────────────────────────────────────
  carModelSection: {
    marginHorizontal: -H_PAD,
    marginBottom: CAR_TO_SEARCH_GAP,
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
