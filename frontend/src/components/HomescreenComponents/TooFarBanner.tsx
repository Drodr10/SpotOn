import { ImageBackground, StyleSheet, Text, View, Dimensions } from 'react-native';
import { CustomFonts } from '@/src/constants/theme';

import tooFarBg from '@/assets/images/too_far_background.avif';

const { width: screenWidth } = Dimensions.get('window');

const SIDE_MARGIN = screenWidth * 0.035;
const DEFAULT_RADIUS = screenWidth * 0.07;
const V_PAD = screenWidth * 0.035;
const H_PAD = screenWidth * 0.05;
const FONT = screenWidth * 0.034;

interface TooFarBannerProps {
  /** Override corner radius (e.g. 999 to match a fully-rounded pill). */
  radius?: number;
  /** Skip the default horizontal margin — caller controls width. */
  fullWidth?: boolean;
}

export default function TooFarBanner({ radius = DEFAULT_RADIUS, fullWidth }: TooFarBannerProps = {}) {
  return (
    <View style={[!fullWidth && { marginHorizontal: SIDE_MARGIN }]}>
      <ImageBackground
        source={tooFarBg}
        style={[styles.container, { borderRadius: radius }]}
        imageStyle={{ borderRadius: radius }}
        resizeMode="cover"
      >
        <View style={[styles.scrim, { borderRadius: radius }]} />
        <Text style={styles.text}>
          Looks like you’re pretty far! Here are the closest locations we could find.
        </Text>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    paddingHorizontal: H_PAD,
    paddingVertical: V_PAD,
    justifyContent: 'center',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  text: {
    fontFamily: CustomFonts.SwitzerSemibold,
    fontSize: FONT,
    color: '#FFFFFF',
    textAlign: 'right',
  },
});
