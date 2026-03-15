/**
 * SuggestionsList — Figma: "vertical list view"
 *
 * Renders a short, non-scrollable vertical list of destination suggestions
 * below the SearchBar on HomeScreen. Uses .map() instead of FlatList so
 * it can safely sit inside a parent ScrollView without nesting warnings.
 * TODO: Replace with real backend suggestions.
 */

// ─── React & React Native ────────────────────────────────────────────────────
import React from 'react';
import { View, StyleSheet } from 'react-native';

// ─── Components ──────────────────────────────────────────────────────────────
import SuggestionRow, { SuggestionIconType } from './SuggestionRow';

// ─── Data ────────────────────────────────────────────────────────────────────
// TODO: Replace with real suggestion data from backend
interface SuggestionItem {
  id: string;
  name: string;
  iconType: SuggestionIconType;
}

const SUGGESTIONS_DATA: SuggestionItem[] = [
  { id: '1', name: 'Reitz Union',             iconType: 'building'   },
  { id: '2', name: 'Shands Hospital',          iconType: 'emergency'  },
  { id: '3', name: 'Marston Science Library',  iconType: 'building'   },
];

// ─── Component ───────────────────────────────────────────────────────────────
export default function SuggestionsList() {
  return (
    <View>
      {SUGGESTIONS_DATA.map((item, index) => (
        <View key={item.id}>
          {/* Hairline divider above every row except the first */}
          {index > 0 && <View style={styles.divider} />}
          <SuggestionRow name={item.name} iconType={item.iconType} />
        </View>
      ))}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
});
