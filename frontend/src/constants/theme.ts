/**
 * Reusable colors and theme for the app.
 * - Palette: brand/semantic colors used everywhere (same in light & dark).
 * - Colors: theme-aware (light vs dark) for text, background, tint, etc.
 */

import { Platform } from 'react-native';

/** Shared colors — use these for brand, buttons, status, etc. */
export const Palette = {
  black: '#28282B',
  white: '#F5F5F5',
  chalkgrey: '#DCDBD8',
} as const;

const tintColorLight = Palette.black;
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

/** Custom font family names (loaded in _layout.tsx). Use with fontFamily: Fonts.SwitzerLight etc. */
export const CustomFonts = {
  SwitzerLight: 'SwitzerLight',
  SwitzerSemibold: 'SwitzerSemibold',
} as const;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
    ...CustomFonts,
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
    ...CustomFonts,
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    ...CustomFonts,
  },
});
