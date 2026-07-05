/** Instagram Graph API types (webhook payload + API responses). */

export interface IgAttachment {
  type: string;
  payload?: { url?: string };
}

export interface IgMessage {
  mid?: string;
  text?: string;
  attachments?: IgAttachment[];
  reply_to?: { mid: string };
}

export interface IgMessaging {
  sender?: { id: string };
  message?: IgMessage;
}

export interface IgEntry {
  messaging?: IgMessaging[];
}

export interface IgWebhookBody {
  entry?: IgEntry[];
}

export interface IgApiResponse {
  message_id?: string;
}
