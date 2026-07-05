/**
 * Omnichannel v2 — Contact Resolver
 *
 * Resolves unified contacts for incoming messages.
 * Wraps contact.service.ts findOrCreateContact + channel_users upsert.
 *
 * Returns the contact and links it to the conversation + channel_users.
 */

import db from '../../../database/db.js';
import { findOrCreateContact, findPotentialDuplicates } from '../../contact.service.js';
import type { Contact } from '../../contact.service.js';
import type { ChannelType } from '../core/types.js';
import type { ParsedMessage } from '../core/dto.js';
import { linkContact } from './conversation-manager.js';
import { createLogger } from '../../../utils/logger.js';
import { logIdentityLinkEvent } from '../../identity-link-audit.service.js';

const log = createLogger('contact-resolver');

export interface ResolvedContact {
  contact: Contact;
  isNew: boolean;
  duplicates: Array<{ id: string; display_name: string | null; phone: string | null }>;
}

interface ChannelUserLinkRow {
  id: string;
  user_id: string | null;
  contact_id: string | null;
  external_user_id: string;
}

interface ConversationIdentityRow {
  id: string;
  user_id: string | null;
  contact_id: string | null;
  channel: string | null;
  external_chat_id: string | null;
  visitor_id: string | null;
}

/**
 * Resolve a unified contact for an incoming message.
 *
 * 1. findOrCreateContact (by phone → channel_users link → create new)
 * 2. Upsert channel_users
 * 3. Link contact to conversation
 * 4. Detect duplicates for merge suggestions
 */
export async function resolveContact(
  channel: ChannelType,
  msg: ParsedMessage,
  conversationId: string,
  preResolvedContact?: Contact,
): Promise<ResolvedContact> {
  // 1. Find or create unified contact
  const contact = preResolvedContact ?? await findOrCreateContact({
    phone: msg.phone,
    displayName: msg.userName,
    source: channel,
    externalUserId: msg.externalUserId,
    channel,
  });

  const isNew = (Date.now() - new Date(contact.first_seen_at).getTime()) < 10_000;

  // 2. Upsert channel_users + propagate user_id to conversation
  try {
    await upsertChannelUserAndLinkAccount(channel, msg, contact.id, contact.user_id, conversationId);
  } catch (err) {
    log.warn('upsertChannelUserAndLinkAccount failed', { channel, error: String(err) });
  }

  // 3. Link contact to conversation
  try {
    await linkContact(conversationId, contact.id);
  } catch (err) {
    log.warn('linkContact failed', { conversationId, contactId: contact.id, error: String(err) });
  }

  // 4. Detect duplicates for newly created phoneless contacts
  let duplicates: ResolvedContact['duplicates'] = [];
  if (isNew && !contact.phone && contact.display_name) {
    try {
      duplicates = await findPotentialDuplicates(contact.id);
    } catch (err) {
      log.warn('findPotentialDuplicates failed', { contactId: contact.id, error: String(err) });
    }
  }

  return { contact, isNew, duplicates };
}

/**
 * Upsert channel_users row for an incoming message.
 * Links external_user_id to contact_id for future lookups.
 * If channel_user already has a linked user_id, propagates it to the conversation.
 */
