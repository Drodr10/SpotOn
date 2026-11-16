/**
 * One-time "List now, get paid later" intro (MenuBar + button).
 * Regression: the sheet opened on every tap.
 */
import { __resetIntroFlagsForTests, addListingIntroKey, hasSeenIntro, markIntroSeen } from '../src/utils/introFlags';

const memoryStore = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};

describe('intro flags', () => {
  beforeEach(() => __resetIntroFlagsForTests());

  it('is unseen until marked, then seen', () => {
    const store = memoryStore();
    const key = addListingIntroKey('user-1');
    expect(hasSeenIntro(key, store)).toBe(false);
    markIntroSeen(key, store);
    expect(hasSeenIntro(key, store)).toBe(true);
  });

  it('persists across app sessions via the store', () => {
    const store = memoryStore();
    const key = addListingIntroKey('user-1');
    markIntroSeen(key, store);
    __resetIntroFlagsForTests(); // simulate an app restart
    expect(hasSeenIntro(key, store)).toBe(true);
  });

  it('is per user', () => {
    const store = memoryStore();
    markIntroSeen(addListingIntroKey('user-1'), store);
    expect(hasSeenIntro(addListingIntroKey('user-2'), store)).toBe(false);
  });

  it('falls back to once per session when storage is missing or throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('disk');
      },
      setItem: () => {
        throw new Error('disk');
      },
    };
    const key = addListingIntroKey('user-1');
    expect(hasSeenIntro(key, throwing)).toBe(false);
    expect(() => markIntroSeen(key, throwing)).not.toThrow();
    expect(hasSeenIntro(key, throwing)).toBe(true);
    expect(hasSeenIntro(addListingIntroKey('user-3'), null)).toBe(false);
    markIntroSeen(addListingIntroKey('user-3'), null);
    expect(hasSeenIntro(addListingIntroKey('user-3'), null)).toBe(true);
  });
});
