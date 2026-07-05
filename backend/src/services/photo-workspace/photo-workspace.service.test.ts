import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoWorkspaceService } from './photo-workspace.service.js';
import type { PhotoWorkspaceServiceRepository } from './photo-workspace.service.js';
import type { UsersId } from '../../types/generated/public/Users.js';
import type { PhotoApprovalSessionsId } from '../../types/generated/public/PhotoApprovalSessions.js';
import type { PhotoPrintOrdersId } from '../../types/generated/public/PhotoPrintOrders.js';
import type {
  PhotoWorkspaceApprovalFeedbackWishSourceRow,
  PhotoWorkspaceItemRow,
  PhotoWorkspaceJournalRow,
  PhotoWorkspaceVariantRow,
  PhotoWorkspaceWishRow,
} from '../../types/views/photo-workspace-views.js';

const cropExecutorMock = vi.hoisted(() => ({
  executeCropDocument: vi.fn(),
}));
const storageMock = vi.hoisted(() => ({
  storageService: {
    upload: vi.fn(),
  },
}));
const thumbnailMock = vi.hoisted(() => ({
  generateThumbnail: vi.fn(),
}));

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../database/db.js', () => ({
  default: dbMock,
}));

vi.mock('../crop/crop-document.executor.js', () => ({
  executeCropDocument: cropExecutorMock.executeCropDocument,
}));

vi.mock('../storage.service.js', () => ({
  storageService: storageMock.storageService,
}));

vi.mock('../approval-thumbnail.service.js', () => ({
  generateThumbnail: thumbnailMock.generateThumbnail,
}));

const ORDER_ID = '11111111-1111-4111-8111-111111111111' as PhotoPrintOrdersId;
const APPROVAL_SESSION_ID = '22222222-2222-4222-8222-222222222222' as PhotoApprovalSessionsId;
const USER_ID = '33333333-3333-4333-8333-333333333333' as UsersId;

function makeRepository(): PhotoWorkspaceServiceRepository {
  return {
    getOrderWorkspace: vi.fn(),
    getItemEnvelope: vi.fn(),
    getOrderWishSources: vi.fn(),
    getOrderProcessingSource: vi.fn(),
    getApprovalFeedbackWishSources: vi.fn(),
    getLatestApprovalSessionIdForOrder: vi.fn(),
    updateItemApprovalSession: vi.fn(),
    updateItemTariff: vi.fn(),
    createItem: vi.fn(),
    updateItemCrop: vi.fn(),
    updateItemCropResult: vi.fn(),
    markVariantsStaleAfterRecrop: vi.fn(),
    addReference: vi.fn(),
    updateReference: vi.fn(),
    deleteReference: vi.fn(),
    findWishBySource: vi.fn(),
    addWish: vi.fn(),
    updateWish: vi.fn(),
    replacePromptPlan: vi.fn(),
    updateVariantPrompt: vi.fn(),
    getJournal: vi.fn(),
    addJournal: vi.fn(),
  } satisfies PhotoWorkspaceServiceRepository;
}

function makeItemRow(overrides: Partial<PhotoWorkspaceItemRow> = {}): PhotoWorkspaceItemRow {
  return {
    id: 'item-1',
    order_id: ORDER_ID,
    approval_session_id: APPROVAL_SESSION_ID,
    source_asset_id: 'asset-1',
    source_asset_url: '/media/source.jpg',
    source_asset_name: 'Основное фото 1',
    label: 'Фото 1',
    document_type: 'passport_rf',
    tariff_level: 'super',
    variant_limit: 10,
    crop_payload: {},
    crop_job_id: null,
    crop_result_url: null,
    crop_result_thumbnail_url: null,
    status: 'draft',
    active_section: 'crop',
    created_by: USER_ID,
    updated_by: USER_ID,
    created_at: '2026-06-22T10:00:00.000Z',
    updated_at: '2026-06-22T10:00:00.000Z',
    ...overrides,
  };
}

function makeWishRow(overrides: Partial<PhotoWorkspaceWishRow> = {}): PhotoWorkspaceWishRow {
  return {
    id: 'wish-1',
    item_id: 'item-1',
    source_type: 'order_comment',
    source_id: ORDER_ID,
    source_label: 'Комментарий клиента',
    text: 'Выровнять тон кожи',
    status: 'pending',
    reject_reason: null,
    created_by: USER_ID,
    updated_by: USER_ID,
    created_at: '2026-06-22T10:00:00.000Z',
    updated_at: '2026-06-22T10:00:00.000Z',
    ...overrides,
  };
}

