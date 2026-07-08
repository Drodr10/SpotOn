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

    const projectId =
      (Constants.expoConfig as any)?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;
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
