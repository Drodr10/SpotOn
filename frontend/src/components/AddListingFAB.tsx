/**
 * AddListingFAB — Figma: "Add Listing Button"
 *
 * Floating action button positioned at the bottom-right of the screen.
 * Tapping it should navigate to the "create a listing" flow.
 * TODO: Wire onPress to the listing creation screen when it's built.
 */

// ─── React & React Native ────────────────────────────────────────────────────
import React from 'react';
import { Pressable, StyleSheet, Dimensions } from 'react-native';

// ─── Icons ───────────────────────────────────────────────────────────────────
import { Ionicons } from '@expo/vector-icons';

// ─── Responsive sizing ───────────────────────────────────────────────────────
const { width: screenWidth } = Dimensions.get('window');
const FAB_SIZE   = screenWidth * 0.145;  // ~56px on 390px screen
const ICON_SIZE  = screenWidth * 0.075;  // ~29px
const OFFSET     = screenWidth * 0.05;   // distance from bottom/right edges

// ─── Props ───────────────────────────────────────────────────────────────────
interface AddListingFABProps {
  onPress?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function AddListingFAB({ onPress }: AddListingFABProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      onPress={onPress}
      // Accessible label for screen readers
      accessibilityLabel="Add a parking listing"
      accessibilityRole="button"
    >
      {/* "+" icon */}
      <Ionicons name="add" size={ICON_SIZE} color="#FFFFFF" />
    </Pressable>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: OFFSET,
    right: OFFSET,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    // Subtle shadow for depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  fabPressed: {
    opacity: 0.85,
  },
});
