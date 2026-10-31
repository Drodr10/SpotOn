/**
 * ChatActionsMenu — the dropdown under the chat's name pill (Figma 724:54, node 787:210).
 * The implementation now lives in the shared PillMenu; this file keeps Chat's
 * existing import surface (default component, ChatMenuItem, MENU_OVERHANG).
 */
import { DETACH_GAP, PillMenuPanel, pillMenuOverhang, type PillMenuItem } from '@/src/components/PillMenu';

export type ChatMenuItem = PillMenuItem;

/**
 * How far the panel hangs below the pill (two rows + padding). Android clips touch
 * hit-testing to a parent's bounds, so the pill wrapper and header must be given this
 * much extra (cancelled out with a negative margin) or the panel's rows can't be tapped.
 */
export const MENU_OVERHANG = pillMenuOverhang(2) + DETACH_GAP;

export default PillMenuPanel;
