/**
 * Homescreen - Figma: "HomeScreen"
 *
 * Main screen of the SpotOn app.
 */

import { useState, useCallback } from 'react';
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
import TooFarBanner from '@/src/components/HomescreenComponents/TooFarBanner';
import PayoutBanner from '@/src/components/HomescreenComponents/PayoutBanner';
import UpcomingReservationBanner from '@/src/components/HomescreenComponents/UpcomingReservationBanner';
import { BANNER_HEIGHT } from '@/src/components/HomescreenComponents/bannerStyle';
import { MENU_BAR_HEIGHT } from '@/src/components/MenuBar';
import { CustomFonts } from '@/src/constants/theme';

import gradientBackgroundAsset from '@/assets/images/gradient_background_v1.png';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const H_PAD        = screenWidth * 0.05;
const SECTION_GAP  = screenWidth * 0.05;
const SECTION_LABEL = screenWidth * 0.045;

export default function Homescreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [, setRefreshKey] = useState(0);
  const [showTooFar, setShowTooFar] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    setTimeout(() => setRefreshing(false), 600);
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />

      {/* Gradient image sits on top of the tan base, no animation */}
      <Image
        source={gradientBackgroundAsset}
        style={styles.gradientBackground}
        resizeMode="cover"
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

            <UpcomingReservationBanner />

            <PayoutBanner />

            {showTooFar && (
              <View style={styles.section}>
                <TooFarBanner minHeight={BANNER_HEIGHT} />
              </View>
            )}

            {/* DynamicViewer — breaks out of horizontal padding like PreviousSpots */}
            <View style={styles.sectionLabelRow}>
              <Text style={styles.sectionLabel}>Listings Near You</Text>
            </View>
            <View style={[styles.section, styles.fullBleedSection]}>
              <DynamicViewer onFallback={setShowTooFar} />
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
});
