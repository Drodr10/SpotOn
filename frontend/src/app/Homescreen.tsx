/**
 * Homescreen - Figma: "HomeScreen"
 *
 * Main screen of the SpotOn app.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Image,
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import LogoBar from '@/src/components/HomescreenComponents/LogoBar';
import SearchBar from '@/src/components/HomescreenComponents/SearchBar';
import DynamicViewer from '@/src/components/HomescreenComponents/DynamicViewer';
import PreviousSpotsList from '@/src/components/HomescreenComponents/PreviousSpotsList';
import { MENU_BAR_HEIGHT } from '@/src/components/MenuBar';
import { CustomFonts } from '@/src/constants/theme';
import { supabase } from '../utils/supabase';
import { api, type ActiveReservation } from '../utils/api';

import gradientBackgroundAsset from '@/assets/images/gradient_background_v1.png';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const H_PAD        = screenWidth * 0.05;
const SECTION_GAP  = screenWidth * 0.05;
const SECTION_LABEL = screenWidth * 0.045;

type ProfileData = {
  id: string;
  full_name: string;
  email: string;
  rating_avg: number;
  created_at: string;
};

export default function Homescreen() {
  const [userId, setUserId]         = useState<string | null>(null);
  const [, setProfileData]          = useState<ProfileData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [currentReservationData, setCurrentReservationData] = useState<ActiveReservation[] | null>(null);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    setTimeout(() => setRefreshing(false), 600);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (error || !session) {
        console.log('No active session:', error?.message ?? 'session null');
        return;
      }

      const id = session.user.id;
      setUserId(id);

      const { data, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', id)
        .single();

      if (profileError || !data) {
        console.log('Error retrieving profile:', profileError?.message);
        return;
      }

      setProfileData(data);
    });
  }, []);

  useEffect(() => {
    if (!userId) return;
    const fetchCurrentReservations = async () => {
      setCurrentReservationData(await api.getActiveReservations(userId));
    };
    fetchCurrentReservations();
  }, [userId, refreshKey]);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />

      {/* Gradient image sits on top of the tan base, no animation */}
      <Image
        source={gradientBackgroundAsset}
        style={styles.gradientBackground}
        resizeMode="cover"
        pointerEvents="none"
      />

      {/* Content respects top safe area; background does not */}
      <SafeAreaView style={styles.safeContent} edges={['top', 'left', 'right']}>
        <View style={styles.screen}>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            <View style={styles.header}>
              <LogoBar />
            </View>

            <View style={styles.section}>
              <SearchBar />
            </View>

            {/* DynamicViewer — breaks out of horizontal padding like PreviousSpots */}
            <View style={styles.sectionLabelRow}>
              <Text style={styles.sectionLabel}>Listings Near You</Text>
            </View>
            <View style={[styles.section, styles.fullBleedSection]}>
              <DynamicViewer />
            </View>

            <View style={[styles.section, styles.sectionLabelRow]}>
              <Text style={styles.sectionLabel}>Your Current Reservations</Text>
            </View>

            <View style={styles.previousSpotsContainer}>
              <PreviousSpotsList spots={currentReservationData} />
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#DCDBD8',
  },
  gradientBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: screenWidth,
    height: screenHeight,
    transform: [{ rotate: '180deg' }],
  },
  safeContent: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  screen: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollContent: {
    paddingHorizontal: H_PAD,
    paddingBottom: SECTION_GAP + MENU_BAR_HEIGHT + 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: screenWidth * 0.02,
    paddingBottom: SECTION_GAP,
  },
  section: {
    marginBottom: SECTION_GAP,
  },
  sectionLabelRow: {
    marginBottom: screenWidth * 0.03,
  },
  sectionLabel: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: SECTION_LABEL,
    color: '#000000',
  },
  fullBleedSection: {
    marginHorizontal: -H_PAD,
  },
  previousSpotsContainer: {
    marginHorizontal: -H_PAD,
  },
});
