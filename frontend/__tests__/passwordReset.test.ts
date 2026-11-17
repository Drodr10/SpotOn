/**
 * Tests for the password-reset flow logic (utils/passwordReset.ts).
 *
 * WHAT THESE PIN
 *   * the step-1 result never depends on whether the account exists: any send
 *     error other than rate limiting / no connection is swallowed and the
 *     neutral "If an account exists…" confirmation is shown. Supabase only
 *     tries to mail existing accounts, so surfacing a send failure would leak
 *     that the account exists. This is the one that matters most.
 *   * rate limiting (429 / over_email_send_rate_limit / over_request_rate_limit)
 *     gets the friendly "Too many attempts" copy on every step.
 *   * back from the password step goes to the email step, not the code step:
 *     a recovery code is single-use, so the code step would be a dead end.
 *   * codes tolerate pasted separators, and the resend cooldown counts down
 *     from 60s to 0.
 *   * the new-password minimum matches supabase/config.toml (6) and the
 *     sign-up message.
 *   * "email already in use" is detected by Supabase's error code, with the
 *     old message match as a fallback.
 *
 * WHAT THESE DO NOT COVER
 *   The screen itself (ResetPassword.tsx): calling Supabase, the auto-verify
 *   on the 6th digit, signing an abandoned recovery session out, Android back
 *   handling — that needs a component renderer this suite does not use, and
 *   was verified by hand on iOS and Android against a local Supabase. The
 *   email template ({{ .Token }}) is Supabase config, not app code.
 */
import {
  MIN_PASSWORD_LENGTH,
  RESEND_COOLDOWN_SECONDS,
  RESET_CODE_LENGTH,
  codeSentMessage,
  describeSendCodeError,
  describeUpdatePasswordError,
  describeVerifyError,
  isCompleteResetCode,
  isEmailInUseError,
  previousResetStep,
  resendSecondsLeft,
  sanitizeResetCode,
  validateNewPassword,
} from '../src/utils/passwordReset';

const RATE_LIMIT = /too many attempts/i;
const NETWORK = /couldn't reach spoton/i;

describe('previousResetStep', () => {
  it('leaves the screen from the email step', () => {
    expect(previousResetStep('email')).toBeNull();
  });

  it('goes from the code step back to the email step', () => {
    expect(previousResetStep('code')).toBe('email');
  });

  it('skips the spent code step when backing out of the password step', () => {
    expect(previousResetStep('password')).toBe('email');
  });
});

describe('codeSentMessage', () => {
  it('is conditional ("if an account exists"), never a confirmation of the account', () => {
    const msg = codeSentMessage('alex@example.com');
    expect(msg).toMatch(/^If an account exists for alex@example\.com/);
    expect(msg).toMatch(/6-digit code/);
  });
});

describe('describeSendCodeError', () => {
  it('returns null (carry on) on success', () => {
    expect(describeSendCodeError(null)).toBeNull();
  });

  it('treats the per-account send limit as sent, so it can\'t reveal that the account exists', () => {
    expect(describeSendCodeError({ status: 429, code: 'over_email_send_rate_limit' })).toBeNull();
  });

  it.each([
    { status: 429, code: 'over_request_rate_limit' },
    { status: 429 },
  ])('maps rate limiting %p to friendly copy', (err) => {
    expect(describeSendCodeError(err)).toMatch(RATE_LIMIT);
  });

  it('reports a request that never got an answer as a connection problem', () => {
    expect(describeSendCodeError({ name: 'AuthRetryableFetchError', status: 0 })).toMatch(NETWORK);
  });

  it.each([
    { status: 500, code: 'unexpected_failure', message: 'Error sending recovery email' },
    { status: 422, code: 'user_not_found' },
    { status: 400, code: 'validation_failed', message: 'whatever' },
  ])('swallows %p so the result cannot reveal whether the account exists', (err) => {
    expect(describeSendCodeError(err)).toBeNull();
  });
});

