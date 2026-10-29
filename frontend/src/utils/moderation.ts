/**
 * Reporting + blocking (App Store Guideline 1.2).
 *
 * Everything here talks to Supabase directly as the signed-in user; the rules
 * that make it safe (who can read/write which rows, and refusing messages
 * between blocked users) live in the database — see
 * supabase/migrations/20261029120000_add_reports_and_blocks.sql.
 *
 * Every function throws an `Error` whose message is safe to show to the user.
 * Callers decide how to surface it (inline text, Alert, ...).
 */
import { supabase } from './supabase';

export type BlockStatus = 'none' | 'blocked_by_me' | 'blocked_by_them';

const GENERIC_ERROR = "Something went wrong. Please check your connection and try again.";

async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getClaims();
  const id = data?.claims?.sub;
  if (!id) throw new Error('Please sign in again to continue.');
  return id;
}

function clean(text?: string | null, max = 2000): string | null {
  const t = (text ?? '').trim();
  return t ? t.slice(0, max) : null;
}

// ─── Reports ────────────────────────────────────────────────────────────────

export interface ReportUserInput {
  userId: string;
  reason: string;
  details?: string;
  /** The conversation the report was filed from, if any (gives the team context). */
  conversationId?: string;
}

export async function reportUser(input: ReportUserInput): Promise<void> {
  const reporterId = await requireUserId();
  if (input.userId === reporterId) throw new Error("You can't report yourself.");

  const { error } = await supabase.from('reports').insert({
    reporter_id: reporterId,
    reported_user_id: input.userId,
    conversation_id: input.conversationId ?? null,
    reason: input.reason.slice(0, 100),
    details: clean(input.details),
  });
  if (error) {
    console.warn('[moderation] reportUser failed', error);
    throw new Error(GENERIC_ERROR);
  }
}

export interface ReportListingInput {
  listingId: string;
  reason: string;
  details?: string;
}

export async function reportListing(input: ReportListingInput): Promise<void> {
  const reporterId = await requireUserId();

  const { error } = await supabase.from('reports').insert({
    reporter_id: reporterId,
    listing_id: input.listingId,
    reason: input.reason.slice(0, 100),
    details: clean(input.details),
  });
  if (error) {
    console.warn('[moderation] reportListing failed', error);
    throw new Error(GENERIC_ERROR);
  }
}

// ─── Blocks ─────────────────────────────────────────────────────────────────

/** Idempotent: blocking someone you already blocked is a no-op, not an error. */
export async function blockUser(blockedUserId: string): Promise<void> {
  const blockerId = await requireUserId();
  if (blockedUserId === blockerId) throw new Error("You can't block yourself.");

  const { error } = await supabase
    .from('user_blocks')
    .upsert(
      { blocker_id: blockerId, blocked_id: blockedUserId },
      { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true },
    );
  if (error) {
    console.warn('[moderation] blockUser failed', error);
    throw new Error(GENERIC_ERROR);
  }
}

export async function unblockUser(blockedUserId: string): Promise<void> {
  const blockerId = await requireUserId();

  const { error } = await supabase
    .from('user_blocks')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedUserId);
  if (error) {
    console.warn('[moderation] unblockUser failed', error);
    throw new Error(GENERIC_ERROR);
  }
}

/**
 * Block state between the signed-in user and `otherUserId`, in both directions.
 * Resolved server-side because RLS only lets a user see blocks they created.
 * Fails open to 'none' on error: the send trigger is the real enforcement, so
 * a lookup hiccup must not lock anyone out of a conversation.
 */
export async function getBlockStatus(otherUserId: string): Promise<BlockStatus> {
  const { data, error } = await supabase.rpc('get_block_status', {
    p_other: otherUserId,
  });
  if (error) {
    console.warn('[moderation] getBlockStatus failed', error);
    return 'none';
  }
  return data === 'blocked_by_me' || data === 'blocked_by_them' ? data : 'none';
}

/** True when a block exists between you and `otherUserId`, either direction. */
export async function isBlocked(otherUserId: string): Promise<boolean> {
  return (await getBlockStatus(otherUserId)) !== 'none';
}

/** Ids of everyone the signed-in user has blocked. Empty on error (fail open). */
export async function fetchBlockedIds(): Promise<Set<string>> {
  const { data, error } = await supabase.from('user_blocks').select('blocked_id');
  if (error) {
    console.warn('[moderation] fetchBlockedIds failed', error);
    return new Set();
  }
  return new Set((data ?? []).map((r: { blocked_id: string }) => r.blocked_id));
}

/** True when a message insert was rejected by the database block trigger. */
export function isMessagingBlockedError(
  error: { message?: string } | null | undefined,
): boolean {
  return !!error?.message && error.message.includes('messaging_blocked');
}
