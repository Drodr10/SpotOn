/**
 * Introduction Page — First screen shown on app launch.
 * Displays branding, tagline, and login fields.
 *
 * TODO: Connect Username and Password fields to Supabase Auth
 * via the backend's POST /api/auth/login endpoint.
 * On successful login, navigate to Homescreen.
 * On first-time users, add a sign-up flow.
 */

// ─── React & React Native ────────────────────────────────────────────────────
import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

// ─── Navigation ──────────────────────────────────────────────────────────────
import { router } from 'expo-router';

// ─── Constants ───────────────────────────────────────────────────────────────
import { CustomFonts } from '@/src/constants/theme';

// ─── Assets ──────────────────────────────────────────────────────────────────
import frontImageAsset  from '@/assets/images/frontimage.jpeg';
import spotonLogoAsset  from '@/assets/images/spotonlogo.png';
import enterArrowAsset  from '@/assets/images/enter arrow.png';

// ─── Responsive sizing ───────────────────────────────────────────────────────
const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const H_PAD         = screenWidth * 0.06;   // horizontal padding inside the card
const IMAGE_HEIGHT  = screenHeight * 0.60;  // hero image covers ~60% of screen
const CARD_OVERLAP  = screenHeight * 0.04;  // how much the card pulls up over the image
const INPUT_HEIGHT  = screenWidth * 0.13;   // pill input height
const INPUT_RADIUS  = 999;                  // full pill shape
const LOGO_SIZE     = screenWidth * 0.07;   // small SpotOn logo
const ARROW_SIZE    = screenWidth * 0.09;   // enter arrow icon
const FONT_SPOTON   = screenWidth * 0.035;  // "SpotOn" label next to logo
const FONT_TAGLINE  = screenWidth * 0.048;  // tagline text
const FONT_INPUT    = screenWidth * 0.038;  // input placeholder / text