function makeJournalRow(overrides: Partial<PhotoWorkspaceJournalRow> = {}): PhotoWorkspaceJournalRow {
  return {
    id: 'journal-1',
    order_id: ORDER_ID,
    item_id: 'item-1',
    variant_id: null,
    event_type: 'crop_saved',
    actor_id: USER_ID,
    payload: {},
    created_at: '2026-06-22T10:00:00.000Z',
    expires_at: '2026-09-20T10:00:00.000Z',
    ...overrides,
  };
}

function makeVariantRow(overrides: Partial<PhotoWorkspaceVariantRow> = {}): PhotoWorkspaceVariantRow {
  return {
    id: 'variant-1',
    item_id: 'item-1',
    slot_number: 1,
    source_type: 'ai',
    internal_name: 'Фото 1 - пожелания клиента',
    preset_slug: 'client_wishes',
    preset_label: 'Пожелания клиента',
    enabled: true,
    base_prompt: '',
    manual_prompt: '',
    final_prompt: '',
    prompt_ready: false,
    status: 'planned',
    ai_job_id: null,
    ai_original_url: null,
    ai_original_thumbnail_url: null,
    ai_original_expires_at: null,
    photoshop_url: null,
    photoshop_thumbnail_url: null,
    photoshop_uploaded_by: null,
    photoshop_uploaded_at: null,
    checked_by: null,
    checked_at: null,
    approval_photo_id: null,
    approval_variant_id: null,
    approval_position_kind: null,
    sent_at: null,
    downloaded_at: null,
    error_message: null,
    created_by: USER_ID,
    updated_by: USER_ID,
    created_at: '2026-06-22T10:00:00.000Z',
    updated_at: '2026-06-22T10:00:00.000Z',
    ...overrides,
  };
}

