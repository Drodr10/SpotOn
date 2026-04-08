/**
 * SearchBar — Figma: "search bar"
 *
 * Tapping navigates to QuickSearch where the user does map-based search.
 *
 * Props:
 *   onSearch? — kept for backwards compatibility, no longer used.
 */

// ─── React & React Native ────────────────────────────────────────────────────
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';

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
const FONT_SIZE = screenWidth * 0.04;
const ICON_SIZE = screenWidth * 0.055;
const GAP       = screenWidth * 0.025;

// ─── Props ───────────────────────────────────────────────────────────────────
interface SearchBarProps {
  onSearch?: (query: string) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function SearchBar({ onSearch }: SearchBarProps) {
  const router = useRouter();

  return (
    <TouchableOpacity
      style={styles.container}
      activeOpacity={0.7}
      onPress={() => router.push('/QuickSearch')}
    >
      <Ionicons name="search" size={ICON_SIZE} color="rgba(0,0,0,0.75)" />
      <Text style={styles.placeholder}>Where to?</Text>
    </TouchableOpacity>
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
  placeholder: {
    flex: 1,
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: FONT_SIZE,
    color: 'rgba(0,0,0,0.5)',
  },
});
