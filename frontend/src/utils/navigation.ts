/**
 * Small navigation helpers shared by screens.
 *
 * - `safeBack(fallback)`: `router.back()` when there is somewhere to go back
 *   to, otherwise `router.replace(fallback)`. A bare `router.back()` is a no-op
 *   (dev warning, stuck screen) when the screen was opened from a deep link,
 *   a notification, or after a `replace`, because the stack is empty.
 * - `useHardwareBack(handler)`: Android system back (button or edge swipe)
 *   while the screen is focused. Return true to consume the event (e.g. step a
 *   multi-step flow back one step), false to let the navigator pop the route.
 *   No-op on iOS, which has no system back.
 */
import { useCallback, useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';

export function safeBack(fallback: Href = '/Homescreen') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

export function useHardwareBack(handler: () => boolean) {
  // Latest handler in a ref so the listener is registered once per focus and
  // doesn't jump above overlay handlers (pickers, menus) registered later.
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => ref.current());
      return () => sub.remove();
    }, []),
  );
}
