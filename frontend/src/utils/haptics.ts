import * as Haptics from 'expo-haptics';

export function triggerLightHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** Picker / stepped value changes (e.g. vertical price scrollers). */
export function triggerSelectionHaptic() {
  Haptics.selectionAsync().catch(() => {});
}

export function withLightHaptic<T extends unknown[]>(
  handler?: (...args: T) => void | Promise<void>,
) {
  return (...args: T) => {
    triggerLightHaptic();
    return handler?.(...args);
  };
}