// ─── Component ───────────────────────────────────────────────────────────────
export default function Intro() {
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');

  /** Handles the enter arrow press — navigates to Homescreen. */
  const handleLogin = () => {
    // TODO: Before navigating, validate username/password against
    // the backend: POST /api/auth/login { email, password }
    // Store the returned session token for authenticated requests.
    // Only navigate to Homescreen on successful login.

    // replace() so the user can't swipe/go back to the Intro screen
    router.replace('/Homescreen');
  };

  return (
    // Figma: "Introduction Page" — near-white background fills any gaps
    <View style={styles.screen}>
      <StatusBar style="dark" />

      {/* ── 1. frontimage — Figma: "frontimage" ──────────────────────────── */}
      {/*
        Container clips the oversized image so only the left portion is visible.
        The image is wider than the screen and left-anchored, which keeps the
        front of the car in view rather than the centered middle.
      */}
      <View style={styles.heroContainer}>
        <Image
          source={frontImageAsset}
          style={styles.heroImage}
          resizeMode="cover"
        />
      </View>

      {/* ── 2. Bottom Card — Figma: "Bottom Card" ────────────────────────── */}
      {/*
        Pulled up by CARD_OVERLAP via negative marginTop so it slightly
        overlaps the hero image, creating a layered / card effect.
      */}
      <View style={styles.card}>

        {/* ── Group 1 — Branding Row — Figma: "Group 1" ─────────────────── */}
        <View style={styles.brandingRow}>
          {/* SpotOn Logo — Figma: "SpotOn Logo" */}
          <Image
            source={spotonLogoAsset}
            style={styles.logo}
            resizeMode="contain"
          />
          {/* "SpotOn" label */}
          <Text style={styles.brandingText}>SpotOn</Text>
        </View>

        {/* ── Tagline — Figma: "Your Next Spot, Is Just A Tap Away." ────── */}
        <Text style={styles.tagline}>Your Next Spot,{'\n'}Is Just A Tap Away.</Text>

        {/* ── Group 2 — Login Fields — Figma: "Group 2" ─────────────────── */}
        <View style={styles.loginGroup}>

          {/* Username Login In — Figma: "Username Login In" */}
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            placeholder="Username"
            placeholderTextColor="rgba(0,0,0,0.4)"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* Password Login In — Figma: "Password Login In" */}
          {/*
            Wrapped in a View so the enter arrow can be positioned
            absolutely over the right edge of the input field.
          */}
          <View style={styles.passwordRow}>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor="rgba(0,0,0,0.4)"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              // Submit on keyboard "done" key as well
              onSubmitEditing={handleLogin}
              returnKeyType="go"
            />

            {/* enter arrow — Figma: "enter arrow" */}
            {/* Overlaps the right edge of the password field */}
            <TouchableOpacity
              style={styles.arrowButton}
              onPress={handleLogin}
              activeOpacity={0.7}
            >
              <Image
                source={enterArrowAsset}
                style={styles.arrowIcon}
                resizeMode="contain"
              />
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Figma: "Introduction Page" — near-white background
  screen: {
    flex: 1,
    backgroundColor: '#FEFEFE',
  },

  // ── Hero Image ──────────────────────────────────────────────────────────────
  // Figma: "frontimage" — full-bleed, covers ~60% of screen height
  // Container clips the oversized image to screen width, left-anchored
  heroContainer: {
    width: screenWidth,
    height: IMAGE_HEIGHT,
    overflow: 'hidden',
  },
  heroImage: {
    // Wider than the screen so the right side overflows off-screen,
    // leaving the left (front of car) portion visible
    width: screenWidth * 2,
    height: IMAGE_HEIGHT,
  },

  // ── Bottom Card ─────────────────────────────────────────────────────────────
  // Figma: "Bottom Card" — warm gray, rounded top corners, overlaps image
  card: {
    flex: 1,
    backgroundColor: '#DCDBD8',
    borderTopLeftRadius: screenWidth * 0.07,
    borderTopRightRadius: screenWidth * 0.07,
    // Pull the card up over the hero image
    marginTop: -CARD_OVERLAP,
    marginHorizontal: H_PAD * 0.25,
    paddingHorizontal: H_PAD,
    paddingTop: screenWidth * 0.06,
    paddingBottom: screenWidth * 0.08,
  },

  // ── Branding Row ────────────────────────────────────────────────────────────
  // Figma: "Group 1" — logo + "SpotOn" text side by side
  brandingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: screenWidth * 0.01,
    marginBottom: screenWidth * 0.03,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    opacity: 0.75,
  },
  brandingText: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: FONT_SPOTON,
    color: 'rgba(0,0,0,0.75)',
  },

  // ── Tagline ─────────────────────────────────────────────────────────────────
  // Figma: "Your Next Spot, Is Just A Tap Away."
  tagline: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: FONT_TAGLINE,
    color: '#000000',
    marginBottom: screenWidth * 0.07,
    lineHeight: screenWidth * 0.065,
  },

  // ── Login Fields ────────────────────────────────────────────────────────────
  // Figma: "Group 2"
  loginGroup: {
    gap: screenWidth * 0.035,
  },

  // Shared pill-shaped input style (Username + Password)
  input: {
    width: '100%',
    height: INPUT_HEIGHT,
    backgroundColor: '#FFFFFF',
    borderRadius: INPUT_RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(0,0,0,0.15)',
    paddingHorizontal: screenWidth * 0.05,
    fontFamily: CustomFonts.SwitzerLight,
    fontSize: FONT_INPUT,
    color: '#000000',
  },

  // Wrapper that stacks the password TextInput with the arrow overlaid
  passwordRow: {
    position: 'relative',
    justifyContent: 'center',
  },

  // enter arrow — sits over the right edge of the password input
  arrowButton: {
    position: 'absolute',
    right: screenWidth * 0.01,
    justifyContent: 'center',
    alignItems: 'center',
    padding: screenWidth * 0.015,
  },
  arrowIcon: {
    width: ARROW_SIZE,
    height: ARROW_SIZE,
  },
});