async function upsertChannelUserAndLinkAccount(
  channel: ChannelType,
  msg: ParsedMessage,
  contactId: string,
  contactUserId: string | null,
  conversationId: string,
): Promise<void> {
  const channelUserBefore = await db.queryOne<ChannelUserLinkRow>(
    `SELECT id, user_id, contact_id, external_user_id
     FROM channel_users
     WHERE channel = $1 AND external_user_id = $2`,
    [channel, msg.externalUserId],
  );

  const rows = await db.query<ChannelUserLinkRow>(
    `INSERT INTO channel_users (
       channel, external_user_id, display_name, username, phone, contact_id, user_id, verified_at, linked_by
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       CASE WHEN $7::uuid IS NULL THEN NULL ELSE NOW() END,
       CASE WHEN $7::uuid IS NULL THEN NULL ELSE 'phone_match' END
     )
     ON CONFLICT (channel, external_user_id) DO UPDATE SET
       display_name = COALESCE(EXCLUDED.display_name, channel_users.display_name),
       username = COALESCE(EXCLUDED.username, channel_users.username),
       phone = COALESCE(EXCLUDED.phone, channel_users.phone),
       contact_id = COALESCE(channel_users.contact_id, EXCLUDED.contact_id),
       user_id = COALESCE(channel_users.user_id, EXCLUDED.user_id),
       verified_at = CASE
         WHEN channel_users.user_id IS NULL AND EXCLUDED.user_id IS NOT NULL THEN NOW()
         ELSE channel_users.verified_at
       END,
       linked_by = CASE
         WHEN channel_users.user_id IS NULL AND EXCLUDED.user_id IS NOT NULL THEN 'phone_match'
         ELSE channel_users.linked_by
       END,
       last_seen_at = NOW()
     RETURNING id, user_id, contact_id, external_user_id`,
    [channel, msg.externalUserId, msg.userName, msg.username || null, msg.phone || null, contactId, contactUserId],
  );
  const channelUser = rows[0];

  if (channelUser?.user_id && channelUserBefore?.user_id !== channelUser.user_id) {
    await logIdentityLinkEvent({
      action: 'identity_auto_link',
      source: 'channel_user_upsert',
      entityType: 'channel_user',
      entityId: channelUser.id,
      contactId: channelUser.contact_id,
      channel,
      previousUserId: channelUserBefore?.user_id ?? null,
      newUserId: channelUser.user_id,
      reason: contactUserId ? 'contact_user_id_propagated_to_channel_user' : 'channel_user_existing_link',
      result: 'linked',
      metadata: { channelExternalUserId: channelUser.external_user_id },
    });
  }

  // If channel_user is linked to a user account, propagate to conversation
  const linkedUserId = channelUser?.user_id;
  if (linkedUserId) {
    const conversationBefore = await db.queryOne<ConversationIdentityRow>(
      `SELECT id, user_id, contact_id, channel, external_chat_id, visitor_id
       FROM conversations WHERE id = $1`,
      [conversationId],
    );
    const updatedConversations = await db.query<ConversationIdentityRow>(
      `UPDATE conversations SET user_id = $1, updated_at = NOW()
       WHERE id = $2 AND user_id IS NULL
       RETURNING id, user_id, contact_id, channel, external_chat_id, visitor_id`,
      [linkedUserId, conversationId],
    );
    const updatedConversation = updatedConversations[0];
    if (updatedConversation) {
      await logIdentityLinkEvent({
        action: 'identity_link_chat',
        source: 'channel_user_propagation',
        entityType: 'conversation',
        entityId: updatedConversation.id,
        conversationId: updatedConversation.id,
        contactId: updatedConversation.contact_id,
        channel: updatedConversation.channel,
        externalChatId: updatedConversation.external_chat_id,
        visitorId: updatedConversation.visitor_id,
        previousUserId: conversationBefore?.user_id ?? null,
        newUserId: linkedUserId,
        reason: 'channel_user_linked_user_id',
        result: 'linked',
        metadata: { channelExternalUserId: rows[0]?.external_user_id ?? null },
      });
    } else {
      await logIdentityLinkEvent({
        action: 'identity_link_skipped',
        source: 'channel_user_propagation',
        entityType: 'conversation',
        entityId: conversationId,
        conversationId,
        contactId: conversationBefore?.contact_id ?? contactId,
        channel: conversationBefore?.channel ?? channel,
        externalChatId: conversationBefore?.external_chat_id ?? null,
        visitorId: conversationBefore?.visitor_id ?? null,
        previousUserId: conversationBefore?.user_id ?? null,
        newUserId: linkedUserId,
        reason: 'conversation_already_linked_or_missing',
        result: 'skipped',
        metadata: { channelExternalUserId: rows[0]?.external_user_id ?? null },
      });
    }
  }
}
