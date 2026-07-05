/**
 * CRM Email Routes — Wave 5 + v2 + v3 (starred, reply-all, retry, search filters)
 * GET  /api/crm/email               — inbox (paginated, ?status=draft for drafts, ?starred, ?date_from, ?date_to, ?has_attachments)
 * GET  /api/crm/email/:id           — single message
 * POST /api/crm/email/send          — send outbound email (reply, reply_all, forward, cc/bcc, draft_id)
 * PATCH /api/crm/email/:id          — update status (read, archived)
 * PATCH /api/crm/email/:id/star     — toggle starred
 * POST /api/crm/email/:id/retry     — retry failed email
 * GET  /api/crm/email/templates     — list email templates
 * POST /api/crm/email/:id/link      — link email to entity
 * GET  /api/crm/email/counts        — unread counts
 * GET  /api/crm/email/:id/attachments — list attachments
 * POST /api/crm/email/upload-attachment/presign — create direct S3 upload URL
 * POST /api/crm/email/upload-attachment/complete — register uploaded attachment
 * POST /api/crm/email/draft         — create draft
 * PUT  /api/crm/email/draft/:id     — update draft
 * DELETE /api/crm/email/draft/:id   — delete draft
 * POST /api/crm/email/bulk          — bulk actions (archive, read, unread, delete)
 */

