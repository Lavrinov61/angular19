/**
 * Omnichannel v2 — Email Adapter
 *
 * Implements ChannelAdapter for email channel (IMAP inbound + SMTP outbound).
 * Credentials from ChannelAccount. Wraps IMAP poller and Nodemailer.
 *
 * Unlike messenger adapters, email doesn't receive webhooks —
 * inbound is poll-based via email.imap-poller.ts.
 * The verifyWebhook/parseInbound methods are stubs (email uses poller, not webhooks).
 * Pipeline workers call fetchNewEmails() directly.
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { ChannelAdapter } from '../core/adapter.interface.js';
import type { ChannelAccount, ChannelCapabilities, MessageType } from '../core/types.js';
import type {
  ParsedMessage,
  ParsedMediaRef,
  StatusUpdate,
  SendResult,
  RawRequest,
  WebhookVerifyResult,
} from '../core/dto.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('email-adapter');

interface EmailCredentials {
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPassword: string;
  imapMailbox?: string;
  imapSecure?: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
}

function creds(account: ChannelAccount): EmailCredentials {
  return account.credentials as unknown as EmailCredentials;
}

/** Lazy transporter cache keyed by account ID */
const transporterCache = new Map<string, Transporter>();

export function closeAllTransporters(): void {
  for (const [id, transporter] of transporterCache) {
    try {
      transporter.close();
    } catch (err) {
      log.error('Failed to close transporter', { accountId: id, error: String(err) });
    }
  }
  transporterCache.clear();
}

function getTransporter(account: ChannelAccount): Transporter | null {
  const c = creds(account);
  if (!c.smtpUser || !c.smtpPassword) return null;

  const existing = transporterCache.get(account.id);
  if (existing) return existing;

  const transporter = nodemailer.createTransport({
    host: c.smtpHost,
    port: c.smtpPort,
    secure: c.smtpPort === 465,
    auth: { user: c.smtpUser, pass: c.smtpPassword },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  transporterCache.set(account.id, transporter);
  return transporter;
}

export class EmailAdapter implements ChannelAdapter {
  readonly channel = 'email' as const;

  // --- Inbound: Email doesn't use webhooks, these are stubs ---

  verifyWebhook(_req: RawRequest, _account: ChannelAccount): WebhookVerifyResult {
    // Email doesn't receive webhooks — always valid (no-op)
    return { valid: true };
  }

  extractIdempotencyKey(_body: Record<string, unknown>): string | null {
    return null;
  }

  async parseInbound(_body: Record<string, unknown>): Promise<ParsedMessage[]> {
    // Email inbound is handled by IMAP poller, not webhook parsing
    return [];
  }

  parseStatusUpdate(_body: Record<string, unknown>): StatusUpdate[] {
    // Email doesn't have delivery receipts via webhooks
    // Bounce detection is handled during IMAP polling
    return [];
  }

  isSpecialEvent(_body: Record<string, unknown>): boolean {
    return false;
  }

  async handleSpecialEvent(_body: Record<string, unknown>, _account: ChannelAccount): Promise<string | null> {
    return null;
  }

  // --- Outbound: SMTP ---

  async sendText(account: ChannelAccount, recipientEmail: string, text: string): Promise<SendResult> {
    const transporter = getTransporter(account);
    if (!transporter) {
      return { success: false, errorMessage: 'SMTP not configured' };
    }

    const c = creds(account);

    try {
      const info = await transporter.sendMail({
        from: c.smtpUser,
        to: recipientEmail,
        text,
      });

      return {
        success: true,
        externalMessageId: info.messageId || undefined,
      };
    } catch (err) {
      log.error('SMTP send failed', { to: recipientEmail, error: String(err) });
      return { success: false, errorMessage: String(err) };
    }
  }

  async sendMedia(
    account: ChannelAccount,
    recipientEmail: string,
    mediaUrl: string,
    _mediaType: MessageType,
    caption?: string,
    fileName?: string,
  ): Promise<SendResult> {
    const transporter = getTransporter(account);
    if (!transporter) {
      return { success: false, errorMessage: 'SMTP not configured' };
    }

    const c = creds(account);

    try {
      const info = await transporter.sendMail({
        from: c.smtpUser,
        to: recipientEmail,
        text: caption || '',
        attachments: [{ filename: fileName || 'attachment', path: mediaUrl }],
      });

      return {
        success: true,
        externalMessageId: info.messageId || undefined,
      };
    } catch (err) {
      log.error('SMTP send with attachment failed', { to: recipientEmail, error: String(err) });
      return { success: false, errorMessage: String(err) };
    }
  }

  /**
   * Send HTML email reply within a thread.
   * Adds In-Reply-To and References headers for proper threading.
   */
  async sendReply(
    account: ChannelAccount,
    recipientEmail: string,
    subject: string,
    htmlBody: string,
    textBody: string,
    inReplyTo?: string,
    references?: string[],
  ): Promise<SendResult> {
    const transporter = getTransporter(account);
    if (!transporter) {
      return { success: false, errorMessage: 'SMTP not configured' };
    }

    const c = creds(account);

    try {
      const headers: Record<string, string> = {};
      if (inReplyTo) headers['In-Reply-To'] = inReplyTo;
      if (references && references.length > 0) {
        headers['References'] = references.join(' ');
      }

      const info = await transporter.sendMail({
        from: c.smtpUser,
        to: recipientEmail,
        subject,
        text: textBody,
        html: htmlBody,
        headers,
      });

      return {
        success: true,
        externalMessageId: info.messageId || undefined,
      };
    } catch (err) {
      log.error('SMTP reply failed', { to: recipientEmail, subject, error: String(err) });
      return { success: false, errorMessage: String(err) };
    }
  }

  async downloadMedia(ref: ParsedMediaRef): Promise<Buffer> {
    // Email attachments are already downloaded during IMAP polling
    // This method is a stub — media is available in ParsedEmailAttachment.content
    throw new Error(`Email media download not supported via adapter. sourceRef: ${ref.sourceRef}`);
  }

  async verifyCredentials(_account: ChannelAccount): Promise<{ ok: boolean; error?: string }> {
    // Email uses SMTP/IMAP — no simple API token check.
    // Return ok:true since connectivity is verified by the IMAP poller.
    return { ok: true };
  }

  getCapabilities(): ChannelCapabilities {
    return {
      markAsRead: false,
      sendPhoto: true,
      sendFile: true,
      sendVideo: false,
      sendAudio: false,
      sendInlineButton: false,
      replyWindow24h: false,
      forwardDetection: false,
      replyToDetection: true,
      statusUpdates: false,
      typingIndicator: false,
      deleteMessage: false,
      editMessage: false,
      twoStepUpload: false,
      challengeResponse: false,
      confirmationHandshake: false,
      maxMediaSizeBytes: 25 * 1024 * 1024,
      maxTextLength: 100_000,
    };
  }
}
