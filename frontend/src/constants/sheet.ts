import { Platform } from 'react-native';

/**
 * Floating-sheet geometry shared by every pop-up sheet. The sheet is inset from
 * the left, right and bottom screen edges by the same small gap, and its corner
 * radius is concentric with the iPhone display corners (~55pt) so the curves
 * run parallel: SHEET_RADIUS = display radius - SHEET_INSET.
 */
export const SHEET_INSET = 8;
export const SHEET_RADIUS = 47;
/**
 * Gap between the sheet's bottom edge and the screen's bottom edge (iOS).
 * Prefer `sheetBottom(insets.bottom)`, which is also correct on Android.
 */
export const SHEET_BOTTOM = SHEET_INSET;

/**
 * Extra bottom padding inside a sheet so content clears the home indicator.
 * Only meaningful for a sheet positioned at `SHEET_BOTTOM`; sheets positioned
 * with `sheetBottom()` should use `sheetContentPad()` instead.
 */
export function sheetBottomPad(insetBottom: number): number {
  return Math.max(insetBottom - SHEET_BOTTOM, 0);
}

/**
 * Distance from the screen's bottom edge to the sheet's bottom edge.
 *
 * iOS: the sheet hugs the screen corners (8pt gap) and runs *under* the home
 * indicator, which is a translucent overlay; `sheetContentPad` keeps the
 * content above it. Unchanged from the original design.
 *
 * Android (edge-to-edge): the gesture handle / 3-button bar is drawn by the
 * system on top of the app and is not part of the sheet's visual language, so
 * the sheet floats 8dp *above* the navigation bar instead of under it.
 */
export function sheetBottom(insetBottom: number): number {
  return Platform.OS === 'android' ? insetBottom + SHEET_INSET : SHEET_BOTTOM;
}

/**
 * Bottom padding inside a sheet positioned with `sheetBottom()`.
 * iOS: clears the home indicator (same value as before). Android: 0, the sheet
 * itself already sits above the navigation bar.
 */
export function sheetContentPad(insetBottom: number): number {
  return Platform.OS === 'android' ? 0 : sheetBottomPad(insetBottom);
}
