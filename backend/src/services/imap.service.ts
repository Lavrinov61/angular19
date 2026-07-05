/**
 * IMAP Listener Service — Wave 5
 * Polling-based incoming email sync from Yandex Mail.
 * Polls IMAP_MAILBOX every IMAP_POLL_INTERVAL_MS (default 30s).
 * New emails → saved to email_messages table + client lookup by email.
 */

import { ImapFlow, type MessageEnvelopeObject, type SearchObject } from 'imapflow';
import { simpleParser, type Attachment } from 'mailparser';
import sanitizeHtml from 'sanitize-html';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import db from '../database/db.js';
import { fixMimeCharset } from '../utils/charset-utils.js';
import { detectMimeFromBuffer, extFromFilename, mimeToExt } from '../utils/mime-utils.js';
import { storageService } from './storage.service.js';
import { getAccountByChannel } from './connectors/core/account-store.js';

import { createLogger } from '../utils/logger.js';
let pollTimer: NodeJS.Timeout | null = null;
let isStarting = false;
let isPolling = false;

const logger = createLogger('imap.service');
/** Track last fetched UID per mailbox session (in-memory, resets on restart). */
const lastSeenUidByMailbox = new Map<string, number>();

interface ParsedEmailAttachment {
  content: Buffer;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentId: string | null;
  contentDisposition: string;
}

interface SavedInboundEmailRow {
  id: number;
}

interface EmailAttachmentBackfillRow {
  id: number;
  from_address: string | null;
  subject: string | null;
  created_at: string | null;
  message_id: string | null;
  imap_uid: string | null;
  imap_folder: string | null;
  has_attachments: boolean | null;
  attachment_count: number | null;
}

interface StoredAttachmentCountRow {
  count: string;
}

interface CustomerPhoneLookupRow {
  phone: string;
}

export interface ExistingEmailAttachmentState {
  id: number;
  has_attachments: boolean | null;
  attachment_count: number | null;
  has_saved_attachments: boolean;
}

export interface EmailAttachmentBackfillResult {
  emailId: number;
  attempted: boolean;
  saved: number;
  available: number;
  reason?: 'email-not-found' | 'already-saved' | 'no-attachment-flag' | 'imap-not-configured' | 'message-not-found' | 'source-not-found' | 'no-attachments-found';
}

interface EmailThreadLookupRow {
  thread_id: string;
}

interface ImapRuntimeConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox: string;
  pollIntervalMs: number;
  source: 'env' | 'channel-account';
  accountId?: string;
}

interface EmailChannelCredentials {
  imapHost?: unknown;
  imap_host?: unknown;
  host?: unknown;
  imapPort?: unknown;
  imap_port?: unknown;
  port?: unknown;
  imapSecure?: unknown;
  imap_secure?: unknown;
  secure?: unknown;
  imapUser?: unknown;
  imap_user?: unknown;
  user?: unknown;
  email?: unknown;
  imapPassword?: unknown;
  imap_password?: unknown;
  password?: unknown;
  imapMailbox?: unknown;
  imap_mailbox?: unknown;
  mailbox?: unknown;
}

