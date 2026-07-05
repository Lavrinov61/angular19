/** JSONB contract for messages.metadata */

export interface InteractiveButton {
  id: string;
  label: string;
  url?: string;
  color?: string;
}

export interface ApprovalGalleryVariantMetadata {
  id?: string;
  thumbnailUrl?: string;
  url?: string;
  is_selected?: boolean;
}

export interface ApprovalGalleryPhotoMetadata {
  id: string;
  status: string;
  thumbnailUrl?: string | null;
  retouchedUrl?: string | null;
  variants?: ApprovalGalleryVariantMetadata[];
}

export interface InteractiveMetadata {
  type: 'buttons';
  buttons: InteractiveButton[];
  sessionId?: string;
  approvalAction?: 'final_delivery' | string;
}

export interface ApprovalGalleryInteractiveMetadata {
  type: 'approval_gallery';
  sessionId: string;
  buttons?: InteractiveButton[];
  photos?: ApprovalGalleryPhotoMetadata[];
  reviewUrl?: string;
  crmUrl?: string;
}

export interface ReactionUser {
  userId: string;
  userName: string;
}

/** emoji → list of users who reacted with it */
export interface MessageReactions {
  [emoji: string]: ReactionUser[];
}

export type MediaProcessingStatus = 'processing' | 'uploaded' | 'failed';

export interface MediaStatusMetadata {
  status: MediaProcessingStatus;
  reasonCode?: string;
  operatorMessage?: string;
  clientMessage?: string;
  clientNotified?: boolean;
  failedAt?: string;
}

export interface MessageMetadata {
  interactive?: InteractiveMetadata | ApprovalGalleryInteractiveMetadata;
  gallery?: string[];
  hiddenInUi?: boolean;
  reactions?: MessageReactions;
  edited?: boolean;
  mediaStatus?: MediaStatusMetadata;
  payment?: {
    orderId?: string;
    amount?: number;
    status?: string;
    items?: { name: string; price: number }[];
  };
}

/** Safely parse message JSONB metadata (handles string and object). */
export function parseMessageMetadata(raw: unknown): MessageMetadata | null {
  if (!raw) return null;
  const parsed = typeof raw === 'string'
    ? (() => { try { return JSON.parse(raw); } catch { return null; } })()
    : raw;
  if (parsed && typeof parsed === 'object') return parsed as MessageMetadata;
  return null;
}
