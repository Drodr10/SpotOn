/**
 * PreviousSpotsList — Figma: "Horizontal List View of Previous Spots"
 *
 * Renders a horizontally scrolling FlatList of PreviousSpotCard items.
 * Data is driven by PREVIOUS_SPOTS_DATA.
 * TODO: Replace with real reservation history from Supabase backend.
 */

// ─── React & React Native ────────────────────────────────────────────────────
import React from 'react';
import { FlatList, View, StyleSheet, Dimensions } from 'react-native';

// ─── Components ──────────────────────────────────────────────────────────────
import PreviousSpotCard, { PreviousSpotCardProps } from '../PreviousSpotCard';

// ─── Assets ──────────────────────────────────────────────────────────────────
import mapPlaceholder from '@/assets/images/mapimageplaceholder.png';

// ─── Responsive sizing ───────────────────────────────────────────────────────
const { width: screenWidth } = Dimensions.get('window');
const CARD_GAP    = screenWidth * 0.03;   // space between cards
const LIST_H_PAD  = screenWidth * 0.04;   // leading/trailing padding

// ─── Data ────────────────────────────────────────────────────────────────────
// TODO: Replace with real reservation history from Supabase
interface SpotItem extends PreviousSpotCardProps {
  id: string;
}

const PREVIOUS_SPOTS_DATA: SpotItem[] = [
  {
    id: '1',
    name: 'Target',
    price: '$5.99',
    date: '4.26.2026',
    duration: '3 Hrs',
    mapImage: mapPlaceholder,
  },
  {
    id: '2',
    name: 'Tigert Hall',
    price: '$36.67',
    date: '3.19.2026',
    duration: '7.5 hrs',
    mapImage: mapPlaceholder,
  },
];

//adding for reusability across components
type SpotsListProp = {
  spots: SpotItem[] | null;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function PreviousSpotsList({ spots }: SpotsListProp) {
  return (
    <FlatList
      data={spots ? spots : PREVIOUS_SPOTS_DATA}
      keyExtractor={(item) => item.id}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.listContent}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      renderItem={({ item }) => (
        <PreviousSpotCard
          name={item.name}
          price={item.price}
          date={item.date}
          duration={item.duration}
          mapImage={item.mapImage}
        />
      )}
    />
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: LIST_H_PAD,
  },
  separator: {
    width: CARD_GAP,
  },
});

