import { Dimensions } from 'react-native';

const { width: screenWidth } = Dimensions.get('window');

/**
 * Shared sizing for the Homescreen banner family (Payout, Upcoming
 * Reservation, Too Far) so they render at identical height/thickness and
 * corner curvature — radius matched to what ReservationInfoCard uses on the
 * Settings / Your Reservations screens.
 */
export const BANNER_SIDE_MARGIN = screenWidth * 0.035;
export const BANNER_RADIUS = screenWidth * 0.076;
export const BANNER_HEIGHT = screenWidth * 0.19;
export const BANNER_H_PAD = screenWidth * 0.05;
