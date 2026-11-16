/**
 * "Seen it once" flags for one-time intro sheets.
 *
 * Persisted in the app's existing storage: the expo-sqlite `localStorage`
 * polyfill that utils/supabase.ts installs globally (the same store the auth
 * session lives in). If that storage is missing or throws, a module-level set
 * still keeps the sheet to once per app session.
 */

type KVStore = Pick<Storage, 'getItem' | 'setItem'>;

const sessionSeen = new Set<string>();

const defaultStore = (): KVStore | null => {
  const ls = (globalThis as { localStorage?: KVStore }).localStorage;
  return ls && typeof ls.getItem === 'function' ? ls : null;
};

export const addListingIntroKey = (userId: string | null | undefined) =>
  `spoton.introSeen.addListing:${userId ?? 'anon'}`;

export function hasSeenIntro(key: string, store: KVStore | null = defaultStore()): boolean {
  if (sessionSeen.has(key)) return true;
  try {
    return store?.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function markIntroSeen(key: string, store: KVStore | null = defaultStore()): void {
  sessionSeen.add(key);
  try {
    store?.setItem(key, '1');
  } catch {
    // Session-level flag above still applies.
  }
}

/** Test-only: forget session-level flags. */
export function __resetIntroFlagsForTests(): void {
  sessionSeen.clear();
}
