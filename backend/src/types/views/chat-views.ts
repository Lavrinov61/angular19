/** View types for chat domain — composed from Kanel + JSONB contracts. */

import type Conversations from '../generated/public/Conversations.js';
import type { ConversationsId } from '../generated/public/Conversations.js';
import type Contacts from '../generated/public/Contacts.js';
import type Messages from '../generated/public/Messages.js';
import type { MessagesId } from '../generated/public/Messages.js';
import type { MediaAttachmentsId } from '../generated/public/MediaAttachments.js';
import type { WebhookEventsId } from '../generated/public/WebhookEvents.js';
import type ChatQuickReplies from '../generated/public/ChatQuickReplies.js';
import type { ConversationMetadata } from '../jsonb/conversation-jsonb.js';
import type { SessionContext } from '../jsonb/conversation-jsonb.js';
import type { MessageMetadata } from '../jsonb/message-metadata.js';

// Re-export branded IDs
export type { ConversationsId } from '../generated/public/Conversations.js';
export type { MessagesId } from '../generated/public/Messages.js';

// ── Conversations ──────────────────────────────────────────────────────────

/** Conversation channel info for operator panel. */
export interface ConversationChannel {
  channel: Conversations['channel'];
  source: string | null;
  metadata: ConversationMetadata | null;
  visitor_name: string | null;
  visitor_phone: string | null;
  status: string | null;
  assigned_operator_id: string | null;
}

/** Conversation metadata projection. */
export interface ConversationMetadataRow {
  metadata: ConversationMetadata | null;
  external_chat_id: string | null;
}

/** Telegram chat id resolved from conversation metadata. */
export interface TelegramChatIdLookup {
  chat_id: Conversations['external_chat_id'];
}

/** Conversation status projection. */
export type ConversationStatus = Pick<Conversations, 'id' | 'assigned_operator_id' | 'status'>;

/** Existing Telegram conversation lookup for subscription gate. */
export type TelegramSubscriptionGateConversationRow = Pick<Conversations, 'id'>;

/** Conversation AI-mode mutation result. */
export interface ConversationAiModeMutationRow {
  ai_agent_mode: string;
}

/** Contact lookup for current authenticated chat session. */
export interface ChatCurrentContactRow {
  id: Contacts['id'];
}

/** Current authenticated web conversation projection. */
export interface ChatCurrentConversationRow {
  id: Conversations['id'];
  status: Conversations['status'];
  channel: Conversations['channel'];
  contact_id: Conversations['contact_id'];
  user_id: Conversations['user_id'];
  created_at: string | Date | null;
  updated_at: string | Date | null;
}

/** Conversation ownership projection for authenticated web chat routes. */
export interface ChatOwnedConversationRow {
  id: Conversations['id'];
  contact_id: Conversations['contact_id'];
  channel: Conversations['channel'];
  status: Conversations['status'];
  created_at: string | null;
  updated_at: string | null;
  user_id: Contacts['user_id'] | null;
}

/** Unread message count projection. */
export interface ChatUnreadCountRow {
  count: string;
}

/** CSAT eligibility projection. */
export interface ChatSessionCsatRow {
  id: Conversations['id'];
  status: Conversations['status'];
  csat_score: Conversations['csat_score'];
}

/** Read receipt message id projection. */
export interface ChatReadMessageRow {
  id: Messages['id'];
  client_message_id?: Messages['client_message_id'];
}

// ── Messages ───────────────────────────────────────────────────────────────

/** Message row with JSONB metadata override. */
export interface MessageRow {
  id: MessagesId;
  conversation_id: ConversationsId;
  sender_type: string;
  sender_name: string | null;
  content: string;
  message_type: string | null;
  metadata: MessageMetadata | null;
  created_at: string | null;
}

/** CTE result: INSERT INTO messages RETURNING * + virtual attachment_url from media_attachments. */
export interface MessageInsertRow extends Pick<Messages,
  'id' | 'conversation_id' | 'sender_type' | 'sender_name' | 'message_type' |
  'content' | 'client_message_id' | 'is_read' | 'delivery_status' | 'created_at'
> {
  metadata: MessageMetadata | null;
  attachment_url: string | null;
}

/** Media processing result lookup (media-worker). */
export interface MediaReadyLookup {
  conversation_id: ConversationsId;
  attachment_url: string | null;
  message_type: Messages['message_type'];
}

/** Media attachment insert result. */
export interface MediaAttachmentIdRow {
  id: MediaAttachmentsId;
}

/** Message delivery status lookup (status-worker). */
export interface MessageDeliveryLookup {
  id: MessagesId;
  conversation_id: ConversationsId;
  delivery_status: Messages['delivery_status'];
  created_at: Messages['created_at'];
}

/** Telegram booking confirmation callback lookup. */
export interface TelegramBookingCallbackRow {
  client_phone: string | null;
  service_name: string | null;
  booking_date: string | null;
  booking_time: string | null;
  client_telegram_chat_id: string | null;
}