describe('describeVerifyError', () => {
  it('gives one message for a wrong or expired code (Supabase does not distinguish)', () => {
    const msg = describeVerifyError({ status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' });
    expect(msg).toMatch(/wrong or has expired/);
    expect(msg).toMatch(/Resend code/);
  });

  it('maps rate limiting and network failures', () => {
    expect(describeVerifyError({ status: 429, code: 'over_request_rate_limit' })).toMatch(RATE_LIMIT);
    expect(describeVerifyError({ name: 'AuthRetryableFetchError', status: 0 })).toMatch(NETWORK);
  });
});

describe('describeUpdatePasswordError', () => {
  it('explains reusing the current password', () => {
    expect(describeUpdatePasswordError({ status: 422, code: 'same_password' })).toMatch(/current password/);
  });

  it('maps weak_password to the minimum length', () => {
    expect(describeUpdatePasswordError({ status: 422, code: 'weak_password' })).toBe(
      `That password is too weak. Use at least ${MIN_PASSWORD_LENGTH} characters and mix letters and numbers.`,
    );
  });

  it('tells the user to request a new code when the recovery session is gone', () => {
    expect(describeUpdatePasswordError({ status: 401 })).toMatch(/request a new code/);
    expect(describeUpdatePasswordError({ status: 403, code: 'session_not_found' })).toMatch(/request a new code/);
  });

  it('falls back to the server message, then a generic one', () => {
    expect(describeUpdatePasswordError({ status: 400, message: 'Odd thing' })).toBe('Odd thing');
    expect(describeUpdatePasswordError({ status: 400 })).toMatch(/something went wrong/i);
  });
});

describe('reset code input', () => {
  it('is 6 digits, matching otp_length in supabase/config.toml', () => {
    expect(RESET_CODE_LENGTH).toBe(6);
  });

  it('strips separators and whitespace from a pasted code', () => {
    expect(sanitizeResetCode(' 123 456 ')).toBe('123456');
    expect(sanitizeResetCode('123-456')).toBe('123456');
  });

  it('caps at 6 digits', () => {
    expect(sanitizeResetCode('1234567')).toBe('123456');
  });

  it('is complete only at 6 digits', () => {
    expect(isCompleteResetCode('12345')).toBe(false);
    expect(isCompleteResetCode('123 456')).toBe(true);
    expect(isCompleteResetCode('abcdef')).toBe(false);
  });
});

describe('resendSecondsLeft', () => {
  const sent = 1_000_000;

  it('allows a resend before anything was sent', () => {
    expect(resendSecondsLeft(null, sent)).toBe(0);
  });

  it('starts at the full 60s cooldown', () => {
    expect(RESEND_COOLDOWN_SECONDS).toBe(60);
    expect(resendSecondsLeft(sent, sent)).toBe(60);
  });

  it('rounds partial seconds up so it never shows 0s while still locked', () => {
    expect(resendSecondsLeft(sent, sent + 59_001)).toBe(1);
  });

  it('reaches 0 at the end of the cooldown and stays there', () => {
    expect(resendSecondsLeft(sent, sent + 60_000)).toBe(0);
    expect(resendSecondsLeft(sent, sent + 600_000)).toBe(0);
  });
});

describe('validateNewPassword', () => {
  it('requires both fields', () => {
    expect(validateNewPassword('', 'abcdef')).toMatch(/both fields/);
    expect(validateNewPassword('abcdef', '')).toMatch(/both fields/);
  });

  it('enforces the 6-character minimum from supabase/config.toml', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(6);
    expect(validateNewPassword('abcde', 'abcde')).toBe('Password must be at least 6 characters.');
    expect(validateNewPassword('abcdef', 'abcdef')).toBeNull();
  });

  it('requires the confirmation to match', () => {
    expect(validateNewPassword('abcdef', 'abcdeg')).toBe("Passwords don't match.");
  });
});

describe('isEmailInUseError', () => {
  it('detects Supabase error codes', () => {
    expect(isEmailInUseError({ status: 422, code: 'user_already_exists', message: 'User already registered' })).toBe(true);
    expect(isEmailInUseError({ status: 422, code: 'email_exists' })).toBe(true);
  });

  it('falls back to the message when there is no code', () => {
    expect(isEmailInUseError({ message: 'User already registered' })).toBe(true);
    expect(isEmailInUseError({ message: 'A user with this email address has already been registered' })).toBe(true);
  });

  it('ignores other sign-up errors', () => {
    expect(isEmailInUseError(null)).toBe(false);
    expect(isEmailInUseError({ status: 422, code: 'weak_password', message: 'Password should be at least 6 characters.' })).toBe(false);
  });
});
