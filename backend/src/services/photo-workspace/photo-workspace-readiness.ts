import type { PhotoWorkspaceReferenceRoleSlug } from './photo-workspace.constants.js';

export type PhotoWorkspaceReadinessBlocker =
  | 'crop_missing'
  | 'wish_pending'
  | 'reference_role_missing'
  | 'variant_prompt_missing';

export interface PhotoWorkspaceReadinessInput {
  hasCropResult: boolean;
  wishes: readonly { status: 'pending' | 'accepted' | 'rejected' }[];
  references: readonly { useInAi: boolean; roles: readonly PhotoWorkspaceReferenceRoleSlug[] }[];
  enabledVariants: readonly { promptReady: boolean }[];
}

export interface PhotoWorkspaceReadiness {
  promptReady: boolean;
  blockers: PhotoWorkspaceReadinessBlocker[];
}

export interface PublishableWorkspaceVariantInput {
  status: string;
  photoshopUrl?: string | null;
  checkedAt?: string | null;
  aiOriginalUrl?: string | null;
}

export function computePhotoWorkspaceReadiness(input: PhotoWorkspaceReadinessInput): PhotoWorkspaceReadiness {
  const blockers: PhotoWorkspaceReadinessBlocker[] = [];

  if (!input.hasCropResult) blockers.push('crop_missing');
  if (input.wishes.some(wish => wish.status === 'pending')) blockers.push('wish_pending');
  if (input.references.some(ref => ref.useInAi && ref.roles.length === 0)) blockers.push('reference_role_missing');
  if (input.enabledVariants.length === 0 || input.enabledVariants.some(variant => !variant.promptReady)) {
    blockers.push('variant_prompt_missing');
  }

  return { promptReady: blockers.length === 0, blockers };
}

export function canPublishWorkspaceVariant(input: PublishableWorkspaceVariantInput): boolean {
  return input.status === 'checked' && Boolean(input.photoshopUrl) && Boolean(input.checkedAt);
}