/** Webhook event inserted when Telegram subscription gate replays a pending message. */
export interface TelegramSubscriptionGateWebhookEventRow {
  id: WebhookEventsId;
}

// ── Quick Replies ──────────────────────────────────────────────────────────

export type QuickReplyRow = Pick<ChatQuickReplies, 'id' | 'title' | 'content' | 'category' | 'sort_order' | 'is_active' | 'created_by' | 'created_at'>;

// ── Search ─────────────────────────────────────────────────────────────────

export interface ChatSearchResult {
  id: MessagesId;
  content: string;
  sender_name: string;
  sender_type: string;
  created_at: string | null;
}

// ── Utility shapes ─────────────────────────────────────────────────────────

export interface AssignedOperator {
  assigned_operator_id: string | null;
}

export interface OrderNum {
  num: string;
}

export interface MediaAttachmentUrl {
  attachment_url: string;
}

export interface BookingRow {
  id: string;
  start_time: string;
  status: string;
  service_name: string;
}

// ── Conversation Adapter (v1→v2 migration) ──────────────────────────────

/** Full conversation row for adapter layer. */
export interface ConversationFullRow extends Pick<Conversations,
  'id' | 'channel' | 'account_id' | 'external_chat_id' | 'contact_id' |
  'user_id' | 'visitor_id' | 'visitor_name' | 'visitor_phone' | 'visitor_email' |
  'status' | 'assigned_operator_id' | 'source' | 'message_count' | 'unread_count' |
  'last_message_content' | 'last_message_at' | 'first_response_at' |
  'context' | 'metadata' | 'created_at' | 'updated_at' | 'closed_at' |
  'legacy_session_id' | 'entry_context'
> {}

/** Admin chat session projection with CRM/client enrichments. */
export interface ChatAdminSessionRow extends ConversationFullRow {
  assigned_operator_name: string | null;
  client_name: string | null;
  client_phone: string | null;
  client_last_seen_at: string | null;
  client_purchases_count?: number;
  booking_service: string | null;
  booking_date: string | null;
  booking_status: string | null;
  last_message?: string | null;
  subscription?: unknown;
}

/** Message row with all fields for adapter INSERT RETURNING. */
export interface MessageFullRow extends Pick<Messages,
  'id' | 'conversation_id' | 'sender_type' | 'sender_id' | 'sender_name' |
  'message_type' | 'content' | 'external_message_id' | 'client_message_id' |
  'is_read' | 'delivery_status' | 'created_at' | 'metadata'
> {
  attachment_url: string | null;
}

/** Admin message projection with attachment/reply enrichments. */
export interface ChatAdminMessageRow {
  id: string;
  conversation_id: string;
  sender_type: string;
  sender_name: string | null;
  message_type: string | null;
  content: string | null;
  metadata: MessageMetadata | string | null;
  attachment_url: string | null;
  created_at: string;
  is_read: boolean | null;
  read_at: string | null;
  delivered_at: string | null;
  reply_to_message_id: string | null;
  is_forwarded: boolean | null;
  forwarded_from_name: string | null;
  pinned_at: string | null;
  pinned_by: string | null;
  reply_to_content?: string | null;
  reply_to_sender_name?: string | null;
  original_file_name: string | null;
  original_mime_type: string | null;
  all_media: unknown;
  interactive?: MessageMetadata['interactive'];
  is_previous_session?: boolean;
}

/** Shared privacy/ownership projection for conversation and legacy visitor session rows. */
export interface ChatResourcePrivacyRow {
  id: string;
  is_private: boolean | null;
  assigned_operator_id: string | null;
  status?: string | null;
}

/** Paginated message history result. */
export interface MessageHistoryPage {
  messages: MessageFullRow[];
  hasOlder: boolean;
  hasNewer: boolean;
  total: number;
}

/** Conversations list result. */
export interface ConversationsListResult {
  conversations: ConversationFullRow[];
  total: number;
}

/** UUID resolution result from resolve_conversation_id(). */
export interface ResolvedId {
  id: string | null;
}

/** Source message row for forward endpoint (messages + virtual attachment_url). */
export interface ForwardSourceMessage extends Pick<Messages,
  'id' | 'content' | 'message_type' | 'sender_name' | 'conversation_id'
> {
  attachment_url: string | null;
}

/** Forwarded message INSERT result (RETURNING *). */
export interface ForwardedMessageRow extends Pick<Messages,
  'id' | 'conversation_id' | 'sender_type' | 'sender_id' | 'sender_name' |
  'message_type' | 'content' | 'is_forwarded' | 'forwarded_from_name' | 'created_at'
> {
  attachment_url: string | null;
}

/** Operator name lookup. */
export interface OperatorNameRow {
  display_name: string | null;
  email: string;
}

export interface PinnedMessageRow {
  id: string;
  pinned_at: string | null;
}
