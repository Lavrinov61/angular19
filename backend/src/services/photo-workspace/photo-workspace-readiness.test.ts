import { describe, expect, it } from 'vitest';
import {
  PHOTO_WORKSPACE_AI_ORIGINAL_RETENTION_DAYS,
  PHOTO_WORKSPACE_CLIENT_UPDATE_TEXT,
  PHOTO_WORKSPACE_JOURNAL_RETENTION_DAYS,
  PHOTO_WORKSPACE_NOTIFICATION_DELAY_MS,
  PHOTO_WORKSPACE_PROMPT_PRESETS,
  PHOTO_WORKSPACE_VARIANT_LIMITS,
  PHOTO_WORKSPACE_REFERENCE_ROLES,
} from './photo-workspace.constants.js';
import {
  computePhotoWorkspaceReadiness,
  canPublishWorkspaceVariant,
} from './photo-workspace-readiness.js';

describe('photo workspace readiness', () => {
  it('maps tariff limits per photo', () => {
    expect(PHOTO_WORKSPACE_VARIANT_LIMITS).toEqual({
      basic: 2,
      extended: 3,
      maximum: 5,
      super: 10,
    });
  });

  it('keeps the agreed reference roles stable', () => {
    expect(PHOTO_WORKSPACE_REFERENCE_ROLES.map(role => role.slug)).toEqual([
      'glasses',
      'hair',
      'clothing',
      'background',
      'makeup',
      'pose',
      'style',
      'other',
    ]);
  });

  it('keeps client update, retention, notification, and prompt preset constants stable', () => {
    expect(PHOTO_WORKSPACE_CLIENT_UPDATE_TEXT).toBe(
      'Мы обновили варианты обработки, пожалуйста, посмотрите согласование ещё раз.',
    );
    expect(PHOTO_WORKSPACE_AI_ORIGINAL_RETENTION_DAYS).toBe(90);
    expect(PHOTO_WORKSPACE_JOURNAL_RETENTION_DAYS).toBe(90);
    expect(PHOTO_WORKSPACE_NOTIFICATION_DELAY_MS).toBe(5 * 60 * 1000);
    expect(PHOTO_WORKSPACE_PROMPT_PRESETS.map(preset => preset.slug)).toEqual([
      'skin_background_clean',
      'wrinkles_under_eyes',
      'face_hair_lips',
    ]);
    expect(PHOTO_WORKSPACE_PROMPT_PRESETS.map(preset => preset.basePrompt)).toEqual([
      'почистить кожу, почистить фон',
      'убрать морщины, убрать синяки под глазами',
      'убрать второй подбородок, поправить волосы и объём, поправить губы если это девушка',
    ]);
  });

  it('blocks AI when the crop result is missing', () => {
    const readiness = computePhotoWorkspaceReadiness({
      hasCropResult: false,
      wishes: [{ status: 'accepted' }],
      references: [{ useInAi: true, roles: ['hair'] }],
      enabledVariants: [{ promptReady: true }],
    });

    expect(readiness.promptReady).toBe(false);
    expect(readiness.blockers).toContain('crop_missing');
  });

  it('blocks AI when an enabled reference has no role', () => {
    const readiness = computePhotoWorkspaceReadiness({
      hasCropResult: true,
      wishes: [{ status: 'accepted' }],
      references: [{ useInAi: true, roles: [] }],
      enabledVariants: [{ promptReady: true }],
    });

    expect(readiness.promptReady).toBe(false);
    expect(readiness.blockers).toContain('reference_role_missing');
  });

  it('blocks AI while a wish is still pending', () => {
    const readiness = computePhotoWorkspaceReadiness({
      hasCropResult: true,
      wishes: [{ status: 'pending' }],
      references: [{ useInAi: true, roles: ['hair'] }],
      enabledVariants: [{ promptReady: true }],
    });

    expect(readiness.promptReady).toBe(false);
    expect(readiness.blockers).toContain('wish_pending');
  });

  it('blocks AI when no variants are enabled', () => {
    const readiness = computePhotoWorkspaceReadiness({
      hasCropResult: true,
      wishes: [{ status: 'accepted' }],
      references: [{ useInAi: true, roles: ['hair'] }],
      enabledVariants: [],
    });

    expect(readiness.promptReady).toBe(false);
    expect(readiness.blockers).toContain('variant_prompt_missing');
  });

  it('blocks AI when an enabled variant prompt is missing', () => {
    const readiness = computePhotoWorkspaceReadiness({
      hasCropResult: true,
      wishes: [{ status: 'accepted' }],
      references: [{ useInAi: true, roles: ['hair'] }],
      enabledVariants: [{ promptReady: true }, { promptReady: false }],
    });

    expect(readiness.promptReady).toBe(false);
    expect(readiness.blockers).toContain('variant_prompt_missing');
  });

  it('allows AI when crop, wishes, references, and prompts are ready', () => {
    const readiness = computePhotoWorkspaceReadiness({
      hasCropResult: true,
      wishes: [{ status: 'accepted' }, { status: 'rejected' }],
      references: [{ useInAi: true, roles: ['hair'] }, { useInAi: false, roles: [] }],
      enabledVariants: [{ promptReady: true }],
    });

    expect(readiness.promptReady).toBe(true);
    expect(readiness.blockers).toEqual([]);
  });

  it('publishes only checked Photoshop files', () => {
    expect(canPublishWorkspaceVariant({
      status: 'checked',
      photoshopUrl: '/media/approvals/final.jpg',
      checkedAt: '2026-06-22T10:00:00.000Z',
    })).toBe(true);

    expect(canPublishWorkspaceVariant({
      status: 'ai_generated',
      aiOriginalUrl: '/media/approvals/ai/raw.jpg',
      checkedAt: null,
    })).toBe(false);

    expect(canPublishWorkspaceVariant({
      status: 'checked',
      checkedAt: '2026-06-22T10:00:00.000Z',
    })).toBe(false);

    expect(canPublishWorkspaceVariant({
      status: 'checked',
      photoshopUrl: '/media/approvals/final.jpg',
      checkedAt: null,
    })).toBe(false);
  });
});
