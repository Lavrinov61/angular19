export const CRM_MAIL_ACCOUNTS = [
  { address: 'info@svoefoto.ru', label: 'Своё Фото', shortLabel: 'svoefoto' },
  { address: 'info@fmagnus.org', label: 'FMagnus', shortLabel: 'fmagnus' },
] as const;

export const CRM_MAIL_ACCOUNT_ADDRESS = CRM_MAIL_ACCOUNTS[0].address;
export const CRM_MAIL_ACCOUNT_ALIASES = ['info@svoefoto.ru', 'info@fmagnus.org'] as const;

export interface EmailMessage {
  id: number;
  direction: 'inbound' | 'outbound';
  from_address: string;
  to_address: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  status: 'received' | 'read' | 'replied' | 'archived' | 'sent' | 'failed' | 'draft';
  customer_phone: string | null;
  thread_id: string | null;
  has_attachments: boolean;
  is_starred: boolean;
  created_at: string;
  mailbox_address: string | null;
}

export interface EmailAttachment {
  id: number;
  filename: string;
  original_name?: string | null;
  mime_type: string | null;
  size_bytes: number | string | null;
  storage_url: string | null;
  download_url?: string | null;
}

export interface EmailDetail extends EmailMessage {
  cc_addresses: string[] | null;
  entity_type: string | null;
  entity_id: string | null;
  message_id: string | null;
  attachments?: EmailAttachment[];
  thread: {
    id: number;
    direction: string;
    from_address: string;
    subject: string;
    status: string;
    created_at: string;
    mailbox_address?: string | null;
  }[];
}

export interface EmailTemplate {
  id: number;
  slug: string;
  name: string;
  description: string;
  subject_template: string;
  body_template: string;
  category: string;
}
