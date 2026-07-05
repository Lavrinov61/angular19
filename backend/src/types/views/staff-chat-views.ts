/** View types for staff-chat (team internal messaging). */

import type StaffConversations from '../generated/public/StaffConversations.js';
import type { StaffConversationsId } from '../generated/public/StaffConversations.js';
import type StaffMessages from '../generated/public/StaffMessages.js';
import type { StaffMessagesId } from '../generated/public/StaffMessages.js';
import type { UsersId } from '../generated/public/Users.js';

// Re-export branded IDs
export type { StaffConversationsId } from '../generated/public/StaffConversations.js';
export type { StaffMessagesId } from '../generated/public/StaffMessages.js';

// ── Conversations ──────────────────────────────────────────────────────────

export interface StaffConversationFull extends StaffConversations {
  unread_count?: number;
  participants?: unknown;
}

export interface StaffConversationId {
  id: StaffConversationsId;
}

export interface StaffConversationType {
  type: 'direct' | 'group' | 'general';
}

// ── Messages ───────────────────────────────────────────────────────────────

export interface StaffMessageFull extends StaffMessages {
  reactions?: unknown;
}

export interface StaffMessageReply {
  content: string | null;
  sender_name: string | null;
  message_type: string | null;
  attachment_url: string | null;
  original_filename: string | null;
}

export interface StaffMessageWithReplyMedia extends StaffMessageFull {
  reply_to_message_type?: string | null;
  reply_to_attachment_url?: string | null;
  reply_to_original_filename?: string | null;
}

export interface StaffMessageSearch extends StaffMessageFull {
  rank: number;
}

export interface StaffAttachmentMessage {
  id: StaffMessagesId;
  conversation_id: StaffConversationsId;
  content: string;
  message_type: string | null;
  attachment_url: string | null;
  original_filename: string | null;
}

// ── Participants ───────────────────────────────────────────────────────────

export interface StaffConversationParticipantRole {
  role: string;
}

export interface StaffConversationParticipantUserId {
  user_id: UsersId;
}

export interface StaffParticipantDetail {
  user_id: UsersId;
  role: string;
  muted_until: string | null;
  left_at: string | null;
  display_name: string | null;
  email: string;
}

export interface StaffParticipantExists {
  user_id: UsersId;
  left_at: string | null;
}

// ── Reactions ──────────────────────────────────────────────────────────────

export interface StaffReactionGroup {
  emoji: string;
  users: string[];
  count: number;
}

// ── Utility shapes ─────────────────────────────────────────────────────────

export interface StaffSenderId {
  sender_id: UsersId;
  created_at?: string | null;
  deleted_at?: string | null;
}

export interface HasOlder {
  has_older: boolean;
}