function stringCredential(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function numberCredential(fallback: number, ...values: unknown[]): number {
  for (const value of values) {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function booleanCredential(fallback: boolean, ...values: unknown[]): boolean {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }
  }
  return fallback;
}

function hasExplicitImapEnv(): boolean {
  return Boolean(
    process.env['IMAP_HOST']
      || process.env['IMAP_PORT']
      || process.env['IMAP_SECURE']
      || process.env['IMAP_USER']
      || process.env['IMAP_PASSWORD']
      || process.env['IMAP_MAILBOX'],
  );
}

function imapEnvPrefix(address: string): string {
  return `IMAP_${normalizeMailAddress(address).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

function imapEnvValue(address: string, suffix: string): string {
  return (process.env[`${imapEnvPrefix(address)}_${suffix}`] || '').trim();
}

function normalizeMailAddress(address: string): string {
  return extractEmail(address).trim().toLowerCase();
}

function getCrmMailboxes(): string[] {
  return Array.from(
    new Set(
      [config.mail.address, ...config.mail.aliases]
        .map(normalizeMailAddress)
        .filter(Boolean),
    ),
  );
}

function envImapConfig(): ImapRuntimeConfig | null {
  if (!config.imap.user || !config.imap.password) return null;
  return {
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    user: config.imap.user,
    password: config.imap.password,
    mailbox: config.imap.mailbox,
    pollIntervalMs: config.imap.pollIntervalMs,
    source: 'env',
  };
}

function mailboxEnvImapConfig(address: string): ImapRuntimeConfig | null {
  const normalized = normalizeMailAddress(address);
  const user = imapEnvValue(normalized, 'USER');
  const password = imapEnvValue(normalized, 'PASSWORD')
    || imapEnvValue(normalized, 'PASS');

  if (!user || !password) return null;

  return {
    host: imapEnvValue(normalized, 'HOST') || config.imap.host,
    port: numberCredential(config.imap.port, imapEnvValue(normalized, 'PORT')),
    secure: booleanCredential(config.imap.secure, imapEnvValue(normalized, 'SECURE')),
    user,
    password,
    mailbox: imapEnvValue(normalized, 'MAILBOX') || config.imap.mailbox,
    pollIntervalMs: config.imap.pollIntervalMs,
    source: 'env',
    accountId: `mailbox:${normalized}`,
  };
}

async function accountImapConfig(): Promise<ImapRuntimeConfig | null> {
  const account = await getAccountByChannel('email');
  if (!account) return null;

  const credentials = account.credentials as EmailChannelCredentials;
  const user = stringCredential(credentials.imapUser, credentials.imap_user, credentials.user, credentials.email);
  const password = stringCredential(credentials.imapPassword, credentials.imap_password, credentials.password);
  if (!user || !password) return null;

  return {
    host: stringCredential(credentials.imapHost, credentials.imap_host, credentials.host) || config.imap.host,
    port: numberCredential(config.imap.port, credentials.imapPort, credentials.imap_port, credentials.port),
    secure: booleanCredential(config.imap.secure, credentials.imapSecure, credentials.imap_secure, credentials.secure),
    user,
    password,
    mailbox: stringCredential(credentials.imapMailbox, credentials.imap_mailbox, credentials.mailbox) || config.imap.mailbox,
    pollIntervalMs: config.imap.pollIntervalMs,
    source: 'channel-account',
    accountId: account.id,
  };
}

async function resolvePrimaryImapConfig(): Promise<ImapRuntimeConfig | null> {
  const envConfig = envImapConfig();
  if (hasExplicitImapEnv() && envConfig) return envConfig;

  try {
    const accountConfig = await accountImapConfig();
    if (accountConfig) return accountConfig;
  } catch (err) {
    logger.warn('[IMAP] Failed to load email channel account config', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return envConfig;
}

function imapConfigKey(imapConfig: ImapRuntimeConfig): string {
  return `${imapConfig.host}:${imapConfig.port}:${imapConfig.user}:${imapConfig.mailbox}`;
}

function addUniqueImapConfig(configs: ImapRuntimeConfig[], next: ImapRuntimeConfig | null): void {
  if (!next) return;
  const nextKey = imapConfigKey(next);
  if (configs.some(configItem => imapConfigKey(configItem) === nextKey)) return;
  configs.push(next);
}

async function resolveImapConfigs(): Promise<ImapRuntimeConfig[]> {
  const configs: ImapRuntimeConfig[] = [];

  for (const mailbox of getCrmMailboxes()) {
    addUniqueImapConfig(configs, mailboxEnvImapConfig(mailbox));
  }

  addUniqueImapConfig(configs, await resolvePrimaryImapConfig());
  return configs;
}

/**
 * Sanitize email HTML body to prevent XSS when displayed in CRM.
 */
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

/**
 * Lookup customer phone by email address (best-effort).
 * Checks users table and known order emails.
 */
async function lookupCustomerPhone(email: string): Promise<string | null> {
  const emailLower = email.toLowerCase().trim();

  // Check users table
  const userRow = await db.queryOne<CustomerPhoneLookupRow>(
    `SELECT phone FROM users WHERE LOWER(email) = $1 AND phone IS NOT NULL LIMIT 1`,
    [emailLower]
  );
  if (userRow?.phone) return userRow.phone;

  // Check photo_print_orders (contact_email field if exists)
  const orderRow = await db.queryOne<CustomerPhoneLookupRow>(
    `SELECT contact_phone as phone FROM photo_print_orders
     WHERE LOWER(contact_email) = $1 AND contact_phone IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [emailLower]
  ).catch((err: unknown) => {
    logger.debug('[IMAP] Customer phone lookup by order email failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });
  if (orderRow?.phone) return orderRow.phone;

  return null;
}

/**
 * Extract plain email address from "Name <email>" format.
 */
function extractEmail(addr: string | undefined | null): string {
  if (!addr) return '';
  const match = addr.match(/<([^>]+)>/);
  return match ? match[1].trim() : addr.trim();
}

function normalizeAttachmentFilename(filename: string | undefined, index: number, mimeType: string): string {
  const trimmed = filename?.trim();
  if (trimmed) return trimmed;
  return `attachment-${index + 1}${mimeToExt(mimeType)}`;
}

function buildAttachmentKey(filename: string, mimeType: string): string {
  const fallbackExt = extFromFilename(filename, mimeType);
  const safeFilename = filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^_+$/, '')
    || `attachment${fallbackExt}`;
  return `email-attachments/${uuidv4()}/${safeFilename.slice(0, 180)}`;
}

function mapParsedAttachment(att: Attachment, index: number): ParsedEmailAttachment {
  const mimeType = detectMimeFromBuffer(att.content) ?? att.contentType ?? 'application/octet-stream';
  return {
    content: att.content,
    filename: normalizeAttachmentFilename(att.filename, index, mimeType),
    mimeType,
    sizeBytes: att.size || att.content.length,
    contentId: att.contentId?.replace(/[<>]/g, '') || null,
    contentDisposition: (att.contentDisposition || (att.contentId ? 'inline' : 'attachment')).slice(0, 20),
  };
}

async function parseSourceAttachments(sourceBuffer: Buffer): Promise<ParsedEmailAttachment[]> {
  const fixedSource = fixMimeCharset(sourceBuffer);
  const parsed = await simpleParser(fixedSource);
  return (parsed.attachments || []).map((att, index) => mapParsedAttachment(att, index));
}

export function shouldSkipExistingEmailAttachmentBackfill(existingEmail: ExistingEmailAttachmentState | null): boolean {
  return existingEmail?.has_saved_attachments === true;
}

function readSourceBuffer(sourceMsg: unknown): Buffer | null {
  if (!sourceMsg || typeof sourceMsg !== 'object' || !('source' in sourceMsg)) return null;
  const source = Object.getOwnPropertyDescriptor(sourceMsg, 'source')?.value;
  return Buffer.isBuffer(source) ? source : null;
}

function numericUid(value: string | number | null): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function messageIdSearchValues(messageId: string | null): string[] {
  const trimmed = messageId?.trim();
  if (!trimmed) return [];

  const withoutBrackets = trimmed.replace(/^<|>$/g, '');
  return Array.from(new Set([trimmed, withoutBrackets].filter(Boolean)));
}

function normalizeSubjectForMatch(subject: string | null | undefined): string {
  let value = (subject || '').toLowerCase().replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 4; i++) {
    const next = value.replace(/^(fwd?|re)\s*:\s*/i, '').trim();
    if (next === value) break;
    value = next;
  }
  return value;
}

function backfillSearchSince(createdAt: string | null): Date {
  const created = createdAt ? new Date(createdAt) : new Date();
  const base = Number.isNaN(created.getTime()) ? new Date() : created;
  const since = new Date(base);
  since.setDate(since.getDate() - 7);
  return since;
}

function envelopeFromAddresses(envelope: MessageEnvelopeObject | undefined): string[] {
  return (envelope?.from || [])
    .map(address => normalizeMailAddress(address.address || ''))
    .filter(Boolean);
}

function emailEnvelopeMatches(
  envelope: MessageEnvelopeObject | undefined,
  email: EmailAttachmentBackfillRow,
): boolean {
  if (!envelope) return false;

  const emailFrom = normalizeMailAddress(email.from_address || '');
  const fromMatches = emailFrom
    ? envelopeFromAddresses(envelope).includes(emailFrom)
    : false;

  const expectedSubject = normalizeSubjectForMatch(email.subject);
  const envelopeSubject = normalizeSubjectForMatch(envelope.subject);
  const subjectMatches = Boolean(
    expectedSubject
      && envelopeSubject
      && (expectedSubject === envelopeSubject
        || expectedSubject.includes(envelopeSubject)
        || envelopeSubject.includes(expectedSubject)),
  );

  return fromMatches && subjectMatches;
}

async function fetchFirstMatchingSource(
  client: ImapFlow,
  uids: number[] | false,
  email: EmailAttachmentBackfillRow,
): Promise<Buffer | null> {
  if (!uids || uids.length === 0) return null;

  for await (const msg of client.fetch(uids.slice(-300).reverse(), { uid: true, envelope: true }, { uid: true })) {
    if (!emailEnvelopeMatches(msg.envelope, email)) continue;

    const source = readSourceBuffer(await client.fetchOne(String(msg.uid), { source: true }, { uid: true }));
    if (source) return source;
  }

  return null;
}

async function fetchEmailSourceByMessageIdentity(
  client: ImapFlow,
  email: EmailAttachmentBackfillRow,
): Promise<Buffer | null> {
  const uid = numericUid(email.imap_uid);
  if (uid) {
    const source = readSourceBuffer(await client.fetchOne(String(uid), { source: true }, { uid: true }));
    if (source) return source;
  }

  for (const value of messageIdSearchValues(email.message_id)) {
    const searchQuery: SearchObject = { header: { 'Message-ID': value } };
    const uids = await client.search(searchQuery, { uid: true });
    if (!uids || uids.length === 0) continue;

    const source = readSourceBuffer(await client.fetchOne(String(uids[uids.length - 1]), { source: true }, { uid: true }));
    if (source) return source;
  }

  const fromAddress = normalizeMailAddress(email.from_address || '');
  if (fromAddress) {
    const fromUids = await client.search({
      since: backfillSearchSince(email.created_at),
      from: fromAddress,
    }, { uid: true });
    const source = await fetchFirstMatchingSource(client, fromUids, email);
    if (source) return source;
  }

  const subject = normalizeSubjectForMatch(email.subject);
  if (subject) {
    const subjectUids = await client.search({
      since: backfillSearchSince(email.created_at),
      subject,
    }, { uid: true });
    const source = await fetchFirstMatchingSource(client, subjectUids, email);
    if (source) return source;
  }

  return null;
}

async function countStoredEmailAttachments(emailId: number): Promise<number> {
  const row = await db.queryOne<StoredAttachmentCountRow>(
    `SELECT COUNT(*)::text AS count
     FROM email_attachments
     WHERE email_id = $1
       AND (s3_key IS NOT NULL OR storage_url IS NOT NULL)`,
    [emailId],
  );
  return Number.parseInt(row?.count || '0', 10);
}

async function closeImapClient(client: ImapFlow): Promise<void> {
  try { await client.logout(); } catch { /* ignore */ }
}

async function saveEmailAttachments(emailId: number, attachments: ParsedEmailAttachment[]): Promise<number> {
  let savedCount = 0;

  for (const attachment of attachments) {
    try {
      const s3Key = buildAttachmentKey(attachment.filename, attachment.mimeType);
      const stored = await storageService.upload(attachment.content, s3Key, attachment.mimeType);

      await db.query(
        `INSERT INTO email_attachments
          (email_id, filename, mime_type, size_bytes, content_id, content_disposition, s3_key, storage_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          emailId,
          attachment.filename,
          attachment.mimeType,
          attachment.sizeBytes,
          attachment.contentId,
          attachment.contentDisposition,
          stored.storageType === 's3' ? stored.key : null,
          stored.url,
        ]
      );
      savedCount++;
    } catch (err) {
      logger.error('[IMAP] Attachment save failed', {
        emailId,
        filename: attachment.filename,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return savedCount;
}

/**
 * Recover attachment rows for CRM emails that were imported with attachment
 * metadata but without persisted files.
 */
export async function backfillEmailAttachments(emailId: number): Promise<EmailAttachmentBackfillResult> {
  const available = await countStoredEmailAttachments(emailId);
  if (available > 0) {
    return { emailId, attempted: false, saved: 0, available, reason: 'already-saved' };
  }

  const email = await db.queryOne<EmailAttachmentBackfillRow>(
    `SELECT id, from_address, subject, created_at, message_id, imap_uid, imap_folder,
            has_attachments, attachment_count
     FROM email_messages
     WHERE id = $1`,
    [emailId],
  );

  if (!email) return { emailId, attempted: false, saved: 0, available: 0, reason: 'email-not-found' };
  if (!email.has_attachments && !email.attachment_count) {
    return { emailId, attempted: false, saved: 0, available: 0, reason: 'no-attachment-flag' };
  }

  const imapConfigs = await resolveImapConfigs();
  if (!imapConfigs.length) {
    return { emailId, attempted: false, saved: 0, available: 0, reason: 'imap-not-configured' };
  }

  for (const imapConfig of imapConfigs) {
    const client = new ImapFlow({
      host: imapConfig.host,
      port: imapConfig.port,
      secure: imapConfig.secure,
      auth: {
        user: imapConfig.user,
        pass: imapConfig.password,
      },
      logger: false,
      tls: {
        rejectUnauthorized: false,
      },
    });

    try {
      await client.connect();
      await client.mailboxOpen(email.imap_folder || imapConfig.mailbox, { readOnly: true });

      const source = await fetchEmailSourceByMessageIdentity(client, email);
      if (!source) {
        await closeImapClient(client);
        continue;
      }

      const attachments = await parseSourceAttachments(source);
      if (!attachments.length) {
        await closeImapClient(client);
        return { emailId, attempted: true, saved: 0, available: 0, reason: 'no-attachments-found' };
      }

      const saved = await saveEmailAttachments(emailId, attachments);
      const nextAvailable = await countStoredEmailAttachments(emailId);
      if (nextAvailable > 0) {
        await db.query(
          `UPDATE email_messages
           SET has_attachments = true,
               attachment_count = $2,
               updated_at = NOW()
           WHERE id = $1`,
          [emailId, nextAvailable],
        );
      }

      await closeImapClient(client);
      return { emailId, attempted: true, saved, available: nextAvailable };
    } catch (err) {
      logger.warn('[IMAP] Attachment backfill attempt failed', {
        emailId,
        mailbox: email.imap_folder || imapConfig.mailbox,
        source: imapConfig.source,
        error: err instanceof Error ? err.message : String(err),
      });
      await closeImapClient(client);
    }
  }

  return { emailId, attempted: true, saved: 0, available: 0, reason: 'message-not-found' };
}

/**
 * Fetch new messages from IMAP since lastSeenUid.
 */
async function fetchMailboxMessages(imapConfig: ImapRuntimeConfig): Promise<void> {
  const mailboxKey = imapConfigKey(imapConfig);
  let lastSeenUid = lastSeenUidByMailbox.get(mailboxKey) || 0;
  const client = new ImapFlow({
    host: imapConfig.host,
    port: imapConfig.port,
    secure: imapConfig.secure,
    auth: {
      user: imapConfig.user,
      pass: imapConfig.password,
    },
    logger: false,
    tls: {
      rejectUnauthorized: false, // Yandex uses self-signed in some configs
    },
  });

  try {
    await client.connect();
    const mailbox = await client.mailboxOpen(imapConfig.mailbox, { readOnly: false });

    if (mailbox.exists === 0) {
      await client.logout();
      return;
    }

    // On first run — get last 50 messages. After that — only new ones.
    const searchCriteria = lastSeenUid > 0
      ? { uid: `${lastSeenUid + 1}:*` }
      : { all: true };

    const messages: Array<{
      uid: number;
      envelope: {
        messageId?: string;
        inReplyTo?: string;
        from?: Array<{ address?: string; name?: string }>;
        to?: Array<{ address?: string; name?: string }>;
        cc?: Array<{ address?: string; name?: string }>;
        subject?: string;
        date?: Date;
      };
      bodyParts?: Map<string, Buffer>;
    }> = [];

    // Fetch message headers + body
    for await (const msg of client.fetch(searchCriteria, {
      uid: true,
      envelope: true,
      bodyStructure: true,
      source: false,
    })) {
      messages.push({
        uid: msg.uid,
        envelope: msg.envelope as typeof messages[0]['envelope'],
      });
    }

    // On first run — only process last 50 to avoid flood
    const toProcess = lastSeenUid === 0
      ? messages.slice(-50)
      : messages;

    for (const msg of toProcess) {
      if (msg.uid <= lastSeenUid) continue;

      const messageId = msg.envelope.messageId || null;

      // Deduplication by message_id
      let existingEmail: ExistingEmailAttachmentState | null = null;
      if (messageId) {
        existingEmail = await db.queryOne<ExistingEmailAttachmentState>(
          `SELECT id, has_attachments, attachment_count,
                  EXISTS(SELECT 1 FROM email_attachments WHERE email_id = email_messages.id) AS has_saved_attachments
           FROM email_messages
           WHERE message_id = $1`,
          [messageId]
        );
        if (shouldSkipExistingEmailAttachmentBackfill(existingEmail)) {
          lastSeenUid = Math.max(lastSeenUid, msg.uid);
          lastSeenUidByMailbox.set(mailboxKey, lastSeenUid);
          continue;
        }
      }

      const fromAddr = msg.envelope.from?.[0];
      const fromEmail = extractEmail(fromAddr?.address);
      const fromName = fromAddr?.name || fromEmail;
      const toAddr = msg.envelope.to?.[0];
      const toEmail = extractEmail(toAddr?.address);
      const ccAddrs = (msg.envelope.cc || []).map(a => extractEmail(a.address)).filter(Boolean);
      const subject = msg.envelope.subject || '(без темы)';
      const inReplyTo = msg.envelope.inReplyTo || null;

      // Lookup customer phone
      const customerPhone = await lookupCustomerPhone(fromEmail);

      // Fetch full source for proper MIME parsing with charset detection
      let bodyText: string | null = null;
      let bodyHtml: string | null = null;
      let attachments: ParsedEmailAttachment[] = [];

      try {
        const sourceMsg = await client.fetchOne(String(msg.uid), { source: true }, { uid: true });
        const sourceBuffer = sourceMsg && typeof sourceMsg === 'object' && 'source' in sourceMsg && Buffer.isBuffer(sourceMsg.source) ? sourceMsg.source : undefined;

        if (sourceBuffer) {
          const fixedSource = fixMimeCharset(sourceBuffer);
          const parsed = await simpleParser(fixedSource);
          bodyText = parsed.text?.slice(0, 50000) || null;
          bodyHtml = parsed.html ? sanitizeEmailHtml(parsed.html) : null;
          attachments = (parsed.attachments || []).map((att, index) => mapParsedAttachment(att, index));
        }
      } catch (err) {
        logger.error('[IMAP] Body fetch/parse failed', {
          uid: msg.uid,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Thread ID: use inReplyTo chain or messageId
      const threadId = inReplyTo
        ? (await db.queryOne<EmailThreadLookupRow>(
            'SELECT thread_id FROM email_messages WHERE message_id = $1',
            [inReplyTo]
          ).then(r => r?.thread_id)) || messageId
        : messageId;

      if (existingEmail) {
        if (attachments.length > 0) {
          const savedAttachments = await saveEmailAttachments(existingEmail.id, attachments);
          if (savedAttachments > 0) {
            await db.query(
              `UPDATE email_messages
               SET has_attachments = true,
                   attachment_count = $2,
                   updated_at = NOW()
               WHERE id = $1`,
              [existingEmail.id, savedAttachments]
            );
            logger.info('[IMAP] Backfilled email attachments', {
              emailId: existingEmail.id,
              savedAttachments,
            });
          }
        }

        lastSeenUid = Math.max(lastSeenUid, msg.uid);
        lastSeenUidByMailbox.set(mailboxKey, lastSeenUid);
        continue;
      }

      const saved = await db.queryOne<SavedInboundEmailRow>(
        `INSERT INTO email_messages
           (direction, from_address, to_address, cc_addresses, subject,
            body_text, body_html, customer_phone, thread_id, in_reply_to,
            message_id, status, imap_uid, imap_folder, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (message_id) DO NOTHING
         RETURNING id`,
        [
          'inbound',
          fromEmail || fromName,
          toEmail,
          ccAddrs.length ? ccAddrs : null,
          subject,
          bodyText,
          bodyHtml,
          customerPhone,
          threadId,
          inReplyTo,
          messageId,
          'received',
          msg.uid,
          imapConfig.mailbox,
          msg.envelope.date || new Date(),
        ]
      );

      if (saved && attachments.length > 0) {
        const savedAttachments = await saveEmailAttachments(saved.id, attachments);
        if (savedAttachments > 0) {
          await db.query(
            `UPDATE email_messages
             SET has_attachments = true,
                 attachment_count = $2,
                 updated_at = NOW()
             WHERE id = $1`,
            [saved.id, savedAttachments]
          );
        }
      }

      logger.info(`[IMAP] Saved email from ${fromEmail}: ${subject}`);
      lastSeenUid = Math.max(lastSeenUid, msg.uid);
      lastSeenUidByMailbox.set(mailboxKey, lastSeenUid);
    }

    await client.logout();
  } catch (err) {
    logger.error('[IMAP] Poll error', { error: err instanceof Error ? err.message : String(err) });
    // Don't rethrow — polling continues on next interval
    try { await client.logout(); } catch { /* ignore */ }
  }
}

async function fetchNewMessages(): Promise<void> {
  const imapConfigs = await resolveImapConfigs();
  if (!imapConfigs.length) {
    return; // IMAP not configured
  }

  for (const imapConfig of imapConfigs) {
    await fetchMailboxMessages(imapConfig);
  }
}

/**
 * Start IMAP polling service.
 * Called once from server.ts at startup.
 */
export function startImapService(): void {
  if (pollTimer || isStarting) {
    return;
  }

  isStarting = true;
  resolveImapConfigs().then(imapConfigs => {
    isStarting = false;

    if (!imapConfigs.length) {
      logger.info('[IMAP] Not configured (IMAP credentials not set). Skipping.');
      return;
    }

    const pollIntervalMs = Math.min(...imapConfigs.map(imapConfig => imapConfig.pollIntervalMs));
    logger.info(`[IMAP] Starting polling every ${pollIntervalMs / 1000}s`, {
      accounts: imapConfigs.length,
      mailboxes: imapConfigs.map(imapConfig => ({
        mailbox: imapConfig.mailbox,
        source: imapConfig.source,
      })),
    });

    // Initial fetch
    fetchNewMessages().catch(err => logger.error('[IMAP] Initial fetch error', { error: String(err) }));

    pollTimer = setInterval(async () => {
      if (isPolling) return; // skip if previous poll is still running
      isPolling = true;
      try {
        await fetchNewMessages();
      } finally {
        isPolling = false;
      }
    }, pollIntervalMs);

    pollTimer.unref(); // don't block process exit
  }).catch(err => {
    isStarting = false;
    logger.error('[IMAP] Startup config resolution failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * Stop IMAP polling (for graceful shutdown).
 */
export function stopImapService(): void {
  isStarting = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    logger.info('[IMAP] Polling stopped.');
  }
}
