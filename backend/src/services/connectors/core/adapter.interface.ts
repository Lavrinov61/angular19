/**
 * Omnichannel v2 — ChannelAdapter Interface
 *
 * Replaces MessengerConnector with explicit credential passing,
 * multi-media support, status updates, and special event handling.
 *
 * Maps 1:1 to Rust trait:
 * ```rust
 * #[async_trait]
 * trait ChannelAdapter: Send + Sync {
 *     fn channel(&self) -> ChannelType;
 *     fn verify_webhook(&self, req: &RawRequest, account: &ChannelAccount) -> WebhookVerifyResult;
 *     async fn parse_inbound(&self, body: &Value, headers: &HeaderMap, account: Option<&ChannelAccount>) -> Vec<ParsedMessage>;
 *     async fn send_text(&self, account: &ChannelAccount, chat_id: &str, text: &str) -> SendResult;
 *     async fn download_media(&self, ref_: &ParsedMediaRef, account: &ChannelAccount) -> Bytes;
 *     fn capabilities(&self) -> ChannelCapabilities;
 * }
 * ```
 */

import type { Readable } from 'stream';
import type { ChannelType, ChannelAccount, ChannelCapabilities, MessageType } from './types.js';
import type {
  ParsedMessage,
  ParsedMediaRef,
  StatusUpdate,
  SendResult,
  RawRequest,
  WebhookVerifyResult,
} from './dto.js';

export interface ChannelAdapter {
  readonly channel: ChannelType;

  // --- Inbound ---

  /** Verify webhook authenticity (HMAC, secret token, etc.) */
  verifyWebhook(req: RawRequest, account: ChannelAccount): WebhookVerifyResult;

  /** Extract a unique key for webhook deduplication (e.g. update_id for Telegram) */
  extractIdempotencyKey(body: RawRequest['body']): string | null;

  /** Parse raw webhook body into structured messages */
  parseInbound(
    body: RawRequest['body'],
    headers: RawRequest['headers'],
    account?: ChannelAccount,
  ): Promise<ParsedMessage[]>;

  /** Expand truncated webhook body before parsing (e.g. VK is_cropped → messages.getById). */
  expandBody?(body: RawRequest['body'], account: ChannelAccount): Promise<RawRequest['body']>;

  /** Enrich parsed messages with resolved user names (e.g. VK API lookup). */
  enrichUserNames?(messages: ParsedMessage[], account: ChannelAccount): Promise<void>;

  /** Parse delivery/read status updates from webhook body */
  parseStatusUpdate(body: RawRequest['body']): StatusUpdate[];

  // --- Special events ---

  /** Check if this webhook is a non-message event (e.g. VK message_allow, TG callback_query) */
  isSpecialEvent(body: RawRequest['body']): boolean;

  /** Handle special event. Returns response body string or null. */
  handleSpecialEvent(body: RawRequest['body'], account: ChannelAccount): Promise<string | null>;

  // --- Outbound ---

  /** Send a text message. Returns platform's message ID on success. */
  sendText(account: ChannelAccount, chatId: string, text: string, replyToExternalId?: string): Promise<SendResult>;

  /** Send media (photo, file, video, audio) with optional caption. */
  sendMedia(
    account: ChannelAccount,
    chatId: string,
    mediaUrl: string,
    mediaType: MessageType,
    caption?: string,
    fileName?: string,
    replyToExternalId?: string,
    inlineKeyboard?: Array<Array<{ text: string; url?: string; callback_data?: string }>>,
  ): Promise<SendResult>;

  /** Send text with an inline URL button (Telegram, VK, Max). Optional — not all channels support. */
  sendWithInlineButton?(
    account: ChannelAccount,
    chatId: string,
    text: string,
    buttonLabel: string,
    buttonUrl: string,
  ): Promise<SendResult>;

  // --- Media ---

  /** Download media from external source. Channel-specific logic (file_id, Graph API, CDN). */
  downloadMedia(ref: ParsedMediaRef, account: ChannelAccount): Promise<Buffer>;

  /** Streaming download — returns a Readable instead of buffering the entire file in memory. */
  downloadMediaStream?(ref: ParsedMediaRef, account: ChannelAccount): Promise<Readable>;

  // --- Lifecycle ---

  /** Delete a previously sent message (where supported). */
  deleteMessage?(account: ChannelAccount, chatId: string, externalMessageId: string): Promise<SendResult>;

  /** Edit a previously sent text message (where supported). */
  editMessageText?(account: ChannelAccount, chatId: string, externalMessageId: string, newText: string): Promise<SendResult>;

  /** Send read receipt to the channel (where supported). */
  markAsRead?(account: ChannelAccount, chatId: string, messageId?: string): Promise<void>;

  /** Send typing indicator to show the operator is composing a message. */
  sendTypingIndicator?(account: ChannelAccount, chatId: string): Promise<void>;

  /** Send welcome message on first contact. */
  sendWelcome?(account: ChannelAccount, chatId: string): Promise<void>;

  /** Return channel capabilities for pipeline decision-making. */
  getCapabilities(): ChannelCapabilities;

  /** Active health probe: verify that credentials are still valid by calling the platform API. */
  verifyCredentials(account: ChannelAccount): Promise<{ ok: boolean; error?: string }>;

  /** Ensure webhook is correctly registered for this channel (e.g. Telegram setWebhook). */
  ensureWebhook?(account: ChannelAccount, baseUrl: string): Promise<void>;
}
