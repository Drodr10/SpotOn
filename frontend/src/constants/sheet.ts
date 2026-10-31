/**
 * Floating-sheet geometry shared by every pop-up sheet. The sheet is inset from
 * the left, right and bottom screen edges by the same small gap, and its corner
 * radius is concentric with the iPhone display corners (~55pt) so the curves
 * run parallel: SHEET_RADIUS = display radius - SHEET_INSET.
 */
export const SHEET_INSET = 8;
export const SHEET_RADIUS = 47;
/** Gap between the sheet's bottom edge and the screen's bottom edge. */
export const SHEET_BOTTOM = SHEET_INSET;

/** Extra bottom padding inside a sheet so content clears the home indicator. */
export function sheetBottomPad(insetBottom: number): number {
  return Math.max(insetBottom - SHEET_BOTTOM, 0);
}
