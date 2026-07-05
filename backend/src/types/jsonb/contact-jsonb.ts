/** JSONB contract for contacts.metadata */

export interface ContactChannelMeta {
  phone?: string;
  username?: string;
  externalChatId?: string;
  channel?: string;
}

export interface ContactDeletedMeta {
  deleted_phone: string;
}

export type ContactMetadata = ContactChannelMeta & Partial<ContactDeletedMeta>;
