import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateThumbnail } from '../approval-thumbnail.service.js';
import { storageService } from '../storage.service.js';
import { PhotoWorkspaceApprovalService } from './photo-workspace-approval.service.js';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../database/db.js', () => ({
  default: dbMock,
  pool: { query: vi.fn() },
}));

vi.mock('../storage.service.js', () => ({
  storageService: {
    headObject: vi.fn(),
    getPublicUrl: vi.fn(),
    downloadToBuffer: vi.fn(),
  },
}));

vi.mock('../approval-thumbnail.service.js', () => ({
  generateThumbnail: vi.fn(),
}));

vi.mock('../photo-approval.service.js', () => ({
  sendGalleryToChat: vi.fn(),
}));

describe('PhotoWorkspaceApprovalService', () => {
  const repository = {
    getItemEnvelope: vi.fn(),
    getVariant: vi.fn(),
    completePhotoshopUpload: vi.fn(),
    setVariantChecked: vi.fn(),
    ensureApprovalPrimaryPhoto: vi.fn(),
    addApprovalVariant: vi.fn(),
    updateApprovalPrimaryPhoto: vi.fn(),
    updateApprovalVariantFile: vi.fn(),
    deleteApprovalPrimaryPhoto: vi.fn(),
    deleteApprovalVariant: vi.fn(),
    clearVariantApprovalLink: vi.fn(),
    markVariantSent: vi.fn(),
    addJournal: vi.fn(),
  };
  const notificationService = { scheduleApprovalUpdate: vi.fn() };

  beforeEach(() => vi.resetAllMocks());

  it('does not publish AI originals and only sends checked Photoshop files', async () => {
    repository.getItemEnvelope.mockResolvedValue({
      item: { id: 'item-1', order_id: 'order-1', approval_session_id: 'session-1', crop_result_url: '/media/crop.jpg' },
      references: [],
      wishes: [],
      variants: [
        { id: 'v1', status: 'checked', photoshop_url: '/media/ps-1.jpg', photoshop_thumbnail_url: '/media/ps-1-thumb.jpg', checked_at: '2026-06-22T10:00:00.000Z', sent_at: null },
        { id: 'v2', status: 'ai_generated', ai_original_url: '/media/ai-raw.jpg', photoshop_url: null, checked_at: null, sent_at: null },
      ],
    });
    repository.ensureApprovalPrimaryPhoto.mockResolvedValue({ approvalPhotoId: 'photo-1', created: true, linkAlreadySent: true });

    await new PhotoWorkspaceApprovalService(repository as never, notificationService as never).sendVerified({
      itemId: 'item-1',
      actorUserId: 'user-1',
    });

    expect(repository.ensureApprovalPrimaryPhoto).toHaveBeenCalledWith(expect.objectContaining({
      retouchedPhotoUrl: '/media/ps-1.jpg',
      originalPhotoUrl: '/media/crop.jpg',
    }));
    expect(repository.ensureApprovalPrimaryPhoto).not.toHaveBeenCalledWith(expect.objectContaining({
      retouchedPhotoUrl: '/media/ai-raw.jpg',
    }));
    expect(repository.markVariantSent).toHaveBeenCalledWith(expect.objectContaining({
      variantId: 'v1',
      approvalPhotoId: 'photo-1',
      approvalPositionKind: 'primary',
    }));
    expect(notificationService.scheduleApprovalUpdate).toHaveBeenCalledWith(expect.objectContaining({
      approvalSessionId: 'session-1',
      immediate: false,
    }));
  });

  it('sends the first approval link immediately when the session had no previous link', async () => {
    repository.getItemEnvelope.mockResolvedValue({
      item: { id: 'item-1', order_id: 'order-1', approval_session_id: 'session-1', crop_result_url: '/media/crop.jpg' },
      references: [],
      wishes: [],
      variants: [
        { id: 'v1', status: 'checked', photoshop_url: '/media/ps-1.jpg', photoshop_thumbnail_url: null, checked_at: '2026-06-22T10:00:00.000Z', sent_at: null },
      ],
    });
    repository.ensureApprovalPrimaryPhoto.mockResolvedValue({ approvalPhotoId: 'photo-1', created: true, linkAlreadySent: false });

    await new PhotoWorkspaceApprovalService(repository as never, notificationService as never).sendVerified({
      itemId: 'item-1',
      actorUserId: 'user-1',
    });

    expect(notificationService.scheduleApprovalUpdate).toHaveBeenCalledWith(expect.objectContaining({
      approvalSessionId: 'session-1',
      immediate: true,
    }));
  });

  it('adds later checked variants to the existing primary approval photo', async () => {
    repository.getItemEnvelope.mockResolvedValue({
      item: { id: 'item-1', order_id: 'order-1', approval_session_id: 'session-1', crop_result_url: '/media/crop.jpg' },
      references: [],
      wishes: [],
      variants: [
        {
          id: 'v1',
          status: 'sent_to_client',
          approval_photo_id: 'photo-1',
          approval_variant_id: null,
          approval_position_kind: 'primary',
          photoshop_url: '/media/ps-1.jpg',
          checked_at: '2026-06-22T10:00:00.000Z',
          sent_at: '2026-06-22T10:01:00.000Z',
        },
        {
          id: 'v2',
          status: 'checked',
          preset_label: 'Улыбка',
          photoshop_url: '/media/ps-2.jpg',
          photoshop_thumbnail_url: '/media/ps-2-thumb.jpg',
          checked_at: '2026-06-22T10:02:00.000Z',
          sent_at: null,
        },
      ],
    });
    repository.addApprovalVariant.mockResolvedValue({ approvalVariantId: 'approval-variant-1' });

    await new PhotoWorkspaceApprovalService(repository as never, notificationService as never).sendVerified({
      itemId: 'item-1',
      actorUserId: 'user-1',
    });

    expect(repository.ensureApprovalPrimaryPhoto).not.toHaveBeenCalled();
    expect(repository.addApprovalVariant).toHaveBeenCalledWith({
      approvalPhotoId: 'photo-1',
      variantUrl: '/media/ps-2.jpg',
      thumbnailUrl: '/media/ps-2-thumb.jpg',
      label: 'Улыбка',
    });
    expect(repository.markVariantSent).toHaveBeenCalledWith(expect.objectContaining({
      variantId: 'v2',
      approvalPhotoId: 'photo-1',
      approvalVariantId: 'approval-variant-1',
      approvalPositionKind: 'variant',
    }));
  });

  it('replaces an existing sent approval variant file and schedules a debounced update', async () => {
    vi.mocked(storageService.headObject).mockResolvedValue({ contentLength: 128, contentType: 'image/jpeg' });
    vi.mocked(storageService.getPublicUrl).mockReturnValue('/media/approvals/replaced.jpg');
    vi.mocked(storageService.downloadToBuffer).mockResolvedValue({ buffer: Buffer.from('image') } as never);
    vi.mocked(generateThumbnail).mockResolvedValue({ thumbnailUrl: '/media/approvals/replaced-thumb.jpg' } as never);
    repository.getVariant.mockResolvedValue({
      id: 'v2',
      item_id: 'item-1',
      approval_photo_id: 'photo-1',
      approval_variant_id: 'approval-variant-1',
      approval_position_kind: 'variant',
      sent_at: '2026-06-22T10:00:00.000Z',
    });
    repository.getItemEnvelope.mockResolvedValue({
      item: { id: 'item-1', order_id: 'order-1', approval_session_id: 'session-1' },
      references: [],
      wishes: [],
      variants: [],
    });

    await new PhotoWorkspaceApprovalService(repository as never, notificationService as never).replaceApprovalFile({
      variantId: 'v2',
      s3Key: 'approvals/replaced.jpg',
      actorUserId: 'user-1',
    });

    expect(repository.updateApprovalVariantFile).toHaveBeenCalledWith({
      approvalVariantId: 'approval-variant-1',
      variantUrl: '/media/approvals/replaced.jpg',
      thumbnailUrl: '/media/approvals/replaced-thumb.jpg',
    });
    expect(repository.markVariantSent).toHaveBeenCalledWith(expect.objectContaining({
      variantId: 'v2',
      approvalPhotoId: 'photo-1',
      approvalVariantId: 'approval-variant-1',
      approvalPositionKind: 'variant',
    }));
    expect(notificationService.scheduleApprovalUpdate).toHaveBeenCalledWith(expect.objectContaining({
      approvalSessionId: 'session-1',
      immediate: false,
    }));
  });

  it('deletes an existing sent approval variant file and clears the workspace approval link', async () => {
    repository.getVariant.mockResolvedValue({
      id: 'v2',
      item_id: 'item-1',
      approval_photo_id: 'photo-1',
      approval_variant_id: 'approval-variant-1',
      approval_position_kind: 'variant',
      sent_at: '2026-06-22T10:00:00.000Z',
    });
    repository.getItemEnvelope.mockResolvedValue({
      item: { id: 'item-1', order_id: 'order-1', approval_session_id: 'session-1' },
      references: [],
      wishes: [],
      variants: [],
    });

    await new PhotoWorkspaceApprovalService(repository as never, notificationService as never).deleteApprovalFile({
      variantId: 'v2',
      actorUserId: 'user-1',
    });

    expect(repository.deleteApprovalVariant).toHaveBeenCalledWith({ approvalVariantId: 'approval-variant-1' });
    expect(repository.clearVariantApprovalLink).toHaveBeenCalledWith({
      variantId: 'v2',
      actorUserId: 'user-1',
    });
    expect(notificationService.scheduleApprovalUpdate).toHaveBeenCalledWith(expect.objectContaining({
      approvalSessionId: 'session-1',
      immediate: false,
    }));
  });
});
