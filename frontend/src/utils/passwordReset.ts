/**
 * Pure logic for the "Forgot password?" flow (app/ResetPassword.tsx) and the
 * "email already in use" branch of sign-up (app/Onboarding.tsx).
 *
 * The flow is a 6-digit email code, not a link: the app has no deep-link
 * handling for auth, and a code works the same on every mail client.
 *
 *   email ──resetPasswordForEmail──▶ code ──verifyOtp(recovery)──▶ password ──updateUser──▶ signed in
 *
 * verifyOtp signs the user in, so the password step already has a session.
 * The code is single-use: once verified, going back can't return to the code
 * step, so it goes all the way back to the email step (the screen signs the
 * half-finished recovery session out when it does).
 *
 * Nothing here may reveal whether an account exists for an email: the
 * confirmation after step 1 is the same either way, and errors that only an
 * existing account can produce are not surfaced as such.
 */

export type ResetStep = 'email' | 'code' | 'password';

/** Matches [auth.email] otp_length in supabase/config.toml. */
export const RESET_CODE_LENGTH = 6;

/** Matches [auth] minimum_password_length in supabase/config.toml and the
 *  "at least 6 characters" sign-up message. */
export const MIN_PASSWORD_LENGTH = 6;

/** Seconds before "Resend code" can be tapped again. */
export const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Where Android system back (and the on-screen back pill) goes from each step.
 * null = leave the screen.
 *   email    → leave
 *   code     → email (to fix a typo'd address)
 *   password → email (the code is spent; a new one is needed)
 */
export function previousResetStep(step: ResetStep): ResetStep | null {
  switch (step) {
    case 'email':
      return null;
    case 'code':
    case 'password':
      return 'email';
  }
}

/** Neutral confirmation shown after step 1, whether or not the account exists. */
export function codeSentMessage(email: string): string {
  return `If an account exists for ${email}, we sent a 6-digit code. It expires in 1 hour.`;
}

/** Digits only, at most RESET_CODE_LENGTH: tolerates a pasted "123 456" or "123-456". */
export function sanitizeResetCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, RESET_CODE_LENGTH);
}

export function isCompleteResetCode(raw: string): boolean {
  return sanitizeResetCode(raw).length === RESET_CODE_LENGTH;
}

/** Whole seconds left before a resend is allowed (0 = allowed now). */
export function resendSecondsLeft(
  sentAtMs: number | null,
  nowMs: number,
  cooldownSeconds: number = RESEND_COOLDOWN_SECONDS,
): number {
  if (sentAtMs == null) return 0;
  const left = Math.ceil((sentAtMs + cooldownSeconds * 1000 - nowMs) / 1000);
  return Math.max(0, left);
}

/** Validate the new password + confirmation. Returns an error message, or null when OK. */
export function validateNewPassword(password: string, confirm: string): string | null {
  if (!password || !confirm) return 'Please fill in both fields.';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirm) return "Passwords don't match.";
  return null;
}

// ── Error mapping ────────────────────────────────────────────────────────────
// supabase-js AuthError carries `code` (e.g. "otp_expired"), `status` (HTTP)
// and `name` ("AuthRetryableFetchError" when the request never got an answer).

type AuthErrorLike = { code?: string; status?: number; name?: string; message?: string } | null | undefined;

const RATE_LIMIT_MESSAGE = 'Too many attempts — try again in a few minutes.';
const NETWORK_MESSAGE = "Couldn't reach SpotOn. Check your connection and try again.";

function isRateLimited(err: AuthErrorLike): boolean {
  return (
    err?.status === 429 ||
    err?.code === 'over_email_send_rate_limit' ||
    err?.code === 'over_request_rate_limit'
  );
}

function isNetworkError(err: AuthErrorLike): boolean {
  return err?.name === 'AuthRetryableFetchError' || err?.status === 0;
}

/**
 * Step 1 (send code). Returns the message to show, or null to carry on to the
 * code step as if the email was sent.
 *
 * Anything other than rate limiting or no connection is swallowed on purpose:
 * Supabase only tries to send mail for an existing account, so a send failure
 * would tell a stranger the account exists.
 */
export function describeSendCodeError(err: AuthErrorLike): string | null {
  if (!err) return null;
  // over_email_send_rate_limit only happens for an EXISTING account (Supabase
  // returns 200 straight away for unknown emails), so showing it would reveal
  // that the account exists. Treat it as sent: the earlier code is still valid
  // and the code screen offers Resend after its cooldown.
  if (err.code === 'over_email_send_rate_limit') return null;
  if (isRateLimited(err)) return RATE_LIMIT_MESSAGE;
  if (isNetworkError(err)) return NETWORK_MESSAGE;
  return null;
}

/** Step 2 (verify code). Supabase answers a wrong code and an expired one identically. */
export function describeVerifyError(err: AuthErrorLike): string {
  if (isRateLimited(err)) return RATE_LIMIT_MESSAGE;
  if (isNetworkError(err)) return NETWORK_MESSAGE;
  return 'That code is wrong or has expired. Check your latest email, or tap Resend code.';
}

/** Step 3 (set new password). */
export function describeUpdatePasswordError(err: AuthErrorLike): string {
  if (isNetworkError(err)) return NETWORK_MESSAGE;
  if (isRateLimited(err)) return RATE_LIMIT_MESSAGE;
  if (err?.code === 'same_password') return 'That’s your current password. Choose a new one.';
  if (err?.code === 'weak_password') {
    // The hosted project may require more than length (digits, symbols…), so
    // don't claim length is the only rule.
    return `That password is too weak. Use at least ${MIN_PASSWORD_LENGTH} characters and mix letters and numbers.`;
  }
  if (err?.code === 'session_not_found' || err?.code === 'session_expired' || err?.status === 401) {
    return 'Your reset session expired. Go back and request a new code.';
  }
  return err?.message || 'Something went wrong. Please try again.';
}

/** Sign-up failed because the email already has an account. */
export function isEmailInUseError(err: AuthErrorLike): boolean {
  if (!err) return false;
  if (err.code === 'user_already_exists' || err.code === 'email_exists') return true;
  return /already (been )?registered|already in use/i.test(err.message ?? '');
}
