/**
 * SearchBar — Figma: "search bar"
 *
 * Renders a rounded search input row with a magnifying-glass icon on the left
 * and a "Where to?" placeholder TextInput. On submit (Enter / Search key),
 * navigates to the search screen passing the typed query as a route param.
 *
 * Props:
 *   onSearch? — optional callback fired with the query string on submit,
 *               useful if a parent wants to intercept or log the query.
 */

// ─── React & React Native ────────────────────────────────────────────────────
import React, { useState } from 'react';
import { View, TextInput, StyleSheet, Dimensions } from 'react-native';

// ─── Navigation ──────────────────────────────────────────────────────────────
import { useRouter } from 'expo-router';

// ─── Icons ───────────────────────────────────────────────────────────────────
import { Ionicons } from '@expo/vector-icons';

// ─── Constants ───────────────────────────────────────────────────────────────
import { CustomFonts } from '@/src/constants/theme';

// ─── Responsive sizing ───────────────────────────────────────────────────────
const { width: screenWidth } = Dimensions.get('window');
const H_PAD    = screenWidth * 0.04;
const V_PAD    = screenWidth * 0.03;
const FONT_SIZE = screenWidth * 0.04;   // ~16px
const ICON_SIZE = screenWidth * 0.055;  // ~22px
const GAP       = screenWidth * 0.025;

// ─── Props ───────────────────────────────────────────────────────────────────
interface SearchBarProps {
  /** Optional callback fired with the query string when the user submits. */
  onSearch?: (query: string) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function SearchBar({ onSearch }: SearchBarProps) {
  const router = useRouter();
  const [searchText, setSearchText] = useState('');

  /** Called when the user presses Enter / the "Search" key on the keyboard. */
  const handleSubmit = () => {
    const trimmed = searchText.trim();
    if (!trimmed) return; // ignore empty submissions

    // Fire optional parent callback
    onSearch?.(trimmed);

    // Navigate to the search screen with the query as a route parameter
    router.push({ pathname: '/search', params: { query: trimmed } });

    // Clear the input so it's ready for a new search when the user returns
    setSearchText('');
  };

  return (
    <View style={styles.container}>
      {/* Search icon — Figma: "explore icon" */}
      <Ionicons name="search" size={ICON_SIZE} color="rgba(0,0,0,0.75)" />

      {/*
        TextInput replaces the previous static <Text>.
        Styled to match the original "Where to?" text exactly.
        returnKeyType="search" shows the Search button on iOS keyboards.
      */}
      <TextInput
        style={styles.input}
        value={searchText}
        onChangeText={setSearchText}
        onSubmitEditing={handleSubmit}
        placeholder="Where to?"
        placeholderTextColor="rgba(0,0,0,0.5)"
        returnKeyType="search"
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.75)',
    borderRadius: 999,
    paddingHorizontal: H_PAD,
    paddingVertical: V_PAD,
    gap: GAP,
    backgroundColor: 'transparent',
  },
  input: {
    // flex: 1 lets the input fill the remaining horizontal space in the row
    flex: 1,
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: FONT_SIZE,
    color: '#000000',
    // Remove default padding that React Native adds to TextInput on Android
    padding: 0,
  },
});
