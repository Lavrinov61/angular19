/** Telegram Bot API types (webhook payload + API responses). */

export interface TgChat {
  id: number;
  title?: string;
  type?: string;
}

export interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TgPhotoSize {
  file_id: string;
  width: number;
  height: number;
}

export interface TgVideo {
  file_id: string;
  mime_type?: string;
}

export interface TgVoice {
  file_id: string;
  mime_type?: string;
  duration: number;
}

export interface TgAudio {
  file_id: string;
  mime_type?: string;
}

export interface TgDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
}

export interface TgForwardOrigin {
  type: string;
  sender_user?: TgUser;
  chat?: TgChat;
}

export interface TgMessage {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  photo?: TgPhotoSize[];
  video?: TgVideo;
  voice?: TgVoice;
  audio?: TgAudio;
  document?: TgDocument;
  sticker?: { emoji?: string };
  contact?: { phone_number: string };
  forward_origin?: TgForwardOrigin;
  forward_from?: TgUser;
  reply_to_message?: TgMessage;
}

export interface TgCallbackQuery {
  id: string;
  data?: string;
  message?: TgMessage;
  from: TgUser;
}

export interface TgWebhookBody {
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export interface TgApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
}

export interface TgFileInfo {
  file_id: string;
  file_path: string;
}
