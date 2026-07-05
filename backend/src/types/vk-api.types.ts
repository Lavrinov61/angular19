/** VK API types (webhook payload + API responses). */

export interface VkPhoto {
  sizes: Array<{ url: string; width: number; height: number }>;
}

export interface VkDoc {
  url: string;
  title: string;
  mime_type?: string;
}

export interface VkAudioMessage {
  link_ogg?: string;
  link_mp3?: string;
}

export interface VkVideo {
  id: number;
  owner_id: number;
  title?: string;
  player?: string;
  duration?: number;
}

export interface VkAudio {
  id: number;
  owner_id: number;
  artist?: string;
  title?: string;
  url?: string;
  duration?: number;
}

export interface VkAttachment {
  type: string;
  photo?: VkPhoto;
  doc?: VkDoc;
  audio_message?: VkAudioMessage;
  video?: VkVideo;
  audio?: VkAudio;
}

export interface VkMessage {
  id: number;
  from_id: number;
  text: string;
  attachments?: VkAttachment[];
  fwd_messages?: VkMessage[];
  reply_message?: VkMessage;
}

export interface VkWebhookBody {
  type: string;
  object?: { message?: VkMessage };
  group_id?: number;
}

export interface VkApiResponse<T = unknown> {
  response?: T;
  error?: { error_code: number; error_msg: string };
}
