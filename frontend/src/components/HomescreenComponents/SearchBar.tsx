import { Text, TouchableOpacity, StyleSheet, Dimensions, Image } from 'react-native';
import { useRouter } from 'expo-router';

import { CustomFonts } from '@/src/constants/theme';
import { withLightHaptic } from '@/src/utils/haptics';
import exploreIconAsset from '@/assets/images/explore_icon.png';

const { width: screenWidth } = Dimensions.get('window');
const H_PAD = screenWidth * 0.045;
const V_PAD = screenWidth * 0.03;
const FONT_SIZE = screenWidth * 0.05;
const ICON_SIZE = screenWidth * 0.08;
const GAP = screenWidth * 0.025;
const SIDE_MARGIN = screenWidth * 0.035;

interface SearchBarProps {
  onSearch?: (query: string) => void;
}

export default function SearchBar({ onSearch: _onSearch }: SearchBarProps) {
  const router = useRouter();

  return (
    <TouchableOpacity
      style={styles.container}
      activeOpacity={0.7}
      onPress={withLightHaptic(() => router.push('/QuickSearch'))}
    >
      <Image source={exploreIconAsset} style={styles.icon} resizeMode="contain" />
      <Text style={styles.placeholder}>Where to?</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'rgba(0,0,0,0.75)',
    borderRadius: 999,
    paddingHorizontal: H_PAD,
    paddingVertical: V_PAD,
    gap: GAP,
    backgroundColor: 'transparent',
    marginHorizontal: SIDE_MARGIN,
  },
  icon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
  },
  placeholder: {
    flex: 1,
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: FONT_SIZE,
    color: 'rgb(0, 0, 0)',
  },
});
