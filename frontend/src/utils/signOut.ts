import { supabase } from './supabase';
import { getThisDevicePushToken } from './push';

// Long enough for a normal round trip, short enough that a dead network never
// leaves the user staring at a sign-out that doesn't happen.
export const PUSH_TOKEN_CLEAR_TIMEOUT_MS = 3000;

/**
 * Forget this device's push token on the user's profile. The backend sends
 * booking and payout pushes to profiles.expo_push_token, so without this a
 * shared phone keeps receiving the previous user's notifications after they
 * sign out. Must run BEFORE signOut: the update needs the session.
 *
 * Only clears the column if it still holds THIS device's token. The profile
 * keeps one token (the last device to register), so signing out on phone A
 * must not wipe phone B's registration. The match is part of the UPDATE's
 * WHERE, so it is atomic with the write. If this device's token can't be
 * determined (no permission, no projectId, web, error) nothing is cleared:
 * a device that can't get a token never registered one.
 *
 * Best-effort: never throws and never waits longer than the timeout.
 */
export async function clearPushTokenForSignOut(
  timeoutMs: number = PUSH_TOKEN_CLEAR_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const clear = (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;
      const deviceToken = await getThisDevicePushToken();
      if (!deviceToken) return;
      const { error } = await supabase
        .from('profiles')
        .update({ expo_push_token: null })
        .eq('id', userId)
        .eq('expo_push_token', deviceToken);
      if (error) console.log('[signOut] could not clear push token', error.message);
    })().catch((err) => {
      // Caught here, not only below: after a timeout nobody awaits this.
      console.log('[signOut] could not clear push token', err);
    });
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([clear, timeout]);
  } catch (err) {
    console.log('[signOut] could not clear push token', err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Clear the push token (best-effort), then sign out. */
export async function signOutAndForgetDevice(): Promise<void> {
  await clearPushTokenForSignOut();
  await supabase.auth.signOut();
}
