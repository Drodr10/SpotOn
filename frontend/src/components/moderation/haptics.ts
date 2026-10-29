/**
 * Moderation-specific haptics. The shared light/selection helpers live in
 * src/utils/haptics.ts and are re-exported so callers import from one place;
 * the two extra feels (destructive confirm, success) are only used here.
 */
import * as Haptics from 'expo-haptics';

export { triggerLightHaptic, triggerSelectionHaptic } from '@/src/utils/haptics';

/** A destructive action committed (block / unblock confirm). */
export function triggerDestructiveHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** An operation succeeded (report received). */
export function triggerSuccessHaptic() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** An operation failed. */
export function triggerErrorHaptic() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}