import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import path from 'path';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { AuthRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { config } from '../config/index.js';
import db from '../database/db.js';
import { withServiceCall, SERVICE_BREAKERS } from '../utils/circuit-breaker.js';
import { storageService } from '../services/storage.service.js';
import { backfillEmailAttachments } from '../services/imap.service.js';
import { createUploadLimiter } from '../middleware/upload-limiter.js';
import type {
  EmailInboxRow, EmailDetailRow, EmailThreadRow, EmailAttachmentRow, EmailMailboxCountSourceRow,
  AttachmentCountRow, EmailAttachmentResult, EmailAttachmentDownloadRow, DraftIdResult, BulkActionResult, DraftDetailRow,
  EmailForwardSourceRow, EmailReplySourceRow, ReplyAllSourceRow, RetrySourceRow,
  EmailTemplateLookup, EmailSaveResult, EmailStatusBody, EmailLinkBody, EmailStarBody,
  PresignAttachmentBody, CompleteAttachmentBody, DraftSaveBody, BulkActionBody, SendEmailBody,
} from '../types/views/email-views.js';

import { createLogger } from '../utils/logger.js';
const router = Router();

const logger = createLogger('crm-email.routes');
// All CRM email endpoints require inbox:view permission
router.use(authenticateToken);
router.use(requirePermission('inbox:view'));

// ─── SMTP transporter (mailbox-aware) ─────────────────────────────────────

type CrmEmailTransporter = ReturnType<typeof nodemailer.createTransport>;

interface SmtpAccountConfig {
  address: string;
  host: string;
  port: number;
  user: string;
  password: string;
  fromAddress: string;
  fromName: string;
  replyToAddress?: string;
}

const smtpTransporters = new Map<string, CrmEmailTransporter>();

function smtpEnvPrefix(address: string): string {
  return `SMTP_${normalizeMailAddress(address).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

function smtpEnvValue(address: string, suffix: string): string {
  return (process.env[`${smtpEnvPrefix(address)}_${suffix}`] || '').trim();
}

function parseSmtpPort(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getMailboxDisplayName(address: string): string {
  switch (normalizeMailAddress(address)) {
    case 'info@fmagnus.org':
      return 'FMagnus';
    case 'info@svoefoto.ru':
      return 'Своё Фото';
    default:
      return normalizeMailAddress(address).split('@')[0] || 'CRM';
  }
}

function extractSenderName(from: string | null | undefined): string | null {
  if (!from) return null;
  const match = from.match(/^\s*"?([^"<]*)"?\s*<[^>]+>/);
  const name = match?.[1]?.trim();
  return name || null;
}

function resolveSmtpAccount(senderAddress: string): SmtpAccountConfig | null {
  const address = normalizeMailAddress(senderAddress);
  const configUserAddress = normalizeMailAddress(config.smtp.user || '');
  const configUserMatchesSender = configUserAddress === address;
  const configuredFromAddress = normalizeMailAddress(config.smtp.from || '');
  const configuredFromMatchesSender = configuredFromAddress === address;

  const dedicatedUser = smtpEnvValue(address, 'USER');
  const dedicatedPassword = smtpEnvValue(address, 'PASSWORD') || smtpEnvValue(address, 'PASS');
  const hasDedicatedSmtp = Boolean(dedicatedUser && dedicatedPassword);

  const canUseSharedSmtp = Boolean(config.smtp.user && config.smtp.password)
    && getCrmMailboxes().includes(address);

  const user = hasDedicatedSmtp
    ? dedicatedUser
    : (configUserMatchesSender ? config.smtp.user : '') || (canUseSharedSmtp ? config.smtp.user : '');
  const password = hasDedicatedSmtp
    ? dedicatedPassword
    : (configUserMatchesSender ? config.smtp.password : '') || (canUseSharedSmtp ? config.smtp.password : '');

  if (!user || !password) return null;

  const host = hasDedicatedSmtp ? smtpEnvValue(address, 'HOST') || config.smtp.host : config.smtp.host;
  const port = hasDedicatedSmtp
    ? parseSmtpPort(smtpEnvValue(address, 'PORT') || String(config.smtp.port), config.smtp.port)
    : config.smtp.port;
  const usesSharedSmtpFallback = !hasDedicatedSmtp && !configUserMatchesSender && canUseSharedSmtp;
  const from = hasDedicatedSmtp
    ? smtpEnvValue(address, 'FROM') || (configuredFromMatchesSender ? config.smtp.from : '')
    : (configuredFromMatchesSender || usesSharedSmtpFallback ? config.smtp.from : '');
  const fromAddress = normalizeMailAddress(from || '');
  const fromName = extractSenderName(from)
    || (configuredFromMatchesSender ? extractSenderName(config.smtp.from) : null)
    || getMailboxDisplayName(address);
  const actualFromAddress = fromAddress || address;

  return {
    address,
    host,
    port,
    user,
    password,
    fromAddress: usesSharedSmtpFallback ? actualFromAddress : (fromAddress === address ? fromAddress : address),
    fromName,
    ...(usesSharedSmtpFallback && actualFromAddress !== address ? { replyToAddress: address } : {}),
  };
}

function getTransporter(senderAddress: string): { transport: CrmEmailTransporter; account: SmtpAccountConfig } | null {
  const account = resolveSmtpAccount(senderAddress);
  if (!account) return null;

  const cacheKey = `${account.host}:${account.port}:${account.user}`;
  let transport = smtpTransporters.get(cacheKey);
  if (!transport) {
    transport = nodemailer.createTransport({
      host: account.host,
      port: account.port,
      secure: account.port === 465,
      auth: { user: account.user, pass: account.password },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    smtpTransporters.set(cacheKey, transport);
  }

  return { transport, account };
}

// ─── HELPERS ───────────────────────────────────────────────────────────────

/** Apply {{variable}} substitutions in template */
function applyTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key) => vars[key] ?? '');
}

/** Strip MIME artifacts from preview text */
function cleanPreview(text: string | null): string {
  if (!text) return '';
  let cleaned = text
    // Remove MIME boundaries (------=_Part_..., --_=_NextPart_, etc.)
    .replace(/--+[=_][\w.+-]+/g, '')
    // Remove Content-Type / Content-Transfer-Encoding headers
    .replace(/Content-(Type|Transfer-Encoding|Disposition|ID):[^\n]*/gi, '')
    // Remove charset/boundary params on continuation lines
    .replace(/^\s*(charset|boundary|name|filename)=[^\n]*/gm, '')
    // Remove base64 blocks (long runs of [A-Za-z0-9+/=])
    .replace(/[A-Za-z0-9+/=]{60,}/g, '')
    // Remove MIME version header
    .replace(/MIME-Version:[^\n]*/gi, '');
  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 200);
}

/** Parse cc/bcc from request body (string[] or comma-separated string) */
function parseAddressList(input: unknown): string[] | null {
  if (!input) return null;
  if (Array.isArray(input)) return input.filter((s): s is string => typeof s === 'string' && s.includes('@'));
  if (typeof input === 'string') return input.split(',').map(s => s.trim()).filter(s => s.includes('@'));
  return null;
}

function parseRouteId(input: string | string[] | undefined, name = 'id'): number {
  const value = typeof input === 'string' ? Number(input) : NaN;
  if (!Number.isSafeInteger(value) || value <= 0) throw new AppError(400, `${name} must be a positive integer`);
  return value;
}

function encodedAttachmentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`;
}

function setAttachmentHeaders(res: Response, filename: string, mimeType: string, sizeBytes?: number | string | null): void {
  res.setHeader('Content-Disposition', encodedAttachmentDisposition(filename));
  res.setHeader('Content-Type', mimeType || 'application/octet-stream');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  if (sizeBytes !== undefined && sizeBytes !== null) {
    res.setHeader('Content-Length', String(sizeBytes));
  }
}

function resolveLocalUploadPath(storageUrl: string): string | null {
  if (!storageUrl.startsWith('/uploads/')) return null;

  const uploadsRoot = path.resolve(process.cwd(), 'uploads');
  const localPath = path.resolve(process.cwd(), storageUrl.replace(/^\//, ''));
  if (localPath !== uploadsRoot && !localPath.startsWith(`${uploadsRoot}${path.sep}`)) {
    throw new AppError(403, 'Invalid attachment path');
  }
  return localPath;
}

async function sendLocalFile(res: Response, localPath: string, filename: string, mimeType: string): Promise<void> {
  setAttachmentHeaders(res, filename, mimeType);
  await new Promise<void>((resolve, reject) => {
    res.sendFile(localPath, err => {
      if (err) reject(err);
      else resolve();
    });
  });
}

interface MailboxAddressSource {
  direction: string | null;
  from_address: string | null;
  to_address: string | null;
  cc_addresses?: string[] | null;
}

interface EmailMailboxCount {
  address: string;
  unread: number;
  total: number;
}

interface EmailAttachmentAvailabilityRow {
  id: number;
  has_attachments: boolean | null;
  attachment_count: number | null;
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

function getAddressDomain(address: string): string | null {
  const normalized = normalizeMailAddress(address);
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex < 0 || atIndex === normalized.length - 1) return null;
  return normalized.slice(atIndex + 1);
}

function extractMailAddresses(input: string | string[] | null | undefined): string[] {
  const values = Array.isArray(input) ? input : input ? [input] : [];
  const result: string[] = [];
  for (const value of values) {
    const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    for (const match of matches) {
      const normalized = normalizeMailAddress(match);
      if (normalized) result.push(normalized);
    }
  }
  return result;
}

function findConfiguredMailbox(input: string | string[] | null | undefined, allowDomainFallback = false): string | null {
  const addresses = extractMailAddresses(input);
  const mailboxes = getCrmMailboxes();
  const mailboxSet = new Set(mailboxes);

  for (const address of addresses) {
    if (mailboxSet.has(address)) return address;
  }

  if (!allowDomainFallback) return null;

  for (const address of addresses) {
    const domain = getAddressDomain(address);
    if (!domain) continue;
    const domainMailboxes = mailboxes.filter(mailbox => getAddressDomain(mailbox) === domain);
    if (domainMailboxes.length === 1) return domainMailboxes[0];
  }

  return null;
}

function resolveMailboxAddress(source: MailboxAddressSource): string | null {
  if (source.direction === 'inbound') {
    return findConfiguredMailbox(source.to_address)
      || findConfiguredMailbox(source.cc_addresses)
      || null;
  }

  if (source.direction === 'outbound') {
    return findConfiguredMailbox(source.from_address, true)
      || findConfiguredMailbox(source.to_address)
      || findConfiguredMailbox(source.cc_addresses)
      || null;
  }

  return findConfiguredMailbox(source.to_address)
    || findConfiguredMailbox(source.cc_addresses)
    || findConfiguredMailbox(source.from_address, true)
    || null;
}

function withMailboxAddress<T extends MailboxAddressSource>(row: T): T & { mailbox_address: string | null } {
  return { ...row, mailbox_address: resolveMailboxAddress(row) };
}

function parseMailboxFilter(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const requested = normalizeMailAddress(input);
  if (!requested || requested === 'all') return null;
  if (!getCrmMailboxes().includes(requested)) {
    throw new AppError(400, 'mailbox must be one of configured CRM mailboxes');
  }
  return requested;
}

function buildMailboxCounts(rows: EmailMailboxCountSourceRow[]): EmailMailboxCount[] {
  const counts = new Map<string, EmailMailboxCount>();
  for (const address of getCrmMailboxes()) {
    counts.set(address, { address, unread: 0, total: 0 });
  }

  for (const row of rows) {
    const mailbox = resolveMailboxAddress(row);
    if (!mailbox) continue;
    const count = counts.get(mailbox) || { address: mailbox, unread: 0, total: 0 };
    count.total += 1;
    if (row.status === 'received') count.unread += 1;
    counts.set(mailbox, count);
  }

  return [...counts.values()];
}

const EMAIL_HAS_STORED_ATTACHMENT_SQL = `EXISTS (
  SELECT 1 FROM email_attachments ea
  WHERE ea.email_id = email_messages.id
    AND (ea.s3_key IS NOT NULL OR ea.storage_url IS NOT NULL)
)`;

const EMAIL_HAS_ATTACHMENT_SQL = `(COALESCE(email_messages.has_attachments, false) OR ${EMAIL_HAS_STORED_ATTACHMENT_SQL})`;

function mapEmailAttachmentRows(attachments: EmailAttachmentRow[]): Array<EmailAttachmentRow & { download_url: string }> {
  return attachments.map(attachment => ({
    ...attachment,
    download_url: `/api/crm/email/attachment/${attachment.id}/download`,
  }));
}

async function loadStoredEmailAttachments(emailId: number): Promise<EmailAttachmentRow[]> {
  return db.query<EmailAttachmentRow>(
    `SELECT id, filename, mime_type, size_bytes, storage_url,
            content_id, content_disposition
     FROM email_attachments
     WHERE email_id = $1
       AND (s3_key IS NOT NULL OR storage_url IS NOT NULL)
     ORDER BY id`,
    [emailId],
  );
}

async function loadEmailAttachments(emailId: number, hasAttachmentMetadata: boolean): Promise<EmailAttachmentRow[]> {
  let attachments = await loadStoredEmailAttachments(emailId);
  if (attachments.length > 0 || !hasAttachmentMetadata) return attachments;

  try {
    const backfill = await backfillEmailAttachments(emailId);
    if (backfill.available > 0 || backfill.saved > 0) {
      attachments = await loadStoredEmailAttachments(emailId);
    }
  } catch (err) {
    logger.warn('[CRM Email] Attachment backfill failed', {
      emailId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return attachments;
}

// ─── GET /email — inbox list ───────────────────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response) => {
  const requestedDirection = ((req.query['direction'] as string) || 'inbound').trim();
  const direction = requestedDirection === 'all'
    ? 'all'
    : requestedDirection === 'outbound'
      ? 'outbound'
      : 'inbound';
  const status = (req.query['status'] as string) || null;
  const search = ((req.query['search'] as string) || '').trim();
  const mailbox = parseMailboxFilter(req.query['mailbox']);
  const limit = Math.min(parseInt(req.query['limit'] as string) || 30, 100);
  const offset = parseInt(req.query['offset'] as string) || 0;

  const params: unknown[] = [];
  const conditions: string[] = [];
  let p = 1;

  if (direction !== 'all') {
    conditions.push(`direction = $${p++}`);
    params.push(direction);
  }

  if (status) {
    conditions.push(`status = $${p++}`);
    params.push(status);
  } else {
    // Default: don't show archived or drafts
    conditions.push(`status NOT IN ('archived', 'draft')`);
  }

  if (search) {
    conditions.push(`(from_address ILIKE $${p} OR to_address ILIKE $${p} OR subject ILIKE $${p} OR body_text ILIKE $${p})`);
    params.push(`%${search}%`);
    p++;
  }

  if (mailbox) {
    const domain = getAddressDomain(mailbox);
    conditions.push(`(
      (direction = 'inbound' AND (to_address ILIKE $${p} OR COALESCE(array_to_string(cc_addresses, ','), '') ILIKE $${p}))
      OR
      (direction = 'outbound' AND (from_address ILIKE $${p} OR from_address ILIKE $${p + 1}))
    )`);
    params.push(`%${mailbox}%`, domain ? `%@${domain}%` : `%${mailbox}%`);
    p += 2;
  }

  // v3 filters
  const starred = req.query['starred'] as string;
  if (starred === 'true') {
    conditions.push('is_starred = true');
  }
  const dateFrom = req.query['date_from'] as string;
  if (dateFrom) {
    conditions.push(`created_at >= $${p++}`);
    params.push(dateFrom);
  }
  const dateTo = req.query['date_to'] as string;
  if (dateTo) {
    conditions.push(`created_at <= $${p++}`);
    params.push(dateTo);
  }
  const hasAttachments = req.query['has_attachments'] as string;
  if (hasAttachments === 'true') {
    conditions.push(EMAIL_HAS_ATTACHMENT_SQL);
  }

  params.push(offset, limit);

  const rows = await db.query<EmailInboxRow>(
    `SELECT id, direction, from_address, to_address, cc_addresses, subject,
            LEFT(COALESCE(body_text, ''), 500) as body_text,
            status, customer_phone, thread_id,
            ${EMAIL_HAS_ATTACHMENT_SQL} AS has_attachments,
            is_starred, created_at, sent_by,
            COUNT(*) OVER() AS total_count
     FROM email_messages
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     OFFSET $${p} LIMIT $${p + 1}`,
    params
  );

  const total = rows.length > 0 ? parseInt(rows[0].total_count) : 0;

  res.json({
    success: true,
    data: rows.map(r => ({ ...withMailboxAddress(r), body_text: cleanPreview(r.body_text), total_count: undefined })),
    total,
  });
});

// ─── GET /email/counts — unread badge ─────────────────────────────────────

router.get('/counts', async (_req: AuthRequest, res: Response) => {
  const rows = await db.query<EmailMailboxCountSourceRow>(
    `SELECT direction, from_address, to_address, cc_addresses, status
     FROM email_messages
     WHERE direction = 'inbound' AND status != 'archived'`
  );
  const mailboxes = buildMailboxCounts(rows);
  const unread = mailboxes.reduce((sum, mailbox) => sum + mailbox.unread, 0);
  const total = mailboxes.reduce((sum, mailbox) => sum + mailbox.total, 0);

  res.json({
    success: true,
    data: {
      unread,
      total,
      mailboxes,
    },
  });
});

// ─── GET /email/templates ─────────────────────────────────────────────────

router.get('/templates', async (_req: AuthRequest, res: Response) => {
  const templates = await db.query(
    `SELECT id, slug, name, description, subject_template, body_template,
            variables, category, is_active, created_at
     FROM email_templates
     WHERE is_active = true
     ORDER BY category, name`
  );
  res.json({ success: true, data: templates });
});

// ─── GET /email/attachment/:attachmentId/download — force attachment download ─

router.get('/attachment/:attachmentId/download', async (req: AuthRequest, res: Response) => {
  const { attachmentId } = req.params;
  const attachment = await db.queryOne<EmailAttachmentDownloadRow>(
    `SELECT id, filename, mime_type, size_bytes, s3_key, storage_url
     FROM email_attachments
     WHERE id = $1`,
    [attachmentId]
  );

  if (!attachment) throw new AppError(404, 'Attachment not found');

  const filename = attachment.filename || 'attachment';
  const mimeType = attachment.mime_type || 'application/octet-stream';
  const storageKey = attachment.s3_key || (attachment.storage_url ? storageService.keyFromUrl(attachment.storage_url) : null);

  if (storageKey) {
    try {
      const { buffer } = await storageService.downloadToBuffer(storageKey);
      setAttachmentHeaders(res, filename, mimeType, buffer.length);
      res.send(buffer);
      return;
    } catch (err) {
      logger.warn('[CRM Email] Attachment proxy download failed, falling back to stored URL', {
        attachmentId: attachment.id,
        error: err instanceof Error ? err.message : String(err),
      });
      if (!attachment.storage_url) throw err;
    }
  }

  if (attachment.storage_url) {
    const localPath = resolveLocalUploadPath(attachment.storage_url);
    if (localPath) {
      await sendLocalFile(res, localPath, filename, mimeType);
      return;
    }

    res.redirect(attachment.storage_url);
    return;
  }

  throw new AppError(404, 'Attachment file is not available');
});

// ─── GET /email/:id/attachments — list attachments ───────────────────────

router.get('/:id/attachments', async (req: AuthRequest, res: Response) => {
  const emailId = parseRouteId(req.params.id);
  const email = await db.queryOne<EmailAttachmentAvailabilityRow>(
    `SELECT id, has_attachments, attachment_count
     FROM email_messages
     WHERE id = $1`,
    [emailId],
  );

  if (!email) throw new AppError(404, 'Email not found');

  const attachments = await loadEmailAttachments(emailId, Boolean(email.has_attachments) || Boolean(email.attachment_count));
  res.json({
    success: true,
    data: mapEmailAttachmentRows(attachments),
  });
});

// ─── GET /email/:id — single message ─────────────────────────────────────

router.get('/:id', async (req: AuthRequest, res: Response) => {
  const emailId = parseRouteId(req.params.id);

  const msg = await db.queryOne<EmailDetailRow>(
    `SELECT id, direction, from_address, to_address, cc_addresses, subject,
            body_text, body_html, status, customer_phone, thread_id, message_id,
            entity_type, entity_id, created_at, sent_by, has_attachments, attachment_count, is_starred
     FROM email_messages WHERE id = $1`,
    [emailId]
  );

  if (!msg) throw new AppError(404, 'Email not found');

  // Mark as read if was 'received'
  if (msg.status === 'received') {
    await db.query(
      `UPDATE email_messages SET status = 'read', updated_at = NOW() WHERE id = $1`,
      [emailId]
    );
    msg.status = 'read';
  }

  // Load thread (related messages by thread_id)
  let thread: EmailThreadRow[] = [];
  if (msg.thread_id) {
    thread = await db.query<EmailThreadRow>(
      `SELECT id, direction, from_address, to_address, cc_addresses, subject, status, created_at
       FROM email_messages
       WHERE thread_id = $1 AND id != $2
       ORDER BY created_at ASC`,
      [msg.thread_id, emailId]
    );
  }

  const attachments = await loadEmailAttachments(
    emailId,
    Boolean(msg.has_attachments) || Boolean(msg.attachment_count),
  );
  const attachmentData = mapEmailAttachmentRows(attachments);

  res.json({
    success: true,
    data: {
      ...withMailboxAddress(msg),
      has_attachments: Boolean(msg.has_attachments) || attachmentData.length > 0,
      attachments: attachmentData,
      thread: thread.map(withMailboxAddress),
    },
  });
});

// ─── PATCH /email/:id — update status ─────────────────────────────────────

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { status }: EmailStatusBody = req.body;

  const allowed = ['read', 'replied', 'archived'];
  if (!allowed.includes(status)) throw new AppError(400, `status must be one of: ${allowed.join(', ')}`);

  await db.query(
    `UPDATE email_messages SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, id]
  );

  res.json({ success: true });
});

// ─── PATCH /email/:id/star — toggle starred ──────────────────────────────

router.patch('/:id/star', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { starred }: EmailStarBody = req.body;

  if (typeof starred !== 'boolean') throw new AppError(400, 'starred (boolean) is required');

  await db.query(
    `UPDATE email_messages SET is_starred = $1, updated_at = NOW() WHERE id = $2`,
    [starred, id]
  );

  res.json({ success: true });
});

// ─── POST /email/:id/retry — retry failed email ─────────────────────────

router.post('/:id/retry', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const email = await db.queryOne<RetrySourceRow>(
    `SELECT id, from_address, to_address, cc_addresses, bcc_addresses, subject, body_html, body_text, status
     FROM email_messages WHERE id = $1 AND status = 'failed'`,
    [id]
  );

  if (!email) throw new AppError(404, 'Failed email not found');

  const senderAddress = resolveStoredSenderAddress(email.from_address);
  const smtp = getTransporter(senderAddress);
  if (!smtp) throw new AppError(503, `SMTP not configured for ${senderAddress}`);
  const { transport, account } = smtp;

  const ccList = email.cc_addresses?.length ? email.cc_addresses : null;
  const bccList = email.bcc_addresses?.length ? email.bcc_addresses : null;

  const mailOptions: Parameters<typeof transport.sendMail>[0] = {
    from: formatSenderAddress(account),
    to: email.to_address,
    subject: email.subject || '',
    ...(smtpReplyTo(account) ? { replyTo: smtpReplyTo(account) } : {}),
    ...(ccList ? { cc: ccList.join(', ') } : {}),
    ...(bccList ? { bcc: bccList.join(', ') } : {}),
    ...(email.body_html ? { html: email.body_html } : {}),
    ...(email.body_text ? { text: email.body_text } : {}),
  };

  try {
    await withServiceCall(SERVICE_BREAKERS.smtp, () => transport.sendMail(mailOptions));
    await db.query(
      `UPDATE email_messages SET status = 'sent', error_message = NULL, updated_at = NOW() WHERE id = $1`,
      [id]
    );
    logger.info(`[CRM Email] Retry succeeded for ${email.to_address}: ${email.subject}`);
    res.json({ success: true });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db.query(
      `UPDATE email_messages SET error_message = $1, updated_at = NOW() WHERE id = $2`,
      [errorMessage, id]
    );
    logger.error(`[CRM Email] Retry failed for ${email.to_address}:`, { detail: errorMessage });
    throw new AppError(502, `Retry failed: ${errorMessage}`);
  }
});

// ─── POST /email/send — outbound (reply, reply-all, forward, cc/bcc) ────

router.post('/send', async (req: AuthRequest, res: Response) => {
  const body: SendEmailBody = req.body;

  // If draft_id provided, load draft and merge with body
  if (body.draft_id) {
    const draft = await db.queryOne<DraftDetailRow>(
      `SELECT id, from_address, to_address, cc_addresses, bcc_addresses, subject, body_html, body_text, status, sent_by
       FROM email_messages WHERE id = $1`,
      [body.draft_id]
    );
    if (!draft) throw new AppError(404, 'Draft not found');
    if (draft.status !== 'draft') throw new AppError(400, 'Email is not a draft');

    body.from = body.from || draft.from_address;
    body.to = body.to || draft.to_address;
    body.subject = body.subject || draft.subject || undefined;
    body.body_html = body.body_html || draft.body_html || undefined;
    body.body_text = body.body_text || draft.body_text || undefined;
    if (!body.cc && draft.cc_addresses?.length) body.cc = draft.cc_addresses;
    if (!body.bcc && draft.bcc_addresses?.length) body.bcc = draft.bcc_addresses;
  }

  const {
    from, to, subject, body_html, body_text,
    template_slug, template_vars, reply_to_id, reply_all, forward_from_id,
    cc, bcc, entity_type, entity_id, customer_phone,
  } = body;

  if (!to) throw new AppError(400, 'to (recipient email) is required');
  const senderAddress = resolveRequestedSenderAddress(from);

  let finalSubject = subject || '';
  let finalBodyHtml = body_html || '';
  let finalBodyText = body_text || '';
  let inReplyToMsgId: string | null = null;
  let threadId: string | null = null;

  let ccList = parseAddressList(cc);
  const bccList = parseAddressList(bcc);

  // Template rendering
  if (template_slug) {
    const tmpl = await db.queryOne<EmailTemplateLookup>(
      'SELECT subject_template, body_template FROM email_templates WHERE slug = $1 AND is_active = true',
      [template_slug]
    );
    if (!tmpl) throw new AppError(404, `Template '${template_slug}' not found`);

    const vars = template_vars || {};
    finalSubject = applyTemplate(tmpl.subject_template, vars);
    finalBodyHtml = applyTemplate(tmpl.body_template, vars);
    finalBodyText = finalBodyHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Forward: load original email and build forwarded body
  if (forward_from_id) {
    const original = await db.queryOne<EmailForwardSourceRow>(
      `SELECT subject, body_html, body_text, from_address, to_address,
              created_at, message_id, thread_id
       FROM email_messages WHERE id = $1`,
      [forward_from_id]
    );
    if (!original) throw new AppError(404, 'Original email for forward not found');

    if (!finalSubject) {
      const subj = original.subject || '';
      finalSubject = subj.startsWith('Fwd:') ? subj : `Fwd: ${subj}`;
    }

    const fwdHeader = `<br><br>---------- Forwarded message ----------<br>` +
      `From: ${original.from_address}<br>` +
      `Date: ${original.created_at}<br>` +
      `Subject: ${original.subject}<br>` +
      `To: ${original.to_address}<br><br>`;

    const originalBody = original.body_html || original.body_text || '';
    if (finalBodyHtml) {
      finalBodyHtml = finalBodyHtml + fwdHeader + originalBody;
    } else {
      finalBodyHtml = fwdHeader + originalBody;
    }
    if (!finalBodyText) {
      finalBodyText = (original.body_text || '').slice(0, 50000);
    }

    threadId = original.thread_id || original.message_id;
  }

  // Reply-to: inherit thread_id and message-id; handle reply-all
  if (reply_to_id) {
    if (reply_all) {
      const original = await db.queryOne<ReplyAllSourceRow>(
        'SELECT message_id, thread_id, cc_addresses, to_address, from_address FROM email_messages WHERE id = $1',
        [reply_to_id]
      );
      if (original) {
        inReplyToMsgId = original.message_id;
        threadId = original.thread_id || original.message_id;

        // Build reply-all cc: original cc + original to_address, excluding our own addresses.
        const replyAllAddresses = new Set<string>();
        if (original.cc_addresses) {
          for (const addr of original.cc_addresses) {
            if (!isOwnMailAddress(addr)) replyAllAddresses.add(addr);
          }
        }
        if (original.to_address && !isOwnMailAddress(original.to_address)) {
          replyAllAddresses.add(original.to_address);
        }
        // Merge with explicit cc
        if (ccList) {
          for (const addr of ccList) replyAllAddresses.add(addr);
        }
        ccList = replyAllAddresses.size > 0 ? [...replyAllAddresses] : null;
      }
    } else {
      const original = await db.queryOne<EmailReplySourceRow>(
        'SELECT message_id, thread_id FROM email_messages WHERE id = $1',
        [reply_to_id]
      );
      if (original) {
        inReplyToMsgId = original.message_id;
        threadId = original.thread_id || original.message_id;
      }
    }
  }

  if (!finalSubject) throw new AppError(400, 'subject or template_slug is required');
  if (!finalBodyHtml && !finalBodyText) throw new AppError(400, 'body_html or body_text is required');

  const smtp = getTransporter(senderAddress);
  if (!smtp) throw new AppError(503, `SMTP not configured for ${senderAddress}`);
  const { transport, account } = smtp;

  let errorMessage: string | null = null;
  let sentStatus: 'sent' | 'failed' = 'sent';
  let generatedMsgId: string | null = null;

  // Load attachments for sending (from draft or explicit attachment_ids)
  const smtpAttachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  const attachSourceId = body.draft_id || null;
  const attachIds = body.attachment_ids || [];

  if (attachSourceId || attachIds.length) {
    const attachRows = await db.query<EmailAttachmentResult>(
      attachSourceId
        ? `SELECT id, filename, mime_type, size_bytes, storage_url FROM email_attachments WHERE email_id = $1`
        : `SELECT id, filename, mime_type, size_bytes, storage_url FROM email_attachments WHERE id = ANY($1)`,
      [attachSourceId || attachIds]
    );
    for (const att of attachRows) {
      if (!att.storage_url) continue;
      const key = storageService.keyFromUrl(att.storage_url);
      if (!key) continue;
      const { buffer } = await storageService.downloadToBuffer(key);
      smtpAttachments.push({ filename: att.filename, content: buffer, contentType: att.mime_type || 'application/octet-stream' });
    }
  }

  const mailOptions: Parameters<typeof transport.sendMail>[0] = {
    from: formatSenderAddress(account),
    to,
    subject: finalSubject,
    ...(smtpReplyTo(account) ? { replyTo: smtpReplyTo(account) } : {}),
    ...(ccList?.length ? { cc: ccList.join(', ') } : {}),
    ...(bccList?.length ? { bcc: bccList.join(', ') } : {}),
    ...(finalBodyHtml ? { html: finalBodyHtml } : {}),
    ...(finalBodyText ? { text: finalBodyText } : {}),
    ...(inReplyToMsgId ? { inReplyTo: inReplyToMsgId } : {}),
    ...(smtpAttachments.length ? { attachments: smtpAttachments } : {}),
  };

  try {
    const info = await withServiceCall(SERVICE_BREAKERS.smtp, () => transport.sendMail(mailOptions));
    generatedMsgId = info.messageId || null;
    threadId = threadId || generatedMsgId;
    logger.info(`[CRM Email] Sent to ${to}: ${finalSubject}`);
  } catch (err: unknown) {
    errorMessage = err instanceof Error ? err.message : String(err);
    sentStatus = 'failed';
    logger.error(`[CRM Email] Send failed to ${to}:`, { detail: errorMessage });
  }

  // Save to email_messages
  const saved = await db.queryOne<EmailSaveResult>(
    `INSERT INTO email_messages
       (direction, from_address, to_address, cc_addresses, bcc_addresses,
        subject, body_text, body_html,
        thread_id, in_reply_to, message_id, status, sent_by,
        entity_type, entity_id, customer_phone, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING id`,
    [
      'outbound',
      senderAddress,
      to,
      ccList?.length ? ccList : null,
      bccList?.length ? bccList : null,
      finalSubject,
      finalBodyText || null,
      finalBodyHtml || null,
      threadId,
      inReplyToMsgId,
      generatedMsgId,
      sentStatus,
      req.user!.id,
      entity_type || null,
      entity_id || null,
      customer_phone || null,
      errorMessage,
    ]
  );

  // Mark original as replied
  if (reply_to_id && sentStatus === 'sent') {
    await db.query(
      `UPDATE email_messages SET status = 'replied', updated_at = NOW() WHERE id = $1`,
      [reply_to_id]
    );
  }

  // If sent from draft: update draft status and move attachments
  if (body.draft_id && sentStatus === 'sent' && saved?.id) {
    await db.query(
      `UPDATE email_messages SET status = 'sent', updated_at = NOW() WHERE id = $1 AND status = 'draft'`,
      [body.draft_id]
    );
    // Move attachments from draft to the new sent message
    await db.query(
      `UPDATE email_attachments SET email_id = $1 WHERE email_id = $2`,
      [saved.id, body.draft_id]
    );
    // Delete the draft shell (data now lives in the sent message)
    await db.query(
      `DELETE FROM email_messages WHERE id = $1 AND status = 'sent' AND id != $2`,
      [body.draft_id, saved.id]
    );
  }

  // Link explicit attachment_ids
  if (body.attachment_ids?.length && saved?.id) {
    await linkAttachmentsToEmail(body.attachment_ids, saved.id);
  }

  if (sentStatus === 'failed') {
    throw new AppError(502, `Email delivery failed: ${errorMessage}`);
  }

  res.status(201).json({ success: true, data: { id: saved?.id, messageId: generatedMsgId } });
});

// ─── POST /email/:id/link — link to entity ────────────────────────────────

router.post('/:id/link', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { entity_type, entity_id }: EmailLinkBody = req.body;

  if (!entity_type || !entity_id) throw new AppError(400, 'entity_type and entity_id required');

  const valid = ['order', 'task', 'booking', 'chat', 'client'];
  if (!valid.includes(entity_type)) throw new AppError(400, `entity_type must be one of: ${valid.join(', ')}`);

  await db.query(
    `UPDATE email_messages SET entity_type = $1, entity_id = $2, updated_at = NOW() WHERE id = $3`,
    [entity_type, entity_id, id]
  );

  res.json({ success: true });
});

// ─── HELPERS ───────────────────────────────────────────────────────────────

function extractFromAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

function normalizeMailAddress(address: string): string {
  return extractFromAddress(address).trim().toLowerCase();
}

function resolveDefaultSenderAddress(): string {
  return getCrmMailboxes()[0] || normalizeMailAddress(config.smtp.from);
}

function resolveRequestedSenderAddress(address?: string): string {
  const requested = address ? normalizeMailAddress(address) : '';
  if (!requested) return resolveDefaultSenderAddress();
  if (getCrmMailboxes().includes(requested)) return requested;
  throw new AppError(400, 'from must be one of configured CRM mailboxes');
}

function resolveStoredSenderAddress(address?: string | null): string {
  if (!address) return resolveDefaultSenderAddress();
  return findConfiguredMailbox(address)
    || findConfiguredMailbox(address, true)
    || resolveDefaultSenderAddress();
}

function escapeSenderName(name: string): string {
  return name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function formatSenderAddress(account: SmtpAccountConfig): string {
  return `"${escapeSenderName(account.fromName)}" <${account.fromAddress}>`;
}

function smtpReplyTo(account: SmtpAccountConfig): string | undefined {
  return account.replyToAddress;
}

function isOwnMailAddress(address: string): boolean {
  const ownAddresses = new Set(
    [config.mail.address, extractFromAddress(config.smtp.from), ...config.mail.aliases]
      .map(normalizeMailAddress)
      .filter(Boolean),
  );
  const normalized = normalizeMailAddress(address);
  return ownAddresses.has(normalized)
    || extractMailAddresses(address).some(candidate => ownAddresses.has(candidate));
}

// ─── POST /email/upload-attachment/presign ────────────────────────────────

const emailUploadLimiter = createUploadLimiter('ul-email:', 50, 15 * 60 * 1000);

router.post('/upload-attachment/presign', emailUploadLimiter, async (req: AuthRequest, res: Response) => {
  const body: PresignAttachmentBody = req.body;
  if (!body.filename || !body.mime_type) throw new AppError(400, 'filename and mime_type are required');
  if (body.size_bytes && body.size_bytes > 25 * 1024 * 1024) throw new AppError(400, 'File exceeds 25MB limit');

  if (body.email_id) {
    const count = await db.queryOne<AttachmentCountRow>(
      'SELECT COUNT(*)::text AS cnt FROM email_attachments WHERE email_id = $1',
      [body.email_id]
    );
    if (parseInt(count?.cnt || '0') >= 10) throw new AppError(400, 'Maximum 10 attachments per email');
  }

  const uuid = uuidv4();
  const safeFilename = body.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const s3Key = `email-attachments/${uuid}/${safeFilename}`;
  const { url } = await storageService.generatePresignedPutUrl(s3Key, body.mime_type);

  res.json({ success: true, data: { upload_url: url, s3_key: s3Key, uuid } });
});

// ─── POST /email/upload-attachment/complete ───────────────────────────────

router.post('/upload-attachment/complete', async (req: AuthRequest, res: Response) => {
  const body: CompleteAttachmentBody = req.body;
  if (!body.s3_key || !body.filename || !body.mime_type) {
    throw new AppError(400, 's3_key, filename, and mime_type are required');
  }

  const head = await storageService.headObject(body.s3_key);
  if (!head) throw new AppError(404, 'File not found in S3 — upload may have failed');

  const storageUrl = storageService.getPublicUrl(body.s3_key);
  const saved = await db.queryOne<EmailAttachmentResult>(
    `INSERT INTO email_attachments (email_id, filename, mime_type, size_bytes, s3_key, storage_url, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, filename, mime_type, size_bytes, storage_url`,
    [body.email_id || null, body.filename, body.mime_type, head.contentLength, body.s3_key, storageUrl, req.user!.id]
  );

  if (body.email_id) {
    await db.query(
      `UPDATE email_messages
       SET has_attachments = true,
           attachment_count = (SELECT COUNT(*) FROM email_attachments WHERE email_id = $1),
           updated_at = NOW()
       WHERE id = $1`,
      [body.email_id]
    );
  }

  res.status(201).json({ success: true, data: saved });
});

// ─── POST /email/draft — create draft ────────────────────────────────────

router.post('/draft', async (req: AuthRequest, res: Response) => {
  const body: DraftSaveBody = req.body;
  const senderAddress = resolveRequestedSenderAddress(body.from);
  const ccList = parseAddressList(body.cc);
  const bccList = parseAddressList(body.bcc);

  const draft = await db.queryOne<DraftIdResult>(
    `INSERT INTO email_messages
       (direction, from_address, to_address, cc_addresses, bcc_addresses,
        subject, body_html, body_text, status, sent_by,
        entity_type, entity_id, customer_phone)
     VALUES ('outbound', $1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9, $10, $11)
     RETURNING id`,
    [
      senderAddress,
      body.to || '',
      ccList,
      bccList,
      body.subject || null,
      body.body_html || null,
      body.body_text || null,
      req.user!.id,
      body.entity_type || null,
      body.entity_id || null,
      body.customer_phone || null,
    ]
  );

  if (draft && body.attachment_ids?.length) {
    await linkAttachmentsToEmail(body.attachment_ids, draft.id);
  }

  res.status(201).json({ success: true, data: { id: draft?.id } });
});

// ─── PUT /email/draft/:id — update draft ─────────────────────────────────

router.put('/draft/:id', async (req: AuthRequest, res: Response) => {
  const draftId = parseRouteId(req.params.id);
  const body: DraftSaveBody = req.body;
  const senderAddress = body.from ? resolveRequestedSenderAddress(body.from) : null;
  const ccList = parseAddressList(body.cc);
  const bccList = parseAddressList(body.bcc);

  const result = await db.queryOne<DraftIdResult>(
    `UPDATE email_messages
     SET from_address = COALESCE($1, from_address),
         to_address = COALESCE($2, to_address),
         cc_addresses = $3,
         bcc_addresses = $4,
         subject = COALESCE($5, subject),
         body_html = COALESCE($6, body_html),
         body_text = COALESCE($7, body_text),
         updated_at = NOW()
     WHERE id = $8 AND status = 'draft' AND sent_by = $9
     RETURNING id`,
    [senderAddress, body.to || null, ccList, bccList, body.subject, body.body_html, body.body_text, draftId, req.user!.id]
  );

  if (!result) throw new AppError(404, 'Draft not found or not owned by you');

  if (body.attachment_ids?.length) {
    await linkAttachmentsToEmail(body.attachment_ids, draftId);
  }

  res.json({ success: true, data: { id: result.id } });
});

// ─── DELETE /email/draft/:id — delete draft ──────────────────────────────

router.delete('/draft/:id', async (req: AuthRequest, res: Response) => {
  const draftId = parseRouteId(req.params.id);
  const result = await db.queryOne<DraftIdResult>(
    `DELETE FROM email_messages WHERE id = $1 AND status = 'draft' AND sent_by = $2 RETURNING id`,
    [draftId, req.user!.id]
  );
  if (!result) throw new AppError(404, 'Draft not found or not owned by you');
  res.json({ success: true });
});

// ─── POST /email/bulk — bulk actions ─────────────────────────────────────

router.post('/bulk', async (req: AuthRequest, res: Response) => {
  const body: BulkActionBody = req.body;
  if (!body.ids?.length) throw new AppError(400, 'ids array is required');
  if (!body.action) throw new AppError(400, 'action is required');

  const validActions = ['archive', 'read', 'unread', 'delete'];
  if (!validActions.includes(body.action)) {
    throw new AppError(400, `action must be one of: ${validActions.join(', ')}`);
  }

  let result: BulkActionResult | null = null;

  switch (body.action) {
    case 'archive':
      result = await db.queryOne<BulkActionResult>(
        `WITH updated AS (
           UPDATE email_messages SET status = 'archived', updated_at = NOW()
           WHERE id = ANY($1) RETURNING id
         ) SELECT COUNT(*)::text AS affected FROM updated`,
        [body.ids]
      );
      break;
    case 'read':
      result = await db.queryOne<BulkActionResult>(
        `WITH updated AS (
           UPDATE email_messages SET status = 'read', updated_at = NOW()
           WHERE id = ANY($1) AND status = 'received' RETURNING id
         ) SELECT COUNT(*)::text AS affected FROM updated`,
        [body.ids]
      );
      break;
    case 'unread':
      result = await db.queryOne<BulkActionResult>(
        `WITH updated AS (
           UPDATE email_messages SET status = 'received', updated_at = NOW()
           WHERE id = ANY($1) AND status = 'read' RETURNING id
         ) SELECT COUNT(*)::text AS affected FROM updated`,
        [body.ids]
      );
      break;
    case 'delete':
      result = await db.queryOne<BulkActionResult>(
        `WITH deleted AS (
           DELETE FROM email_messages WHERE id = ANY($1) AND status = 'archived' RETURNING id
         ), archived AS (
           UPDATE email_messages SET status = 'archived', updated_at = NOW()
           WHERE id = ANY($1) AND status != 'archived' RETURNING id
         ) SELECT ((SELECT COUNT(*) FROM deleted) + (SELECT COUNT(*) FROM archived))::text AS affected`,
        [body.ids]
      );
      break;
  }

  res.json({ success: true, data: { affected: parseInt(result?.affected || '0') } });
});

/** Link orphan attachments to an email and update counters. */
async function linkAttachmentsToEmail(attachmentIds: number[], emailId: number): Promise<void> {
  if (!attachmentIds.length) return;
  await db.query(
    `UPDATE email_attachments SET email_id = $1 WHERE id = ANY($2) AND email_id IS NULL`,
    [emailId, attachmentIds]
  );
  await db.query(
    `UPDATE email_messages
     SET has_attachments = true,
         attachment_count = (SELECT COUNT(*) FROM email_attachments WHERE email_id = $1),
         updated_at = NOW()
     WHERE id = $1`,
    [emailId]
  );
}

export default router;
