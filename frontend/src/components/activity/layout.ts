import { Dimensions } from 'react-native';

/**
 * Screen-relative sizing shared by Activity / Seller Account / Activity Details.
 * The Figma frames are 147px wide; ratios below are taken from them
 * (e.g. card 131/147 ≈ 0.89 of the screen) and tuned to the app's existing
 * Switzer/Bevellier type scale.
 */
const { width: screenWidth } = Dimensions.get('window');

export const SW = screenWidth;
export const H_PAD = SW * 0.055;
export const CARD_W = SW - H_PAD * 2;
export const SECTION_GAP = SW * 0.045;
export const CARD_GAP = SW * 0.035;

export const HEADER_H = SW * 0.125;

export const INK = '#000000';
export const PAPER = '#DCDBD8';
