/**
 * Find-or-create a conversation between a renter and an owner.
 *
 * Lifted from the original `priceOverview` Message Owner button logic in
 * `search.tsx`. Used by both the booking view (post-payment routing) and the
 * existing message-owner flow.
 */
import { supabase } from './supabase';

export interface ConversationLookupResult {
  conversationId: string;
  ownerName: string;
}

/**
 * Find existing conversation for (renter, owner) or insert one. Returns its id
 * plus the owner's display name (queried from `profiles`).
 *
 * Throws on unrecoverable error so callers can surface a useful Alert.
 */
export async function findOrCreateConversation(
  renterId: string,
  ownerId: string,
): Promise<ConversationLookupResult> {
  const { data: existing, error: findError } = await supabase
    .from('conversations')
    .select('id')
    .eq('renter_id', renterId)
    .eq('owner_id', ownerId)
    .maybeSingle();

  if (findError) throw new Error(findError.message);

  let conversationId: string;
  if (existing) {
    conversationId = existing.id;
  } else {
    const { data: created, error: insertError } = await supabase
      .from('conversations')
      .insert({ renter_id: renterId, owner_id: ownerId })
      .select('id')
      .single();
    if (insertError || !created) {
      throw new Error(insertError?.message ?? 'Could not create conversation');
    }
    conversationId = created.id;
  }

  const { data: ownerProfile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', ownerId)
    .single();

  return {
    conversationId,
    ownerName: ownerProfile?.full_name ?? 'Owner',
  };
}

/**
 * Insert an auto-generated booking-confirmation message into a conversation.
 * Marked auto-generated so it's easy to find / tweak later.
 */
export async function insertBookingConfirmationMessage(
  conversationId: string,
  senderId: string,
  body: string,
): Promise<void> {
  // Auto-generated booking confirmation message — see search.tsx booking view.
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_id: senderId,
    content: body,
  });
  await supabase
    .from('conversations')
    .update({ last_message: body, updated_at: new Date().toISOString() })
    .eq('id', conversationId);
}
