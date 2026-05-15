import * as Haptics from 'expo-haptics';

export function triggerLightHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function withLightHaptic<T extends unknown[]>(
  handler?: (...args: T) => void | Promise<void>,
) {
  return (...args: T) => {
    triggerLightHaptic();
    return handler?.(...args);
  };
}
