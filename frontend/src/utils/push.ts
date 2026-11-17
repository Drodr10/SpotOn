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
export async function getThisDevicePushToken(): Promise<string | null> {
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

    const { error } = await supabase
      .from('profiles')
      .update({ expo_push_token: token })
      .eq('id', user.id);
    if (error) console.log('[push] failed to save token', error.message);
    else console.log('[push] token registered');
  } catch (err) {
    console.log('[push] registration failed', err);
  }
}
