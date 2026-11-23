/**
 * Email helpers shared by the sign-up and sign-in screens.
 *
 * Supabase Auth accepts addresses like "alex.r@example" (no TLD), which created
 * real accounts nobody can receive mail at. This is a pragmatic client-side
 * gate, not RFC 5322: it rejects the typos people actually make and lets every
 * normal address through.
 */

/** Trim surrounding whitespace and lowercase, so "  Alex@Example.COM " and
 *  "alex@example.com" are the same account. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// local@domain.tld — exactly one "@", no whitespace anywhere, a non-empty
// local part, a domain made of dot-separated labels (no empty labels, no
// leading/trailing hyphen), and a final TLD of at least two letters.
const EMAIL_RE =
  /^[^\s@]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

/** True when `raw` (after normalizing) looks like a deliverable address. */
export function isValidEmail(raw: string): boolean {
  const email = normalizeEmail(raw);
  if (email.length > 254) return false;
  if (!EMAIL_RE.test(email)) return false;
  const local = email.slice(0, email.indexOf('@'));
  // Dots may not start, end, or repeat in the local part.
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  return true;
}
