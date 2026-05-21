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

const { width: screenWidth } = Dimensions.get('window');
const CARD_WIDTH  = screenWidth * 0.84;
const CARD_RADIUS = screenWidth * 0.038;
const H_PAD       = screenWidth * 0.034;
const V_PAD       = screenWidth * 0.030;
const IMG_HEIGHT  = CARD_WIDTH * 0.44;
const IMG_RADIUS  = screenWidth * 0.022;
const ADDR_FONT   = screenWidth * 0.040;
const TIMER_FONT  = screenWidth * 0.030;
const PRICE_FONT  = screenWidth * 0.028;
const NAV_SIZE    = screenWidth * 0.062;
const PILL_PAD_H  = screenWidth * 0.024;
const PILL_PAD_V  = screenWidth * 0.012;

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
  // Only show seconds when under an hour to keep the line readable on long reservations.
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

export default function ReservationCard({ address, endTime, totalPrice, photoUrl, unavailable }: ReservationCardProps) {
  const [timeLeft, setTimeLeft] = useState(() => formatTimeRemaining(endTime));

  useEffect(() => {
    const id = setInterval(() => setTimeLeft(formatTimeRemaining(endTime)), 1000);
    return () => clearInterval(id);
  }, [endTime]);

  return (
    <View style={styles.card}>
      {/* Address row + price + nav arrow */}
      <View style={styles.topRow}>
        <Text style={styles.address} numberOfLines={1}>{address}</Text>
        <View style={styles.topRight}>
          {totalPrice != null && (
            <View style={styles.pricePill}>
              <Text style={styles.priceText}>${totalPrice.toFixed(2)}</Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.navButton}
            onPress={() => openMaps(address)}
            activeOpacity={0.8}
            disabled={unavailable}
          >
            <Text style={styles.navArrow}>↗</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Countdown timer */}
      <Text style={styles.timer}>{timeLeft}</Text>

      {/* Listing image */}
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={[styles.image, styles.imageFallback]}>
          {unavailable && (
            <Text style={styles.imageFallbackText}>Listing unavailable</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width:             CARD_WIDTH,
    backgroundColor:   '#000000',
    borderRadius:      CARD_RADIUS,
    paddingHorizontal: H_PAD,
    paddingTop:        V_PAD,
    paddingBottom:     V_PAD,
  },
  topRow: {
    flexDirection:  'row',
    alignItems:     'center',
    marginBottom:   screenWidth * 0.014,
  },
  address: {
    flex:        1,
    fontFamily:  CustomFonts.SwitzerSemibold,
    fontSize:    ADDR_FONT,
    color:       '#FFFFFF',
    marginRight: 8,
  },
  topRight: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           screenWidth * 0.018,
  },
  pricePill: {
    backgroundColor:   '#FFFF1E',
    borderRadius:      40,
    paddingHorizontal: PILL_PAD_H,
    paddingVertical:   PILL_PAD_V,
    justifyContent:    'center',
    alignItems:        'center',
  },
  priceText: {
    fontFamily: CustomFonts.BevellierMedium,
    fontSize:   PRICE_FONT,
    color:      '#000000',
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
  timer: {
    fontFamily:   CustomFonts.SwitzerLight,
    fontSize:     TIMER_FONT,
    color:        '#FFFFFF',
    marginBottom: V_PAD,
    lineHeight:   TIMER_FONT * 1.55,
  },
  image: {
    width:        '100%',
    height:       IMG_HEIGHT,
    borderRadius: IMG_RADIUS,
  },
  imageFallback: {
    backgroundColor: '#333333',
    justifyContent:  'center',
    alignItems:      'center',
  },
  imageFallbackText: {
    fontFamily: CustomFonts.SwitzerLight,
    fontSize:   screenWidth * 0.032,
    color:      '#AAAAAA',
  },
});
