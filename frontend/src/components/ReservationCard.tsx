import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Linking,
  Platform,
} from 'react-native';
import { CustomFonts } from '@/src/constants/theme';
import { MENU_BAR_HEIGHT } from '@/src/components/MenuBar';

import reservationIconAsset from '@/assets/images/reservation_icon.png';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const CARD_WIDTH   = screenWidth * 0.80;
const CARD_HEIGHT  = screenHeight * 0.50;
const CARD_RADIUS  = MENU_BAR_HEIGHT / 2;
const H_PAD        = CARD_WIDTH * 0.057;
const V_PAD        = CARD_HEIGHT * 0.05;
const ADDR_FONT    = screenWidth * 0.040;
const LOGO_SIZE    = screenWidth * 0.07;
const NAV_SIZE     = CARD_WIDTH * 0.13;
const TIMER_FONT   = screenWidth * 0.028;
const PRICE_FONT   = screenWidth * 0.028;
const PILL_PAD_H   = screenWidth * 0.024;
const PILL_PAD_V   = screenWidth * 0.010;
const IMG_RADIUS   = screenWidth * 0.022;

function formatTimeRemaining(endTime: Date): string {
  const diff = endTime.getTime() - Date.now();
  if (diff <= 0) return 'Reservation has ended.';

  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins  = Math.floor((diff % 3600000) / 60000);
  const secs  = Math.floor((diff % 60000) / 1000);

  const parts: string[] = [];
  if (days > 0)  parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0)  parts.push(`${mins} min`);
  if (days === 0 && hours === 0) parts.push(`${secs}s`);

  return `${parts.join(' ')} remaining till your parking expires.`;
}

function openMaps(address: string) {
  const encoded = encodeURIComponent(address);
  const url = Platform.select({
    ios:     `maps://maps.apple.com/?q=${encoded}`,
    android: `geo:0,0?q=${encoded}`,
    default: `https://www.google.com/maps/search/?api=1&query=${encoded}`,
  })!;
  Linking.openURL(url);
}

interface ReservationCardProps {
  address:      string;
  endTime:      Date;
  totalPrice:   number | null;
  photoUrl:     string | null;
  unavailable?: boolean;
}

export default function ReservationCard({ address, endTime, totalPrice, photoUrl }: ReservationCardProps) {
  const [timeLeft, setTimeLeft] = useState(() => formatTimeRemaining(endTime));

  useEffect(() => {
    const id = setInterval(() => setTimeLeft(formatTimeRemaining(endTime)), 1000);
    return () => clearInterval(id);
  }, [endTime]);

  return (
    <View style={[styles.card, !photoUrl && styles.cardNoImage]}>
      {/* Top row: reservation icon, address, nav arrow */}
      <View style={styles.topRow}>
        <Image source={reservationIconAsset} style={styles.logo} resizeMode="contain" />
        <Text style={styles.address} numberOfLines={1}>{address}</Text>
        <TouchableOpacity
          style={styles.navButton}
          onPress={() => openMaps(address)}
          activeOpacity={0.8}
        >
          <Text style={styles.navArrow}>↗</Text>
        </TouchableOpacity>
      </View>

      {/* Price pill */}
      {totalPrice != null && (
        <View style={styles.pricePill}>
          <Text style={styles.priceText}>${totalPrice.toFixed(2)}</Text>
        </View>
      )}

      {/* Countdown timer */}
      <Text style={styles.timer}>{timeLeft}</Text>

      {/* Listing image fills remaining card height; omitted when no photo so card autosizes */}
      {photoUrl && (
        <Image source={{ uri: photoUrl }} style={styles.image} resizeMode="cover" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width:             CARD_WIDTH,
    height:            CARD_HEIGHT,
    backgroundColor:   'rgba(220, 219, 216, 0.80)',
    borderRadius:      CARD_RADIUS,
    borderWidth:       1,
    borderColor:       '#000000',
    overflow:          'hidden',
    paddingHorizontal: H_PAD,
    paddingTop:        V_PAD,
    paddingBottom:     V_PAD,
  },
  cardNoImage: {
    height: undefined,
  },
  topRow: {
    flexDirection: 'row',
    alignItems:    'center',
    marginBottom:  CARD_HEIGHT * 0.025,
  },
  logo: {
    width:       LOGO_SIZE,
    height:      LOGO_SIZE,
    marginRight: screenWidth * 0.016,
  },
  address: {
    flex:        1,
    fontFamily:  CustomFonts.SwitzerSemibold,
    fontSize:    ADDR_FONT,
    color:       '#000000',
    marginRight: screenWidth * 0.016,
  },
  navButton: {
    width:           NAV_SIZE,
    height:          NAV_SIZE,
    borderRadius:    NAV_SIZE / 2,
    backgroundColor: '#FFFF1E',
    justifyContent:  'center',
    alignItems:      'center',
  },
  navArrow: {
    fontSize:   NAV_SIZE * 0.48,
    color:      '#000000',
    lineHeight: NAV_SIZE * 0.65,
  },
  pricePill: {
    alignSelf:         'flex-start',
    backgroundColor:   '#FFFF1E',
    borderRadius:      40,
    paddingHorizontal: PILL_PAD_H,
    paddingVertical:   PILL_PAD_V,
    marginBottom:      CARD_HEIGHT * 0.025,
  },
  priceText: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize:   PRICE_FONT,
    color:      '#000000',
  },
  timer: {
    fontFamily:   CustomFonts.SwitzerLight,
    fontSize:     TIMER_FONT,
    color:        '#000000',
    marginBottom: CARD_HEIGHT * 0.03,
    lineHeight:   TIMER_FONT * 1.55,
  },
  image: {
    flex:         1,
    borderRadius: IMG_RADIUS,
  },
});
