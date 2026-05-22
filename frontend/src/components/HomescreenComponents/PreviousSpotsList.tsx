import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import ReservationCard from '../ReservationCard';
import { CustomFonts } from '@/src/constants/theme';
import type { ActiveReservation } from '@/src/utils/api';

const { width: screenWidth } = Dimensions.get('window');
const CARD_GAP   = screenWidth * 0.04;
const EMPTY_FONT = screenWidth * 0.034;

type PreviousSpotsListProps = {
  spots: ActiveReservation[] | null;
};

export default function PreviousSpotsList({ spots }: PreviousSpotsListProps) {
  if (!spots || spots.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Place a reservation for it to appear here</Text>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {spots.map((spot, index) => (
        <View key={spot.id} style={index > 0 ? styles.gap : undefined}>
          <ReservationCard
            address={spot.listingData.address}
            endTime={spot.end_time}
            totalPrice={spot.total_price}
            photoUrl={spot.listingData.photo_url}
            unavailable={spot.listingUnavailable}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    alignItems: 'center',
  },
  gap: {
    marginTop: CARD_GAP,
  },
  emptyContainer: {
    alignItems:    'center',
    paddingVertical: screenWidth * 0.04,
  },
  emptyText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize:   EMPTY_FONT,
    color:      '#888888',
  },
});