describe('PhotoWorkspaceService', () => {
  let repository: PhotoWorkspaceServiceRepository;
  let service: PhotoWorkspaceService;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = makeRepository();
    service = new PhotoWorkspaceService(repository);
  });

  it('creates a work item with tariff limit resolved per photo', async () => {
    vi.mocked(repository.getOrderWorkspace).mockResolvedValue([]);
    vi.mocked(repository.getOrderProcessingSource).mockResolvedValue(null);
    vi.mocked(repository.createItem).mockResolvedValue(makeItemRow());

    const item = await service.createItem({
      orderId: ORDER_ID,
      approvalSessionId: APPROVAL_SESSION_ID,
      sourceAssetId: 'asset-1',
      sourceAssetUrl: '/media/source.jpg',
      sourceAssetName: 'Основное фото 1',
      label: 'Фото 1',
      tariffLevel: 'super',
      actorUserId: USER_ID,
    });

    expect(repository.createItem).toHaveBeenCalledWith(expect.objectContaining({
      variantLimit: 10,
      tariffLevel: 'super',
    }));
    expect(repository.addJournal).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'item-1',
      actorUserId: USER_ID,
      eventType: 'item_created',
    }));
    expect(item.variant_limit).toBe(10);
  });

  it('raises item tariff from order processing option when request used default basic', async () => {
    vi.mocked(repository.getOrderWorkspace).mockResolvedValue([]);
    vi.mocked(repository.getOrderProcessingSource).mockResolvedValue({
      items: [
        { slug: 'passport-rf', name: 'Паспорт РФ 3,5×4,5' },
        { slug: 'processing-extended', name: 'Расширенная обработка' },
      ],
    });
    vi.mocked(repository.createItem).mockResolvedValue(makeItemRow({
      tariff_level: 'extended',
      variant_limit: 3,
    }));

    await service.createItem({
      orderId: ORDER_ID,
      approvalSessionId: APPROVAL_SESSION_ID,
      sourceAssetId: 'asset-1',
      sourceAssetUrl: '/media/source.jpg',
      sourceAssetName: 'Основное фото 1',
      label: 'Фото 1',
      tariffLevel: 'basic',
      actorUserId: USER_ID,
    });

    expect(repository.createItem).toHaveBeenCalledWith(expect.objectContaining({
      tariffLevel: 'extended',
      variantLimit: 3,
    }));
    expect(repository.addJournal).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        tariffLevel: 'extended',
        variantLimit: 3,
      }),
    }));
  });

  it('imports order comments for existing workspace items when loading order workspace', async () => {
    const envelope = {
      item: makeItemRow(),
      references: [],
      wishes: [],
      variants: [],
    };
    const importedWish = makeWishRow({
      text: 'Выровнять тон кожи',
    });
    vi.mocked(repository.getOrderWorkspace)
      .mockResolvedValueOnce([envelope])
      .mockResolvedValueOnce([{ ...envelope, wishes: [importedWish] }]);
    vi.mocked(repository.getOrderWishSources).mockResolvedValue({
      comments: 'Выровнять тон кожи',
      wishes: null,
    });
    vi.mocked(repository.findWishBySource).mockResolvedValue(null);
    vi.mocked(repository.addWish).mockResolvedValue(importedWish);

    const result = await service.getOrderWorkspace(ORDER_ID);

    expect(repository.addWish).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'item-1',
      sourceType: 'order_comment',
      sourceId: ORDER_ID,
      text: 'Выровнять тон кожи',
    }));
    expect(repository.getOrderWorkspace).toHaveBeenCalledTimes(2);
    expect(result[0]?.wishes).toEqual([importedWish]);
  });

  it('raises existing item tariff from order processing option when loading workspace', async () => {
    const initialEnvelope = {
      item: makeItemRow({
        tariff_level: 'basic',
        variant_limit: 2,
      }),
      references: [],
      wishes: [],
      variants: [makeVariantRow({ status: 'planned' }), makeVariantRow({ id: 'variant-2', slot_number: 2, status: 'planned' })],
    };
    const updatedEnvelope = {
      ...initialEnvelope,
      item: makeItemRow({
        tariff_level: 'extended',
        variant_limit: 3,
      }),
    };
    vi.mocked(repository.getOrderWorkspace)
      .mockResolvedValueOnce([initialEnvelope])
      .mockResolvedValueOnce([updatedEnvelope]);
    vi.mocked(repository.getOrderProcessingSource).mockResolvedValue({
      items: [{ slug: 'processing-extended', name: 'Расширенная обработка' }],
    });
    vi.mocked(repository.updateItemTariff).mockResolvedValue(updatedEnvelope.item);
    vi.mocked(repository.replacePromptPlan).mockResolvedValue([]);
    vi.mocked(repository.getOrderWishSources).mockResolvedValue({ comments: null, wishes: null });

    const result = await service.getOrderWorkspace(ORDER_ID);

    expect(repository.updateItemTariff).toHaveBeenCalledWith({
      itemId: 'item-1',
      tariffLevel: 'extended',
      variantLimit: 3,
      actorUserId: USER_ID,
    });
    expect(repository.replacePromptPlan).toHaveBeenCalledWith(
      'item-1',
      USER_ID,
      expect.arrayContaining([
        expect.objectContaining({ slotNumber: 3 }),
      ]),
    );
    expect(result[0]?.item.variant_limit).toBe(3);
  });

  it('links existing workspace items to the latest order approval session when loading workspace', async () => {
    const envelope = {
      item: makeItemRow({ approval_session_id: null }),
      references: [],
      wishes: [],
      variants: [],
    };
    const linkedEnvelope = {
      ...envelope,
      item: makeItemRow({ approval_session_id: APPROVAL_SESSION_ID }),
    };
    const getLatestApprovalSessionIdForOrder = vi.fn<() => Promise<string | null>>()
      .mockResolvedValue(APPROVAL_SESSION_ID);
    const updateItemApprovalSession = vi.fn<() => Promise<PhotoWorkspaceItemRow>>()
      .mockResolvedValue(linkedEnvelope.item);
    const repositoryWithApprovalSession = Object.assign(repository, {
      getLatestApprovalSessionIdForOrder,
      updateItemApprovalSession,
    });
    service = new PhotoWorkspaceService(repositoryWithApprovalSession as never);
    vi.mocked(repository.getOrderWorkspace)
      .mockResolvedValueOnce([envelope])
      .mockResolvedValueOnce([linkedEnvelope]);
    vi.mocked(repository.getOrderWishSources).mockResolvedValue({ comments: null, wishes: null });

    const result = await service.getOrderWorkspace(ORDER_ID);

    expect(getLatestApprovalSessionIdForOrder).toHaveBeenCalledWith(ORDER_ID);
    expect(updateItemApprovalSession).toHaveBeenCalledWith({
      itemId: 'item-1',
      approvalSessionId: APPROVAL_SESSION_ID,
      actorUserId: USER_ID,
    });
    expect(result[0]?.item.approval_session_id).toBe(APPROVAL_SESSION_ID);
  });

  it('imports order comment and order wishes when creating a work item', async () => {
    vi.mocked(repository.getOrderWorkspace).mockResolvedValue([]);
    vi.mocked(repository.createItem).mockResolvedValue(makeItemRow());
    vi.mocked(repository.getOrderWishSources).mockResolvedValue({
      comments: 'Выровнять тон кожи, сделать глаза и рот симметричнее',
      wishes: 'Убрать мелкие волоски с лица',
    });
    vi.mocked(repository.findWishBySource).mockResolvedValue(null);
    vi.mocked(repository.addWish)
      .mockResolvedValueOnce(makeWishRow({
        id: 'wish-comment',
        text: 'Выровнять тон кожи, сделать глаза и рот симметричнее',
      }))
      .mockResolvedValueOnce(makeWishRow({
        id: 'wish-wishes',
        source_type: 'order_wishes',
        source_label: 'Пожелания заказа',
        text: 'Убрать мелкие волоски с лица',
      }));

    await service.createItem({
      orderId: ORDER_ID,
      approvalSessionId: APPROVAL_SESSION_ID,
      sourceAssetId: 'asset-1',
      sourceAssetUrl: '/media/source.jpg',
      sourceAssetName: 'Основное фото 1',
      label: 'Фото 1',
      tariffLevel: 'super',
      actorUserId: USER_ID,
    });

    expect(repository.addWish).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'item-1',
      sourceType: 'order_comment',
      sourceId: ORDER_ID,
      sourceLabel: 'Комментарий клиента',
      text: 'Выровнять тон кожи, сделать глаза и рот симметричнее',
      actorUserId: USER_ID,
    }));
    expect(repository.addWish).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'item-1',
      sourceType: 'order_wishes',
      sourceId: ORDER_ID,
      sourceLabel: 'Пожелания заказа',
      text: 'Убрать мелкие волоски с лица',
      actorUserId: USER_ID,
    }));
  });

  it('refreshes prompt plan with accepted wishes after wish status changes', async () => {
    const acceptedWish = makeWishRow({
      text: 'нижнюю губу слева сделать такой же пухлой как и справа',
      status: 'accepted',
    });
    vi.mocked(repository.updateWish).mockResolvedValue(acceptedWish);
    vi.mocked(repository.getItemEnvelope).mockResolvedValue({
      item: makeItemRow({ variant_limit: 2, document_type: 'passport_rf' }),
      references: [],
      wishes: [acceptedWish],
      variants: [makeVariantRow({ status: 'error' })],
    });
    vi.mocked(repository.replacePromptPlan).mockResolvedValue([]);

    await service.updateWish({
      wishId: 'wish-1',
      text: acceptedWish.text,
      status: 'accepted',
      rejectReason: null,
      actorUserId: USER_ID,
    });

    expect(repository.replacePromptPlan).toHaveBeenCalledWith(
      'item-1',
      USER_ID,
      expect.arrayContaining([
        expect.objectContaining({
          presetSlug: 'client_wishes',
          finalPrompt: expect.stringContaining(acceptedWish.text),
        }),
      ]),
    );
  });

  it('does not replace prompt plan after wish changes when AI results already exist', async () => {
    const acceptedWish = makeWishRow({
      text: 'выровнять тон кожи',
      status: 'accepted',
    });
    vi.mocked(repository.updateWish).mockResolvedValue(acceptedWish);
    vi.mocked(repository.getItemEnvelope).mockResolvedValue({
      item: makeItemRow(),
      references: [],
      wishes: [acceptedWish],
      variants: [makeVariantRow({ ai_original_url: '/media/ai.jpg' })],
    });

    await service.updateWish({
      wishId: 'wish-1',
      text: acceptedWish.text,
      status: 'accepted',
      rejectReason: null,
      actorUserId: USER_ID,
    });

    expect(repository.replacePromptPlan).not.toHaveBeenCalled();
  });

  it('imports approval feedback wishes without duplicating existing sources', async () => {
    const feedbackSources: PhotoWorkspaceApprovalFeedbackWishSourceRow[] = [
      {
        source_id: 'approval:photo-1:comment',
        source_label: 'Комментарий согласования',
        text: 'Сделать губы симметричнее',
        created_at: '2026-06-22T11:00:00.000Z',
      },
      {
        source_id: 'approval_annotation:annotation-1',
        source_label: 'Аннотация согласования',
        text: 'Убрать волоски у лица',
        created_at: '2026-06-22T11:01:00.000Z',
      },
      {
        source_id: 'approval_revision:revision-1:comment',
        source_label: 'Комментарий доработки #1',
        text: 'Выровнять тон кожи',
        created_at: '2026-06-22T11:02:00.000Z',
      },
    ];
    vi.mocked(repository.getItemEnvelope).mockResolvedValue({
      item: makeItemRow(),
      references: [],
      wishes: [],
      variants: [],
    });
    vi.mocked(repository.getApprovalFeedbackWishSources).mockResolvedValue(feedbackSources);
    vi.mocked(repository.findWishBySource)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeWishRow({
        id: 'existing-wish',
        source_type: 'approval_revision',
        source_id: 'approval_annotation:annotation-1',
        source_label: 'Аннотация согласования',
        text: 'Убрать волоски у лица',
      }))
      .mockResolvedValueOnce(null);
    vi.mocked(repository.addWish)
      .mockResolvedValueOnce(makeWishRow({
        id: 'wish-comment',
        source_type: 'approval_revision',
        source_id: 'approval:photo-1:comment',
        source_label: 'Комментарий согласования',
        text: 'Сделать губы симметричнее',
      }))
      .mockResolvedValueOnce(makeWishRow({
        id: 'wish-revision',
        source_type: 'approval_revision',
        source_id: 'approval_revision:revision-1:comment',
        source_label: 'Комментарий доработки #1',
        text: 'Выровнять тон кожи',
      }));

    const result = await service.importApprovalFeedback({
      itemId: 'item-1',
      actorUserId: USER_ID,
    });

    expect(repository.getApprovalFeedbackWishSources).toHaveBeenCalledWith('item-1');
    expect(repository.addWish).toHaveBeenCalledTimes(2);
    expect(repository.addWish).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'item-1',
      sourceType: 'approval_revision',
      sourceId: 'approval:photo-1:comment',
      sourceLabel: 'Комментарий согласования',
      text: 'Сделать губы симметричнее',
    }));
    expect(repository.addJournal).toHaveBeenCalledWith(expect.objectContaining({
      orderId: ORDER_ID,
      itemId: 'item-1',
      actorUserId: USER_ID,
      eventType: 'wish_imported',
      payload: expect.objectContaining({
        source: 'approval_revision',
      }),
    }));
    expect(result.map(wish => wish.id)).toEqual(['wish-comment', 'wish-revision']);
  });

  it('reuses an existing order item when only the media signed URL query changed', async () => {
    const existing = makeItemRow({
      source_asset_url: 'https://svoefoto.ru/media/order-attachments/source.jpg?exp=1&sig=old',
    });
    vi.mocked(repository.getOrderWorkspace).mockResolvedValue([{
      item: existing,
      references: [],
      wishes: [],
      variants: [],
    }]);

    const item = await service.createItem({
      orderId: ORDER_ID,
      approvalSessionId: APPROVAL_SESSION_ID,
      sourceAssetId: 'asset-1',
      sourceAssetUrl: 'https://svoefoto.ru/media/order-attachments/source.jpg?exp=2&sig=new',
      sourceAssetName: 'Основное фото 1',
      label: 'Фото 1',
      tariffLevel: 'super',
      actorUserId: USER_ID,
    });

    expect(item).toBe(existing);
    expect(repository.createItem).not.toHaveBeenCalled();
  });

  it('recrop saves crop payload, marks variants stale, and writes journal', async () => {
    vi.mocked(repository.updateItemCrop).mockResolvedValue(makeItemRow({
      crop_payload: {
        documentType: 'passport_rf',
        crownY: 100,
        chinY: 300,
        centerX: 250,
        rotationDeg: 0,
        imageNaturalWidth: 500,
        imageNaturalHeight: 700,
        updatedAt: '2026-06-22T10:00:00.000Z',
      },
    }));
    vi.mocked(repository.markVariantsStaleAfterRecrop).mockResolvedValue(2);

    await service.saveCrop({
      itemId: 'item-1',
      actorUserId: USER_ID,
      cropPayload: {
        documentType: 'passport_rf',
        crownY: 100,
        chinY: 300,
        centerX: 250,
        rotationDeg: 0,
        imageNaturalWidth: 500,
        imageNaturalHeight: 700,
        updatedAt: '2026-06-22T10:00:00.000Z',
      },
    });

    expect(repository.markVariantsStaleAfterRecrop).toHaveBeenCalledWith('item-1', USER_ID);
    expect(repository.addJournal).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'item-1',
      actorUserId: USER_ID,
      eventType: 'crop_saved',
      payload: expect.objectContaining({
        staleVariantCount: 2,
      }),
    }));
  });

  it('runs deterministic crop, stores result, and writes journal', async () => {
    const cropPayload = {
      documentType: 'passport_rf',
      crownY: 100,
      chinY: 300,
      centerX: 250,
      rotationDeg: 0,
      imageNaturalWidth: 500,
      imageNaturalHeight: 700,
      updatedAt: '2026-06-22T10:00:00.000Z',
    };
    vi.mocked(repository.getItemEnvelope).mockResolvedValue({
      item: makeItemRow({ crop_payload: cropPayload }),
      references: [],
      wishes: [],
      variants: [],
    });
    cropExecutorMock.executeCropDocument.mockResolvedValue({
      buffer: Buffer.from('crop'),
      plan: {
        extract: { left: 10, top: 20, width: 350, height: 450 },
        extend: { top: 0, bottom: 0, left: 0, right: 0 },
        target: { width: 1102, height: 1417 },
        density: 800,
        jpegQuality: 92,
        warnings: [],
      },
    });
    storageMock.storageService.upload.mockResolvedValue({
      url: '/media/photo-workspace/crops/item-1/result.jpg',
      key: 'photo-workspace/crops/item-1/result.jpg',
      storageType: 'local',
      size: 4,
    });
    thumbnailMock.generateThumbnail.mockResolvedValue({
      thumbnailBuffer: Buffer.from('thumb'),
      thumbnailUrl: '/media/photo-workspace/crops/item-1/thumb.jpg',
    });
    vi.mocked(repository.updateItemCropResult).mockResolvedValue(makeItemRow({
      crop_payload: cropPayload,
      crop_result_url: '/media/photo-workspace/crops/item-1/result.jpg',
      crop_result_thumbnail_url: '/media/photo-workspace/crops/item-1/thumb.jpg',
      status: 'crop_ready',
    }));

    const item = await service.runCrop({ itemId: 'item-1', actorUserId: USER_ID });

    expect(cropExecutorMock.executeCropDocument).toHaveBeenCalledWith('/media/source.jpg', cropPayload);
    expect(storageMock.storageService.upload).toHaveBeenCalledWith(
      Buffer.from('crop'),
      expect.stringMatching(/^photo-workspace\/crops\/item-1\/.+\.jpg$/),
      'image/jpeg',
    );
    expect(repository.updateItemCropResult).toHaveBeenCalledWith({
      itemId: 'item-1',
      actorUserId: USER_ID,
      cropResultUrl: '/media/photo-workspace/crops/item-1/result.jpg',
      cropResultThumbnailUrl: '/media/photo-workspace/crops/item-1/thumb.jpg',
    });
    expect(repository.addJournal).toHaveBeenCalledWith(expect.objectContaining({
      orderId: ORDER_ID,
      itemId: 'item-1',
      actorUserId: USER_ID,
      eventType: 'crop_ran',
    }));
    expect(item.status).toBe('crop_ready');
  });

  it('returns item journal entries', async () => {
    vi.mocked(repository.getJournal).mockResolvedValue([makeJournalRow()]);

    await expect(service.getJournal({ itemId: 'item-1' })).resolves.toEqual([makeJournalRow()]);

    expect(repository.getJournal).toHaveBeenCalledWith('item-1');
  });
});
