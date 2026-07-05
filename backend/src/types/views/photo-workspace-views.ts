import type { PhotoPrintOrdersId } from '../generated/public/PhotoPrintOrders.js';
import type { PhotoApprovalSessionsId } from '../generated/public/PhotoApprovalSessions.js';
import type { PhotoApprovalsId } from '../generated/public/PhotoApprovals.js';
import type { PhotoApprovalVariantsId } from '../generated/public/PhotoApprovalVariants.js';
import type { AiRetouchJobsId } from '../generated/public/AiRetouchJobs.js';
import type { UsersId } from '../generated/public/Users.js';
import type { PhotoWorkspaceCropPayloadJsonb, PhotoWorkspaceJournalPayloadJsonb } from '../jsonb/photo-workspace-jsonb.js';

export interface PhotoWorkspaceItemRow {
  id: string;
  order_id: PhotoPrintOrdersId;
  approval_session_id: PhotoApprovalSessionsId | null;
  source_asset_id: string | null;
  source_asset_url: string;
  source_asset_name: string;
  label: string;
  document_type: string;
  tariff_level: string;
  variant_limit: number;
  crop_payload: PhotoWorkspaceCropPayloadJsonb | Record<string, never>;
  crop_job_id: AiRetouchJobsId | null;
  crop_result_url: string | null;
  crop_result_thumbnail_url: string | null;
  status: string;
  active_section: string;
  created_by: UsersId | null;
  updated_by: UsersId | null;
  created_at: string;
  updated_at: string;
}

export interface PhotoWorkspaceReferenceRow {
  id: string;
  item_id: string;
  asset_id: string | null;
  asset_url: string;
  asset_name: string;
  thumbnail_url: string | null;
  source: string;
  roles: string[];
  use_in_ai: boolean;
  description: string;
  created_by: UsersId | null;
  created_at: string;
  updated_at: string;
}

export interface PhotoWorkspaceWishRow {
  id: string;
  item_id: string;
  source_type: string;
  source_id: string | null;
  source_label: string | null;
  text: string;
  status: string;
  reject_reason: string | null;
  created_by: UsersId | null;
  updated_by: UsersId | null;
  created_at: string;
  updated_at: string;
}

export interface PhotoWorkspaceVariantRow {
  id: string;
  item_id: string;
  slot_number: number;
  source_type: string;
  internal_name: string;
  preset_slug: string;
  preset_label: string;
  enabled: boolean;
  base_prompt: string;
  manual_prompt: string;
  final_prompt: string;
  prompt_ready: boolean;
  status: string;
  ai_job_id: AiRetouchJobsId | null;
  ai_original_url: string | null;
  ai_original_thumbnail_url: string | null;
  ai_original_expires_at: string | null;
  photoshop_url: string | null;
  photoshop_thumbnail_url: string | null;
  photoshop_uploaded_by: UsersId | null;
  photoshop_uploaded_at: string | null;
  checked_by: UsersId | null;
  checked_at: string | null;
  approval_photo_id: PhotoApprovalsId | null;
  approval_variant_id: PhotoApprovalVariantsId | null;
  approval_position_kind: 'primary' | 'variant' | null;
  sent_at: string | null;
  downloaded_at: string | null;
  error_message: string | null;
  created_by: UsersId | null;
  updated_by: UsersId | null;
  created_at: string;
  updated_at: string;
}

export interface PhotoWorkspaceJournalRow {
  id: string;
  order_id: PhotoPrintOrdersId;
  item_id: string | null;
  variant_id: string | null;
  event_type: string;
  actor_id: UsersId | null;
  payload: PhotoWorkspaceJournalPayloadJsonb;
  created_at: string;
  expires_at: string;
}

export interface PhotoWorkspaceOrderWishSourceRow {
  comments: string | null;
  wishes: string | null;
}

export interface PhotoWorkspaceOrderProcessingSourceRow {
  items: unknown;
}

export interface PhotoWorkspaceApprovalFeedbackWishSourceRow {
  source_id: string;
  source_label: string;
  text: string;
  created_at: string | null;
}

export interface PhotoWorkspaceNotificationBatchRow {
  id: string;
  order_id: PhotoPrintOrdersId;
  approval_session_id: PhotoApprovalSessionsId;
  status: 'scheduled' | 'sent' | 'cancelled';
  pending_change_count: number;
  message_text: string;
  scheduled_for: string;
  last_change_at: string;
  created_by: UsersId | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PhotoWorkspaceApprovalSessionLinkRow {
  link_sent_at: string | null;
}

export interface PhotoWorkspaceEnvelope {
  item: PhotoWorkspaceItemRow;
  references: PhotoWorkspaceReferenceRow[];
  wishes: PhotoWorkspaceWishRow[];
  variants: PhotoWorkspaceVariantRow[];
}
