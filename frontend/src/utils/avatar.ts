/**
 * The signed-in user's avatar URL, shared so the Profile card and the MenuBar
 * update together the moment a new picture is chosen. profiles.avatar_url stays
 * the source of truth; this just broadcasts the latest value in-app.
 */
import { useSyncExternalStore } from 'react';

let current: string | null = null;
const listeners = new Set<() => void>();

export function setAvatarUrl(url: string | null) {
  if (url === current) return;
  current = url;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAvatarUrl(): string | null {
  return useSyncExternalStore(subscribe, () => current);
}
