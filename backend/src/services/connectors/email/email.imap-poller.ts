/**
 * Omnichannel v2 — Email IMAP Poller
 *
 * Polling-based IMAP inbound for the unified messaging engine.
 * Writes to conversations/messages/media_attachments (v2 tables).
 *
 * Credentials from ChannelAccount (not config singleton).
 */

import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail, type Attachment } from 'mailparser';
import sanitizeHtml from 'sanitize-html';
import { v4 as uuidv4 } from 'uuid';
import type { ChannelAccount } from '../core/types.js';
import { getAccountByChannel } from '../core/account-store.js';
import { resolveThreadConversation, generateThreadId } from './email.thread-resolver.js';
import { fixMimeCharset } from '../../../utils/charset-utils.js';
import { storageService } from '../../storage.service.js';
import { mimeToExt, detectMimeFromBuffer } from '../../../utils/mime-utils.js';
import { broadcastNewMessage } from '../pipeline/broadcast.js';
import type { MessageRow } from '../pipeline/broadcast.js';
import { broadcastToRoom } from '../../../websocket/broadcast-to-room.js';
import type { ConversationRow } from '../pipeline/conversation-manager.js';
import { findOrCreateContact } from '../../contact.service.js';
import db from '../../../database/db.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('email-imap-poller');

export interface ImapCredentials {
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPassword: string;
  imapMailbox?: string;
  imapSecure?: boolean;
}

export interface ParsedEmail {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  fromAddress: string;
  fromName: string;
  toAddress: string;
  ccAddresses: string[];
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: ParsedEmailAttachment[];
  isBounce: boolean;
  rawSource: Buffer | null;
  imapUid: number;
  date: Date;
}

export interface ParsedEmailAttachment {
  content: Buffer;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentId: string | null;
  contentDisposition: string;
}

function extractImapCreds(raw: Record<string, unknown>): ImapCredentials {
  return {
    imapHost: String(raw['imapHost'] || ''),
    imapPort: Number(raw['imapPort'] || 993),
    imapUser: String(raw['imapUser'] || ''),
    imapPassword: String(raw['imapPassword'] || ''),
    imapMailbox: raw['imapMailbox'] ? String(raw['imapMailbox']) : undefined,
    imapSecure: raw['imapSecure'] !== false,
  };
}

function extractEmail(addr: string | undefined | null): string {
  if (!addr) return '';
  const match = addr.match(/<([^>]+)>/);
  return match ? match[1].trim() : addr.trim();
}

function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowVulnerableTags: true,
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'img', 'style', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
      'caption', 'colgroup', 'col', 'center', 'span', 'div', 'font',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      '*': ['style', 'class', 'id', 'dir', 'lang'],
      img: ['src', 'alt', 'width', 'height', 'title'],
      a: ['href', 'target', 'rel', 'title'],
      td: ['colspan', 'rowspan', 'align', 'valign', 'width', 'height', 'bgcolor'],
      th: ['colspan', 'rowspan', 'align', 'valign', 'width', 'height', 'bgcolor'],
      table: ['cellpadding', 'cellspacing', 'border', 'width', 'bgcolor', 'align'],
      font: ['color', 'size', 'face'],
    },
    allowedSchemes: ['https', 'http', 'data', 'cid'],
    allowedSchemesByTag: {
      img: ['https', 'http', 'data', 'cid'],
    },
  });
}

interface EnvelopeShape {
  messageId?: string;
  inReplyTo?: string;
  from?: Array<{ address?: string; name?: string }>;
  to?: Array<{ address?: string; name?: string }>;
  cc?: Array<{ address?: string; name?: string }>;
  subject?: string;
  date?: Date;
}

/**
 * Fetch new emails from IMAP mailbox since lastSeenUid.
 * Returns parsed emails ready for the inbound pipeline.
 */
