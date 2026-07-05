/** Max (OK.ru) Messenger API types. */

export interface MaxSender {
  user_id: number;
  name?: string;
  username?: string;
}

export interface MaxAttachment {
  type: string;
  payload?: { url?: string; fileName?: string };
}

export interface MaxMessageBody {
  mid?: string;
  text?: string;
  attachments?: MaxAttachment[];
}

export interface MaxLink {
  type: string;
  message?: MaxMessage;
  sender?: MaxSender;
}

export interface MaxMessage {
  sender?: MaxSender;
  recipient?: { chat_id: number };
  body?: MaxMessageBody;
  link?: MaxLink;
}

export interface MaxWebhookBody {
  message?: MaxMessage;
}

export interface MaxApiResponse {
  body?: { mid?: string };
}
