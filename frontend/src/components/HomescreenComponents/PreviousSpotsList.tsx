import { FlatList, View, StyleSheet, Dimensions } from 'react-native';

import PreviousSpotCard from '../PreviousSpotCard';
import { getPrimaryRate } from '@/src/utils/listingPrice';
import { triggerLightHaptic } from '@/src/utils/haptics';

const { width: screenWidth } = Dimensions.get('window');
const CARD_GAP = screenWidth * 0.03;
const LIST_H_PAD = screenWidth * 0.04;

type SpotsListProp = {
  listingData: {
    id: string;
    owner_id: string;
    address: string;
    price_per_hour: number | null;
    photo_url: string;
    hourly_rate?: number | null;
    daily_rate?: number | null;
    weekly_rate?: number | null;
    monthly_rate?: number | null;
  };
  end_time: Date;
};

type PreviousSpotsListProps = {
  spots: SpotsListProp[] | null;
};

export default function PreviousSpotsList({ spots }: PreviousSpotsListProps) {
  if (!spots) return null;

  return (
    <FlatList
      data={spots}
      keyExtractor={(item, index) => `${item.listingData.id}-${index}`}
      horizontal
      showsHorizontalScrollIndicator={false}
      onScrollBeginDrag={triggerLightHaptic}
      contentContainerStyle={styles.listContent}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      renderItem={({ item }) => (
        <PreviousSpotCard
          name={item.listingData.address}
          price={(() => {
            const r = getPrimaryRate(item.listingData);
            return r ? r.value.toString() : '0';
          })()}
          date={item.end_time.toString()}
          duration={item.end_time.toString()}
          mapImage={{ uri: item.listingData.photo_url }}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: LIST_H_PAD,
  },
  separator: {
    width: CARD_GAP,
  },
});