export async function fetchNewEmails(
  account: ChannelAccount,
  sinceUid: number,
): Promise<{ emails: ParsedEmail[]; newLastSeenUid: number }> {
  const c = extractImapCreds(account.credentials);
  if (!c.imapUser || !c.imapPassword) {
    return { emails: [], newLastSeenUid: sinceUid };
  }

  const client = new ImapFlow({
    host: c.imapHost,
    port: c.imapPort,
    secure: c.imapSecure !== false,
    auth: { user: c.imapUser, pass: c.imapPassword },
    logger: false,
    tls: { rejectUnauthorized: false },
  });

  const results: ParsedEmail[] = [];
  let newUid = sinceUid;

  try {
    await client.connect();
    const mailbox = await client.mailboxOpen(c.imapMailbox || 'INBOX', { readOnly: false });

    if (mailbox.exists === 0) {
      await client.logout();
      return { emails: [], newLastSeenUid: sinceUid };
    }

    const searchCriteria = sinceUid > 0
      ? { uid: `${sinceUid + 1}:*` }
      : { all: true };

    // Fetch envelopes first (lightweight)
    const envelopes: Array<{ uid: number; envelope: EnvelopeShape }> = [];

    for await (const msg of client.fetch(searchCriteria, { uid: true, envelope: true })) {
      if (!msg.envelope) continue;
      const env: EnvelopeShape = {
        messageId: msg.envelope.messageId,
        inReplyTo: msg.envelope.inReplyTo,
        from: msg.envelope.from,
        to: msg.envelope.to,
        cc: msg.envelope.cc,
        subject: msg.envelope.subject,
        date: msg.envelope.date,
      };
      envelopes.push({ uid: msg.uid, envelope: env });
    }

    // On first run: only last 50
    const toProcess = sinceUid === 0 ? envelopes.slice(-50) : envelopes;

    for (const msg of toProcess) {
      if (msg.uid <= sinceUid) continue;

      const fromAddr = msg.envelope.from?.[0];
      const fromEmail = extractEmail(fromAddr?.address);
      const fromName = fromAddr?.name || fromEmail;
      const toAddr = msg.envelope.to?.[0];
      const toEmail = extractEmail(toAddr?.address);
      const ccAddresses = (msg.envelope.cc || []).map(a => extractEmail(a.address)).filter(Boolean);
      const subject = msg.envelope.subject || '(без темы)';
      const messageId = msg.envelope.messageId || null;
      const inReplyTo = msg.envelope.inReplyTo || null;

      // Fetch full source for MIME parsing
      let bodyText: string | null = null;
      let bodyHtml: string | null = null;
      let attachments: ParsedEmailAttachment[] = [];
      let rawSource: Buffer | null = null;

      try {
        const sourceMsg = await client.fetchOne(String(msg.uid), { source: true }, { uid: true });
        // fetchOne returns source property when { source: true } is requested; returns false if not found
        const sourceBuffer = sourceMsg && typeof sourceMsg === 'object' && 'source' in sourceMsg && Buffer.isBuffer(sourceMsg.source) ? sourceMsg.source : undefined;

        if (sourceBuffer) {
          rawSource = sourceBuffer;
          const fixedSource = fixMimeCharset(sourceBuffer);
          const parsed: ParsedMail = await simpleParser(fixedSource);
          bodyText = parsed.text?.slice(0, 50000) || null;
          bodyHtml = parsed.html ? sanitizeEmailHtml(parsed.html) : null;
          attachments = (parsed.attachments || []).map((att: Attachment) => ({
            content: att.content,
            filename: att.filename || 'attachment',
            mimeType: att.contentType || 'application/octet-stream',
            sizeBytes: att.size || att.content.length,
            contentId: att.contentId?.replace(/[<>]/g, '') || null,
            contentDisposition: att.contentDisposition || (att.contentId ? 'inline' : 'attachment'),
          }));
        }
      } catch (err) {
        log.error('Body fetch/parse failed', { uid: msg.uid, error: String(err) });
      }

      const isBounce = /^(mailer-daemon|postmaster)@/i.test(fromEmail || '')
        || /undelivered mail|delivery status/i.test(subject || '');

      results.push({
        messageId,
        inReplyTo,
        references: [],
        fromAddress: fromEmail || fromName,
        fromName,
        toAddress: toEmail,
        ccAddresses,
        subject,
        bodyText,
        bodyHtml,
        attachments,
        isBounce,
        rawSource,
        imapUid: msg.uid,
        date: msg.envelope.date || new Date(),
      });

      newUid = Math.max(newUid, msg.uid);
    }

    await client.logout();
  } catch (err) {
    log.error('IMAP poll error', { error: String(err) });
    try { await client.logout(); } catch { /* logged above */ }
  }

  return { emails: results, newLastSeenUid: newUid };
}

// ─── Polling lifecycle ───────────────────────────────────────────────────────

let pollTimer: ReturnType<typeof setInterval> | null = null;
let isPolling = false;
let pollerLastSeenUid = 0;

const POLL_INTERVAL_MS = 30_000;

async function pollCycle(): Promise<void> {
  if (isPolling) return;
  isPolling = true;

  try {
    const account = await getAccountByChannel('email');
    if (!account) {
      log.debug('No email account configured, skipping poll');
      return;
    }

    const { emails, newLastSeenUid } = await fetchNewEmails(account, pollerLastSeenUid);
    pollerLastSeenUid = newLastSeenUid;

    for (const email of emails) {
      try {
        await processInboundEmail(email, account);
      } catch (err) {
        log.error('Failed to process email', { messageId: email.messageId, error: String(err) });
      }
    }

    if (emails.length > 0) {
      log.info('Processed emails', { count: emails.length, newLastSeenUid });
    }
  } catch (err) {
    log.error('Email poll cycle error', { error: String(err) });
  } finally {
    isPolling = false;
  }
}

