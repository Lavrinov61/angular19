/** View types for photo approval domain — composed from Kanel + JSONB contracts. */

import type PhotoApprovals from '../generated/public/PhotoApprovals.js';
import type { PhotoApprovalsId } from '../generated/public/PhotoApprovals.js';
import type PhotoApprovalSessions from '../generated/public/PhotoApprovalSessions.js';
import type { PhotoApprovalSessionsId } from '../generated/public/PhotoApprovalSessions.js';
import type PhotoPrintOrders from '../generated/public/PhotoPrintOrders.js';
import type Photos from '../generated/public/Photos.js';
import type { PhotoAnnotation } from '../jsonb/annotation-jsonb.js';

// Re-export branded IDs
export type { PhotoApprovalsId } from '../generated/public/PhotoApprovals.js';
export type { PhotoApprovalSessionsId } from '../generated/public/PhotoApprovalSessions.js';

// ── Photo Approvals ────────────────────────────────────────────────────────

/** Photo approval row (full projection used in API). */
export interface PhotoApprovalRow {
  id: PhotoApprovalsId;
  retouched_photo_url: string | null;
  thumbnail_url: string | null;
  original_photo_url: string | null;
  original_thumbnail_url: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested';
  comment: string | null;
  client_id: PhotoApprovals['client_id'];
  photographer_id: PhotoApprovals['photographer_id'];
  approval_session_id: PhotoApprovals['approval_session_id'];
  selected_variant_id: string | null;
  approved_at: string | null;
  approved_by: PhotoApprovals['approved_by'];
  approved_by_role: string | null;
  rejected_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Photo approval session row. */
export interface PhotoApprovalSessionRow {
  id: PhotoApprovalSessionsId;
  client_id: PhotoApprovalSessions['client_id'];
  status: string | null;
  public_token: string;
  total_photos: number | null;
  current_revision_round: number | null;
  chat_session_id: string | null;
  link_sent_via: string | null;
  created_at: string | null;
  completed_at: string | null;
}

/** Approval statistics (aggregate counts → string). */
export interface ApprovalStats {
  total: string;
  approved: string;
  rejected: string;
}

/** Photo approval variant row. */
export interface PhotoApprovalVariantRow {
  id: string;
  variant_url: string;
  thumbnail_url: string | null;
  label: string | null;
  sort_order: number;
  is_selected?: boolean;
}

/** Conversation channel info for approval notifications. */
export interface ConversationChannelInfo {
  id: string;
  channel: string;
  external_chat_id: string | null;
  metadata: unknown;
}

export interface ChatSessionId {
  chat_session_id: string | null;
}

/** Approval session projection for order-status sync. */
export interface ApprovalOrderSyncSessionRow {
  order_id: string | null;
  chat_session_id: string | null;
  status: string | null;
}

/** Photo print order projection for approval-driven status sync. */
export interface ApprovalOrderSyncOrderRow {
  order_id: Pick<PhotoPrintOrders, 'order_id'>['order_id'];
  status: Pick<PhotoPrintOrders, 'status'>['status'];
}

/** Photo status summary for WS broadcast after review action. */
export interface PhotoStatusRow {
  id: PhotoApprovalsId;
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested';
  thumbnail_url: string | null;
}

/** Downloadable photo item (for client download endpoint). */
export interface DownloadablePhotoRow {
  id: string;
  url: string;
  file_name: string | null;
}

/** Classic photo download projection (photos + files JOIN). */
export interface ClassicPhotoDownloadRow {
  id: Pick<Photos, 'id'>['id'];
  file_url: Pick<Photos, 'file_url'>['file_url'];
  original_name: string | null;
}

/** Approval photo download projection. */
export interface ApprovalPhotoDownloadRow {
  id: PhotoApprovalsId;
  retouched_photo_url: Pick<PhotoApprovals, 'retouched_photo_url'>['retouched_photo_url'];
  title: string | null;
}

// Re-export PhotoAnnotation for convenience
export type { PhotoAnnotation } from '../jsonb/annotation-jsonb.js';
