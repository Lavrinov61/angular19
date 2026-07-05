/**
 * Omnichannel v2 — Core Type Definitions
 *
 * Canonical types for the unified messaging engine.
 * Designed for 1:1 Rust trait mapping (serde-compatible, no Node.js-specific types).
 */

export type ChannelType = 'telegram' | 'vk' | 'whatsapp' | 'instagram' | 'max' | 'email' | 'web';

export type MessageType =
  | 'text' | 'image' | 'video' | 'audio' | 'file'
  | 'system' | 'interactive' | 'location' | 'contact' | 'sticker';

export type DeliveryStatus = 'accepted' | 'sent' | 'delivered' | 'read' | 'failed';

export type SenderType = 'visitor' | 'operator' | 'bot' | 'system' | 'internal_note';

/**
 * Per-channel capabilities. Used by pipeline workers to skip
 * unsupported operations (e.g. markAsRead on channels that don't support it).
 */
export interface ChannelCapabilities {
  markAsRead: boolean;
  sendPhoto: boolean;
  sendFile: boolean;
  sendVideo: boolean;
  sendAudio: boolean;
  sendInlineButton: boolean;
  /** WhatsApp/Instagram 24h reply window restriction */
  replyWindow24h: boolean;
  forwardDetection: boolean;
  replyToDetection: boolean;
  /** Channel sends delivery/read receipts via status webhooks */
  statusUpdates: boolean;
  typingIndicator: boolean;
  /** Channel supports deleting sent messages */
  deleteMessage: boolean;
  /** Channel supports editing sent text messages */
  editMessage: boolean;
  /** VK: requires 2-step upload (getUploadServer → upload → save) */
  twoStepUpload: boolean;
  /** WhatsApp/Instagram: GET challenge-response verification */
  challengeResponse: boolean;
  /** VK: confirmation code handshake */
  confirmationHandshake: boolean;
  maxMediaSizeBytes: number;
  maxTextLength: number;
}

/**
 * A connected channel account with credentials stored in DB.
 * Maps to `channel_accounts` table.
 *
 * Replaces config.* singleton credential access — each adapter method
 * receives ChannelAccount explicitly (multi-tenant ready).
 */
export interface ChannelAccount {
  id: string;
  channel: ChannelType;
  name: string;
  isActive: boolean;
  credentials: Record<string, unknown>;
  rateLimitMax: number;
  rateLimitDurationMs: number;
  capabilities: ChannelCapabilities;
  tokenExpiresAt: Date | null;
  tokenRefreshedAt: Date | null;
  webhookUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/** Subset of ChannelType that represents real messenger channels (not web/email) */
export type MessengerChannelType = Exclude<ChannelType, 'web' | 'email'>;

/** All valid channel types for iteration */
export const ALL_CHANNELS: readonly ChannelType[] = [
  'telegram', 'vk', 'whatsapp', 'instagram', 'max', 'email', 'web',
] as const;

/** Messenger-only channels */
export const MESSENGER_CHANNELS: readonly MessengerChannelType[] = [
  'telegram', 'vk', 'whatsapp', 'instagram', 'max',
] as const;

/** Type guard for ChannelType */
export function isChannelType(value: string): value is ChannelType {
  return (ALL_CHANNELS as readonly string[]).includes(value);
}
