/**
 * Omnichannel v2 — Data Transfer Objects
 *
 * Boundary DTOs for adapter ↔ pipeline communication.
 * Plain types (string, boolean, Record) → serde structs in Rust.
 */

import type { MessageType, DeliveryStatus } from './types.js';

/**
 * Reference to a media file that needs downloading.
 * Each channel has its own download mechanism:
 * - Telegram: file_id → getFile API → temporary URL
 * - WhatsApp: media_id → Graph API resolve → Bearer-authenticated URL
 * - VK/Max/Instagram: direct CDN URL
 */
export interface ParsedMediaRef {
  /** URL, file_id, or media_id depending on sourceType */
  sourceRef: string;
  sourceType: 'url' | 'telegram_file_id' | 'whatsapp_media_id' | 'max_token';
  /** Best-guess MIME from the channel's metadata */
  mimeHint: string;
  fileName?: string;
  /** The adapter's best guess at media type (may be reclassified by media-processor) */
  mediaTypeHint: MessageType;
}

/**
 * Structured message parsed from a raw webhook payload.
 * Replaces the old IncomingMessage interface — adds media[] array
 * instead of single attachmentUrl string.
 */
export interface ParsedMessage {
  externalMessageId: string;
  externalChatId: string;
  externalUserId: string;
  userName: string;
  username?: string;
  phone?: string;
  content: string;
  messageType: MessageType;
  /** Multiple media attachments (1:N). Empty array = text-only. */
  media?: ParsedMediaRef[];
  replyToExternalId?: string;
  isForwarded: boolean;
  forwardedFromName?: string;
  /** Telegram media_group_id — messages in the same album share this ID */
  mediaGroupId?: string;
  /** Original webhook payload for debugging (stored in webhook_events, not in messages) */
  rawEvent?: Record<string, unknown>;
}

/**
 * Delivery/read receipt from a channel's status webhook.
 * Inserted into message_statuses table and used to update
 * messages.delivery_status denormalized field.
 */
export interface StatusUpdate {
  externalMessageId: string;
  status: DeliveryStatus;
  timestamp: Date;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Result of a send operation (text or media).
 * On success, externalMessageId is the platform's message identifier.
 */
export interface SendResult {
  success: boolean;
  externalMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  retryAfter?: number;
}

/**
 * Raw HTTP request passed to adapter for webhook verification.
 * Decoupled from Express req — Rust-compatible (axum::extract).
 */
export interface RawRequest {
  body: Record<string, unknown>;
  headers: Record<string, string>;
  rawBody?: string;
  ip?: string;
  query?: Record<string, string>;
}

/**
 * Result of webhook verification.
 * - `valid: true` → proceed with parsing
 * - `challengeResponse` → return this string as HTTP response (WhatsApp/Instagram GET)
 * - `confirmationCode` → return this string as HTTP response (VK confirmation handshake)
 */
export interface WebhookVerifyResult {
  valid: boolean;
  challengeResponse?: string;
  confirmationCode?: string;
}
