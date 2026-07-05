/** View types for CRM email routes. */

import type EmailAttachments from '../generated/public/EmailAttachments.js';
import type EmailMessages from '../generated/public/EmailMessages.js';
import type EmailTemplates from '../generated/public/EmailTemplates.js';

/** Inbox list row (GET /email). */
export type EmailInboxRow = Pick<
  EmailMessages,
  'id' | 'direction' | 'from_address' | 'to_address' | 'cc_addresses' | 'subject' | 'body_text' |
  'status' | 'customer_phone' | 'thread_id' | 'has_attachments' | 'is_starred' | 'created_at' | 'sent_by'
> & { total_count: string };

/** Single email detail (GET /email/:id). */
export type EmailDetailRow = Pick<
  EmailMessages,
  'id' | 'direction' | 'from_address' | 'to_address' | 'cc_addresses' | 'subject' |
  'body_text' | 'body_html' | 'status' | 'customer_phone' | 'thread_id' | 'message_id' |
  'entity_type' | 'entity_id' | 'created_at' | 'sent_by' | 'has_attachments' | 'attachment_count' | 'is_starred'
>;

/** Thread sibling row. */
export type EmailThreadRow = Pick<
  EmailMessages,
  'id' | 'direction' | 'from_address' | 'to_address' | 'cc_addresses' | 'subject' | 'status' | 'created_at'
>;

/** Attachment list row (GET /email/:id/attachments). */
export type EmailAttachmentRow = Pick<
  EmailAttachments,
  'id' | 'filename' | 'mime_type' | 'size_bytes' | 'storage_url' | 'content_id' | 'content_disposition'
>;

/** Attachment download lookup row. */
export type EmailAttachmentDownloadRow = Pick<
  EmailAttachments,
  'id' | 'filename' | 'mime_type' | 'size_bytes' | 's3_key' | 'storage_url'
>;

/** Unread counts (GET /email/counts). */
export interface EmailCountsRow {
  unread: string;
  total: string;
}

/** Source row for mailbox-aware unread counts. */
export type EmailMailboxCountSourceRow = Pick<
  EmailMessages,
  'direction' | 'from_address' | 'to_address' | 'cc_addresses' | 'status'
>;

/** Upload complete result (POST /email/upload-attachment/complete). */
export type EmailAttachmentResult = Pick<
  EmailAttachments,
  'id' | 'filename' | 'mime_type' | 'size_bytes' | 'storage_url'
>;

/** COUNT for attachments check. */
export interface AttachmentCountRow {
  cnt: string;
}

/** Draft save result. */
export type DraftIdResult = Pick<EmailMessages, 'id'>;

/** Bulk action result. */
export interface BulkActionResult {
  affected: string;
}

/** Forward source row. */
export type EmailForwardSourceRow = Pick<
  EmailMessages,
  'subject' | 'body_html' | 'body_text' | 'from_address' | 'to_address' |
  'created_at' | 'message_id' | 'thread_id'
>;

/** Reply source row. */
export type EmailReplySourceRow = Pick<EmailMessages, 'message_id' | 'thread_id'>;

/** Draft detail for send-draft. */
export type DraftDetailRow = Pick<
  EmailMessages,
  'id' | 'from_address' | 'to_address' | 'cc_addresses' | 'subject' | 'body_html' | 'body_text' | 'status' | 'sent_by'
> & { bcc_addresses: string[] | null };

// ─── Request body interfaces ─────────────────────────────────────────────

export interface PresignAttachmentBody {
  filename: string;
  mime_type: string;
  size_bytes?: number;
  email_id?: number;
}

export interface CompleteAttachmentBody {
  s3_key: string;
  filename: string;
  mime_type: string;
  size_bytes?: number;
  email_id?: number;
}

export interface DraftSaveBody {
  from?: string;
  to?: string;
  subject?: string;
  body_html?: string;
  body_text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  reply_to_id?: number;
  attachment_ids?: number[];
  entity_type?: string;
  entity_id?: string;
  customer_phone?: string;
}

export interface BulkActionBody {
  ids: number[];
  action: 'archive' | 'read' | 'unread' | 'delete';
}

export interface SendEmailBody {
  from?: string;
  to: string;
  subject?: string;
  body_html?: string;
  body_text?: string;
  template_slug?: string;
  template_vars?: Record<string, string>;
  reply_to_id?: number;
  reply_all?: boolean;
  forward_from_id?: number;
  cc?: string | string[];
  bcc?: string | string[];
  entity_type?: string;
  entity_id?: string;
  customer_phone?: string;
  draft_id?: number;
  attachment_ids?: number[];
}

/** Reply-all source row. */
export type ReplyAllSourceRow = Pick<
  EmailMessages,
  'message_id' | 'thread_id' | 'cc_addresses' | 'to_address' | 'from_address'
>;

/** Retry source row. */
export type RetrySourceRow = Pick<
  EmailMessages,
  'id' | 'from_address' | 'to_address' | 'cc_addresses' | 'subject' | 'body_html' | 'body_text' | 'status'
> & { bcc_addresses: string[] | null };

/** Template lookup for rendering. */
export type EmailTemplateLookup = Pick<EmailTemplates, 'subject_template' | 'body_template'>;

/** Email save result (INSERT ... RETURNING id). */
export type EmailSaveResult = Pick<EmailMessages, 'id'>;

/** Status update body. */
export interface EmailStatusBody {
  status: string;
}

/** Link entity body. */
export interface EmailLinkBody {
  entity_type: string;
  entity_id: string;
}

/** Star body. */
export interface EmailStarBody {
  starred: boolean;
}
