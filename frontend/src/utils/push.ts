import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Show payout notifications while the app is foregrounded too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function easProjectId(): string | undefined {
  return (
    (Constants.expoConfig as any)?.extra?.eas?.projectId ??
    (Constants as any)?.easConfig?.projectId
  );
}

/**
 * This device's Expo push token, obtained exactly as
 * registerForPushNotifications obtains the one it saves, but without ever
 * prompting: null on web, without notification permission, without an EAS
 * projectId, or on any error. Used at sign-out to clear the profile's token
 * only when it is this device's (see utils/signOut.ts).
 */
// The token this device last registered, kept on the phone (expo-sqlite
// localStorage, installed by utils/supabase.ts) so sign-out can find it with
// no network and no notification permission — a lookup that fails there would
// leave the previous user's pushes arriving on a shared phone.
const CACHED_TOKEN_KEY = 'spoton.pushToken';

type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void };
const kv = (): KV | undefined => (globalThis as { localStorage?: KV }).localStorage;

export function readCachedPushToken(): string | null {
  try {
    return kv()?.getItem(CACHED_TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

function cachePushToken(token: string): void {
  try {
    kv()?.setItem(CACHED_TOKEN_KEY, token);
  } catch {
    // Storage unavailable: sign-out falls back to a live lookup.
  }
}

export async function getThisDevicePushToken(): Promise<string | null> {
  const cached = readCachedPushToken();
  if (cached) return cached;
  try {
    if (Platform.OS === 'web') return null;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return null;
    const projectId = easProjectId();
    if (!projectId) return null;
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data || null;
  } catch (err) {
    console.log('[push] could not read this device token', err);
    return null;
  }
}

/**
 * Obtain the device's Expo push token and store it on the signed-in user's
 * profile so the backend can notify them when a session ends. Fails safe:
 * on web, denied permission, or a missing EAS projectId it just logs and
 * returns — the in-app payout banner remains the working channel until the
 * EAS project + APNs credentials are configured (see plan Part A).
 */
export async function registerForPushNotifications(): Promise<void> {
  try {
    if (Platform.OS === 'web') return;

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') {
      console.log('[push] permission not granted');
      return;
    }

    const projectId = easProjectId();
    if (!projectId) {
      console.log('[push] no EAS projectId configured; skipping token registration');
      return;
    }

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !token) return;
    cachePushToken(token);

    // claim_push_token (20261116190000) saves the token on this user AND
    // removes it from any other profile, so one phone never delivers another
    // person's notifications. Falls back to a plain update on a database that
    // doesn't have the function yet.
    const claimed = await supabase.rpc('claim_push_token', { p_token: token });
    let error = claimed.error;
    if (error && /claim_push_token|function|schema cache/i.test(error.message)) {
      error = (await supabase.from('profiles').update({ expo_push_token: token }).eq('id', user.id)).error;
    }
    if (error) console.log('[push] failed to save token', error.message);
    else console.log('[push] token registered');
  } catch (err) {
    console.log('[push] registration failed', err);
  }
}
