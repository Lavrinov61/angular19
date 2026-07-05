import type { PhotoWorkspaceReferenceRoleSlug } from '../../services/photo-workspace/photo-workspace.constants.js';

export type PhotoWorkspaceJsonPrimitive = string | number | boolean | null;
export type PhotoWorkspaceJsonValue = PhotoWorkspaceJsonPrimitive | PhotoWorkspaceJsonObject | PhotoWorkspaceJsonValue[];

export interface PhotoWorkspaceJsonObject {
  [key: string]: PhotoWorkspaceJsonValue | undefined;
}

export interface PhotoWorkspaceCropPayloadJsonb {
  documentType: string;
  crownY: number;
  chinY: number;
  centerX: number;
  rotationDeg: number;
  imageNaturalWidth: number;
  imageNaturalHeight: number;
  updatedAt: string;
}

export interface PhotoWorkspaceJournalStateSnapshotJsonb extends PhotoWorkspaceJsonObject {}

export interface PhotoWorkspaceJournalPayloadJsonb {
  before?: PhotoWorkspaceJournalStateSnapshotJsonb;
  after?: PhotoWorkspaceJournalStateSnapshotJsonb;
  reason?: string;
  message?: string;
  source?: string;
  sourceId?: string;
  sourceAssetUrl?: string;
  sourceAssetName?: string;
  referenceId?: string;
  wishId?: string;
  tariffLevel?: string;
  variantLimit?: number;
  staleVariantCount?: number;
  status?: string;
  variantSlotNumber?: number;
  aiJobId?: string;
  cropResultUrl?: string;
  cropResultThumbnailUrl?: string | null;
  warnings?: PhotoWorkspaceJsonValue[];
  approvalPhotoId?: string;
  approvalVariantId?: string | null;
  presetSlug?: string;
  promptReady?: boolean;
}

export interface PhotoWorkspaceReferenceSummaryJsonb {
  id: string;
  url: string;
  roles: PhotoWorkspaceReferenceRoleSlug[];
  description: string;
}

export interface PhotoWorkspacePromptAuditJsonb {
  itemId: string;
  variantId: string;
  presetSlug: string;
  basePrompt: string;
  manualPrompt: string;
  finalPrompt: string;
  changedBy: string;
  changedAt: string;
}
