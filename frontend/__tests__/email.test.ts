/**
 * Tests for the sign-up / sign-in email helpers.
 *
 * WHAT THESE PIN
 *   * an address with no TLD ("alex.r@example") is rejected. A tester created a
 *     real account with exactly that address; this is the case that matters.
 *   * a TLD must be at least two letters, and there is exactly one "@" with no
 *     whitespace anywhere inside the address.
 *   * normal addresses (plus-tags, subdomains, hyphens, long TLDs, mixed case,
 *     surrounding whitespace) still pass, so the gate does not lock real users out.
 *   * normalizeEmail trims and lowercases, so the same person typing different
 *     capitalisation reaches the same account.
 *
 * WHAT THESE DO NOT COVER
 *   Whether Onboarding.tsx / SignIn.tsx actually call these before hitting
 *   Supabase, or the inline error text — that needs a component renderer this
 *   suite does not use. Deliverability (MX records, typo'd domains like
 *   "gmial.com") is out of scope for a client-side check.
 */
import { isValidEmail, normalizeEmail } from '../src/utils/email';

describe('normalizeEmail', () => {
  it('trims surrounding whitespace and lowercases', () => {
    expect(normalizeEmail('  Alex.Rivera@Example.COM \n')).toBe('alex.rivera@example.com');
  });

  it('leaves an already-normal address unchanged', () => {
    expect(normalizeEmail('alex@example.com')).toBe('alex@example.com');
  });
});

describe('isValidEmail', () => {
  it.each([
    'alex.rivera@example.com',
    'alex.r+spoton@example.com',
    'a@b.co',
    'first_last@mail.example.co.uk',
    'user@my-domain.io',
    'someone@example.museum',
    '  Alex@Example.COM  ',
    "o'brien@example.ie",
  ])('accepts %p', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each([
    ['no TLD (the tester bug)', 'alex.r@example'],
    ['truncated after the dot', 'alex.rivera@example.'],
    ['one-letter TLD', 'alex@example.c'],
    ['numeric TLD', 'alex@example.123'],
    ['missing @', 'alex.example.com'],
    ['two @', 'alex@@example.com'],
    ['two @ split', 'alex@foo@example.com'],
    ['empty local part', '@example.com'],
    ['empty domain', 'alex@'],
    ['space inside', 'alex rivera@example.com'],
    ['space in domain', 'alex@exa mple.com'],
    ['empty domain label', 'alex@example..com'],
    ['domain starts with dot', 'alex@.example.com'],
    ['label ends with hyphen', 'alex@example-.com'],
    ['local part starts with dot', '.alex@example.com'],
    ['local part ends with dot', 'alex.@example.com'],
    ['consecutive dots in local part', 'alex..r@example.com'],
    ['empty string', ''],
    ['whitespace only', '   '],
  ])('rejects %s (%p)', (_label, email) => {
    expect(isValidEmail(email)).toBe(false);
  });

  it('rejects absurdly long addresses', () => {
    expect(isValidEmail(`${'a'.repeat(250)}@example.com`)).toBe(false);
  });
});
