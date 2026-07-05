export interface StaffConversation {
  id: string;
  title: string | null;
  type: 'direct' | 'group' | 'general';
  created_by: string | null;
  last_message_at: string;
  last_message_preview: string;
  created_at: string;
  archived_at?: string | null;
  unread_count: number;
  participants: StaffParticipant[];
}

export interface StaffParticipant {
  user_id: string;
  display_name: string | null;
  email: string;
  role?: 'owner' | 'admin' | 'member';
  muted_until?: string | null;
  is_active?: boolean;
  last_seen_at?: string | null;
}

export type StaffMessageType = 'text' | 'image' | 'file' | 'video' | 'audio';

export interface StaffMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  content: string;
  message_type: StaffMessageType;
  attachment_url: string | null;
  original_filename: string | null;
  reply_to_message_id: string | null;
  reply_to_content: string | null;
  reply_to_sender_name: string | null;
  reply_to_message_type?: StaffMessageType | null;
  reply_to_attachment_url?: string | null;
  reply_to_original_filename?: string | null;
  deleted_at?: string | null;
  edited_at?: string | null;
  is_forwarded?: boolean;
  forwarded_from_name?: string | null;
  reactions?: StaffReaction[];
  pinned_at?: string | null;
  pinned_by?: string | null;
  created_at: string;
}

export interface StaffReaction {
  emoji: string;
  count: number;
  users: string[];
  myReaction: boolean;
}

export interface StaffMessageView extends StaffMessage {
  _isGrouped: boolean;
  _showAvatar: boolean;
  _showDate: boolean;
  _isOwn: boolean;
  _prevTsMs: number;
}
