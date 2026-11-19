import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { supabase } from './supabase';

/**
 * Decide at launch whether the user is signed in, from the session persisted on
 * this device, not from a round trip to Supabase.
 *
 * Launching with Supabase unreachable used to land on the Welcome screen as if
 * signed out: the old check (`getClaims()`) needs the network for this
 * project's tokens, and any failure read as "no session". Now:
 *   - a stored session that hasn't expired → signed in (no network needed);
 *   - an expired one whose refresh failed only because the network is down →
 *     still signed in. supabase-js keeps the stored session in that case and
 *     its auto-refresh retries once the network is back;
 *   - no stored session, or a refresh the server actually rejected (revoked,
 *     user deleted; supabase-js removes the session then) → signed out.
 *
 * getSession() only touches the network to refresh an expired stored session,
 * so if it hasn't answered within `timeoutMs` a stored session exists and the
 * server is just slow/unreachable → signed in (a hanging request must not
 * leave the user on a blank launch screen either).
 *
 * Never throws.
 */
export const LAUNCH_SESSION_TIMEOUT_MS = 5000;

export async function hasPersistedSession(
  timeoutMs: number = LAUNCH_SESSION_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = (async () => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (data?.session) return true;
      return isAuthRetryableFetchError(error);
    } catch (err) {
      return isAuthRetryableFetchError(err);
    }
  })();
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), timeoutMs);
  });
  try {
    return await Promise.race([check, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
