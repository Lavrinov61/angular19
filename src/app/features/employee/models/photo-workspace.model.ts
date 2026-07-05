export type PhotoWorkspaceJsonPrimitive = string | number | boolean | null;
export type PhotoWorkspaceJsonValue = PhotoWorkspaceJsonPrimitive | PhotoWorkspaceJsonObject | PhotoWorkspaceJsonValue[];

export interface PhotoWorkspaceJsonObject {
  [key: string]: PhotoWorkspaceJsonValue | undefined;
}

export type PhotoWorkspaceTariffLevel = 'basic' | 'extended' | 'maximum' | 'super';
export type PhotoWorkspaceReferenceRoleSlug =
  | 'glasses'
  | 'hair'
  | 'clothing'
  | 'background'
  | 'makeup'
  | 'pose'
  | 'style'
  | 'other';
export type PhotoWorkspaceWishStatus = 'pending' | 'accepted' | 'rejected';
export type PhotoWorkspaceReadinessBlocker =
  | 'crop_missing'
  | 'wish_pending'
  | 'reference_role_missing'
  | 'variant_prompt_missing';
export type PhotoWorkspaceVariantStatus =
  | 'planned'
  | 'pending_generation'
  | 'generating'
  | 'ai_generated'
  | 'needs_photoshop_check'
  | 'downloaded_for_check'
  | 'photoshop_uploaded'
  | 'checked'
  | 'sent_to_client'
  | 'error'
  | 'stale_after_recrop';
export type PhotoWorkspaceApprovalPositionKind = 'primary' | 'variant';
export type PhotoWorkspaceAssetSource = 'order' | 'chat' | 'approval' | 'workspace';

export interface PhotoWorkspaceApiResponse<T> {
  success: boolean;
  data: T;
}

export interface PhotoWorkspaceCropPayloadDto {
  documentType: string;
  crownY: number;
  chinY: number;
  centerX: number;
  rotationDeg: number;
  imageNaturalWidth: number;
  imageNaturalHeight: number;
  updatedAt: string;
}

export interface PhotoWorkspaceItemDto {
  id: string;
  order_id: string;
  approval_session_id: string | null;
  source_asset_id: string | null;
  source_asset_url: string;
  source_asset_name: string;
  label: string;
  document_type: string;
  tariff_level: PhotoWorkspaceTariffLevel | string;
  variant_limit: number;
  crop_payload: PhotoWorkspaceCropPayloadDto | PhotoWorkspaceJsonObject;
  crop_job_id: string | null;
  crop_result_url: string | null;
  crop_result_thumbnail_url: string | null;
  status: string;
  active_section: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PhotoWorkspaceReferenceDto {
  id: string;
  item_id: string;
  asset_id: string | null;
  asset_url: string;
  asset_name: string;
  thumbnail_url: string | null;
  source: string;
  roles: PhotoWorkspaceReferenceRoleSlug[] | string[];
  use_in_ai: boolean;
  description: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PhotoWorkspaceWishDto {
  id: string;
  item_id: string;
  source_type: string;
  source_id: string | null;
  source_label: string | null;
  text: string;
  status: PhotoWorkspaceWishStatus | string;
  reject_reason: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PhotoWorkspaceVariantDto {
  id: string;
  item_id: string;
  slot_number: number;
  source_type: 'ai' | 'photoshop_only' | string;
  internal_name: string;
  preset_slug: string;
  preset_label: string;
  enabled: boolean;
  base_prompt: string;
  manual_prompt: string;
  final_prompt: string;
  prompt_ready: boolean;
  status: PhotoWorkspaceVariantStatus | string;
  ai_job_id: string | null;
  ai_original_url: string | null;
  ai_original_thumbnail_url: string | null;
  ai_original_expires_at: string | null;
  photoshop_url: string | null;
  photoshop_thumbnail_url: string | null;
  photoshop_uploaded_by: string | null;
  photoshop_uploaded_at: string | null;
  checked_by: string | null;
  checked_at: string | null;
  approval_photo_id: string | null;
  approval_variant_id: string | null;
  approval_position_kind: PhotoWorkspaceApprovalPositionKind | null;
  sent_at: string | null;
  downloaded_at: string | null;
  error_message: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PhotoWorkspaceJournalDto {
  id: string;
  order_id: string;
  item_id: string | null;
  variant_id: string | null;
  event_type: string;
  actor_id: string | null;
  payload: PhotoWorkspaceJsonObject;
  created_at: string;
  expires_at: string;
}

export interface PhotoWorkspaceEnvelopeDto {
  item: PhotoWorkspaceItemDto;
  references: PhotoWorkspaceReferenceDto[];
  wishes: PhotoWorkspaceWishDto[];
  variants: PhotoWorkspaceVariantDto[];
}

export type PhotoWorkspaceOrderDto = PhotoWorkspaceEnvelopeDto[];

export interface PhotoWorkspaceCounters {
  aiDone: number;
  aiTotal: number;
  aiErrors: number;
  photoshopWaiting: number;
  readyToSend: number;
}

export interface PhotoWorkspaceReadinessDto {
  promptReady: boolean;
  blockers: PhotoWorkspaceReadinessBlocker[];
}

export interface PhotoWorkspaceAssetView {
  id: string;
  url: string;
  name: string;
  source: PhotoWorkspaceAssetSource;
  thumbnailUrl: string | null;
}

export interface CreatePhotoWorkspaceItemBody {
  approvalSessionId?: string | null;
  sourceAssetId?: string | null;
  sourceAssetUrl: string;
  sourceAssetName: string;
  label?: string;
  tariffLevel: PhotoWorkspaceTariffLevel;
}

export interface UpdatePhotoWorkspaceItemBody {
  label?: string;
  tariffLevel?: PhotoWorkspaceTariffLevel;
  documentType?: string;
  activeSection?: string;
}

export interface SavePhotoWorkspaceCropBody {
  cropPayload: PhotoWorkspaceCropPayloadDto;
}

export interface AddPhotoWorkspaceReferenceBody {
  assetId?: string | null;
  assetUrl: string;
  assetName: string;
  thumbnailUrl?: string | null;
  source?: string;
  roles: readonly string[];
  useInAi: boolean;
  description?: string;
}

export interface UpdatePhotoWorkspaceReferenceBody {
  roles: readonly string[];
  useInAi: boolean;
  description?: string;
}

export interface AddPhotoWorkspaceWishBody {
  sourceType?: string;
  sourceId?: string | null;
  sourceLabel?: string | null;
  text: string;
}

export interface UpdatePhotoWorkspaceWishBody {
  text: string;
  status: PhotoWorkspaceWishStatus;
  rejectReason?: string | null;
}

export interface RebuildPhotoWorkspacePromptPlanBody {
  variantLimit: number;
  acceptedWishes: readonly string[];
  retouchOptions: readonly string[];
  documentLabel: string;
}

export interface UpdatePhotoWorkspaceVariantPromptBody {
  basePrompt: string;
  manualPrompt?: string;
  referencesSummary?: string;
}

export interface CompletePhotoWorkspacePhotoshopBody {
  s3Key: string;
}

export interface SetPhotoWorkspaceVariantCheckedBody {
  checked: boolean;
}