async function processInboundEmail(email: ParsedEmail, account: ChannelAccount): Promise<void> {
  // Dedup by messageId
  if (email.messageId) {
    const dup = await db.queryOne<{ id: string }>(
      `SELECT id FROM messages WHERE metadata->>'messageId' = $1 LIMIT 1`,
      [email.messageId],
    );
    if (dup) return;
  }

  // Resolve thread → conversation
  let conversationId = await resolveThreadConversation(email.inReplyTo, email.fromAddress);
  const threadId = generateThreadId(email.messageId || email.inReplyTo);

  if (!conversationId) {
    // Create contact before conversation
    const contact = await findOrCreateContact({
      phone: null,
      displayName: email.fromName || email.fromAddress,
      source: 'email',
    });

    const conv = await db.queryOne<{ id: string }>(
      `INSERT INTO conversations
        (channel, account_id, visitor_name, visitor_email, status, source, metadata, last_message_at, contact_id)
       VALUES ('email', $1, $2, $3, 'open', 'email', $4, NOW(), $5)
       RETURNING id`,
      [
        account.id,
        email.fromName || email.fromAddress,
        email.fromAddress,
        JSON.stringify({
          threadId,
          subject: email.subject,
          fromAddress: email.fromAddress,
          toAddress: email.toAddress,
          ccAddresses: email.ccAddresses,
        }),
        contact.id,
      ],
    );
    conversationId = conv!.id;
  }

  // Insert message
  const msgRow = await db.queryOne<MessageRow>(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_name, message_type, content,
       delivery_status, metadata)
     VALUES ($1, 'visitor', $2, 'text', $3, 'accepted', $4)
     RETURNING *`,
    [
      conversationId,
      email.fromName || email.fromAddress,
      email.bodyText || email.subject || '',
      JSON.stringify({
        messageId: email.messageId,
        inReplyTo: email.inReplyTo,
        subject: email.subject,
        bodyHtml: email.bodyHtml,
        imapUid: email.imapUid,
        isBounce: email.isBounce,
      }),
    ],
  );

  if (!msgRow) return;

  // Process attachments → media_attachments
  for (const att of email.attachments) {
    try {
      const detectedMime = detectMimeFromBuffer(att.content) ?? att.mimeType;
      const ext = mimeToExt(detectedMime) || 'bin';
      const s3Key = `email/${uuidv4()}.${ext}`;
      const { url: s3Url } = await storageService.upload(att.content, s3Key, detectedMime);

      // Classify media_type from detected MIME
      let mediaType: 'image' | 'video' | 'audio' | 'file' = 'file';
      if (detectedMime.startsWith('image/') && detectedMime !== 'image/svg+xml') mediaType = 'image';
      else if (detectedMime.startsWith('video/')) mediaType = 'video';
      else if (detectedMime.startsWith('audio/')) mediaType = 'audio';

      await db.query(
        `INSERT INTO media_attachments
          (message_id, s3_key, s3_url, media_type, mime_type, file_name,
           file_size_bytes, processing_status, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'uploaded', $8)`,
        [
          msgRow.id, s3Key, s3Url, mediaType, detectedMime, att.filename, att.sizeBytes,
          JSON.stringify({ contentId: att.contentId, contentDisposition: att.contentDisposition }),
        ],
      );
    } catch (err) {
      log.error('Email attachment upload failed', { filename: att.filename, error: String(err) });
    }
  }

  // Update conversation counters
  await db.query(
    `UPDATE conversations SET
       last_message_at = NOW(),
       last_message_content = $2,
       message_count = message_count + 1,
       unread_count = unread_count + 1,
       updated_at = NOW()
     WHERE id = $1`,
    [conversationId, (email.bodyText || email.subject || '').slice(0, 200)],
  );

  // Broadcast via Socket.IO
  const conv = await db.queryOne<ConversationRow>(
    `SELECT * FROM conversations WHERE id = $1`, [conversationId],
  );
  if (conv) {
    broadcastNewMessage({ message: msgRow, conversation: conv });

    // Emit email:new for CRM email panel live updates
    broadcastToRoom('email:new', 'admin:visitor-chats', {
      id: msgRow.id,
      from_address: email.fromAddress,
      subject: email.subject,
      has_attachments: email.attachments.length > 0,
      created_at: msgRow.created_at,
    });
  }
}

/** Start IMAP polling (called by leader scheduler). */
export function startEmailImapPoller(): void {
  if (pollTimer) return;
  log.info('Email IMAP poller starting', { intervalMs: POLL_INTERVAL_MS });

  setTimeout(() => pollCycle().catch(err => log.error('Initial poll error', { error: String(err) })), 5000);
  pollTimer = setInterval(() => pollCycle().catch(err => log.error('Poll interval error', { error: String(err) })), POLL_INTERVAL_MS);
}

/** Stop IMAP polling. */
export function stopEmailImapPoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    log.info('Email IMAP poller stopped');
  }
}
