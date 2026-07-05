import {
  PHOTO_WORKSPACE_VARIANT_LIMITS,
  type PhotoWorkspaceTariffLevel,
} from './photo-workspace.constants.js';
import { v4 as uuidv4 } from 'uuid';
import { assembleFinalPrompt, buildPhotoWorkspacePromptPlan } from './photo-workspace-prompt-planner.js';
import {
  PhotoWorkspaceRepository,
  type PhotoWorkspaceRepositoryContract,
  type AddReferenceRepositoryParams,
  type AddWishRepositoryParams,
  type PromptPlanRepositoryItem,
  type UpdateItemApprovalSessionParams,
  type UpdateItemTariffParams,
  type UpdateReferenceRepositoryParams,
  type UpdateVariantPromptRepositoryParams,
  type UpdateWishRepositoryParams,
} from './photo-workspace.repository.js';
import { executeCropDocument } from '../crop/crop-document.executor.js';
import { generateThumbnail } from '../approval-thumbnail.service.js';
import { storageService } from '../storage.service.js';
import type { PhotoWorkspaceCropPayloadJsonb } from '../../types/jsonb/photo-workspace-jsonb.js';
import type {
  PhotoWorkspaceEnvelope,
  PhotoWorkspaceApprovalFeedbackWishSourceRow,
  PhotoWorkspaceItemRow,
  PhotoWorkspaceJournalRow,
  PhotoWorkspaceOrderProcessingSourceRow,
  PhotoWorkspaceReferenceRow,
  PhotoWorkspaceVariantRow,
  PhotoWorkspaceWishRow,
} from '../../types/views/photo-workspace-views.js';

export type PhotoWorkspaceServiceRepository = Pick<PhotoWorkspaceRepositoryContract,
  'getOrderWorkspace' |
  'getItemEnvelope' |
  'getOrderWishSources' |
  'getOrderProcessingSource' |
  'getApprovalFeedbackWishSources' |
  'getLatestApprovalSessionIdForOrder' |
  'updateItemApprovalSession' |
  'updateItemTariff' |
  'createItem' |
  'updateItemCrop' |
  'updateItemCropResult' |
  'markVariantsStaleAfterRecrop' |
  'addReference' |
  'updateReference' |
  'deleteReference' |
  'findWishBySource' |
  'addWish' |
  'updateWish' |
  'replacePromptPlan' |
  'updateVariantPrompt' |
  'getJournal' |
  'addJournal'
>;

export interface CreatePhotoWorkspaceItemInput {
  orderId: string;
  approvalSessionId: string | null;
  sourceAssetId: string | null;
  sourceAssetUrl: string;
  sourceAssetName: string;
  label: string;
  tariffLevel: PhotoWorkspaceTariffLevel;
  actorUserId: string;
}

export interface SavePhotoWorkspaceCropInput {
  itemId: string;
  actorUserId: string;
  cropPayload: PhotoWorkspaceCropPayloadJsonb;
}

export interface RunPhotoWorkspaceCropInput {
  itemId: string;
  actorUserId: string;
}

export interface GetPhotoWorkspaceJournalInput {
  itemId: string;
}

export interface AddPhotoWorkspaceReferenceInput {
  itemId: string;
  assetId?: string | null;
  assetUrl: string;
  assetName: string;
  thumbnailUrl?: string | null;
  source?: string;
  roles: readonly string[];
  useInAi: boolean;
  description?: string;
  actorUserId: string;
}

export interface UpdatePhotoWorkspaceReferenceInput {
  referenceId: string;
  roles: readonly string[];
  useInAi: boolean;
  description?: string;
  actorUserId: string;
}

export interface AddPhotoWorkspaceWishInput {
  itemId: string;
  sourceType: string;
  sourceId?: string | null;
  sourceLabel?: string | null;
  text: string;
  actorUserId: string;
}

export interface UpdatePhotoWorkspaceWishInput {
  wishId: string;
  text: string;
  status: 'pending' | 'accepted' | 'rejected';
  rejectReason?: string | null;
  actorUserId: string;
}

export interface ImportPhotoWorkspaceApprovalFeedbackInput {
  itemId: string;
  actorUserId: string;
}

export interface RebuildPhotoWorkspacePromptPlanInput {
  itemId: string;
  actorUserId: string;
  variantLimit: number;
  acceptedWishes: readonly string[];
  retouchOptions: readonly string[];
  documentLabel: string;
}

export interface UpdatePhotoWorkspaceVariantPromptInput {
  variantId: string;
  actorUserId: string;
  basePrompt: string;
  manualPrompt?: string;
  referencesSummary?: string;
}

export class PhotoWorkspaceService {
  private readonly repository: PhotoWorkspaceServiceRepository;

  constructor(repository: PhotoWorkspaceServiceRepository = new PhotoWorkspaceRepository()) {
    this.repository = repository;
  }

  async getOrderWorkspace(orderId: string): Promise<PhotoWorkspaceEnvelope[]> {
    let envelopes = await this.repository.getOrderWorkspace(orderId);
    const normalizedCount = await this.normalizeExistingItemTariffs(orderId, envelopes);
    if (normalizedCount > 0) {
      envelopes = await this.repository.getOrderWorkspace(orderId);
    }
    const linkedCount = await this.linkLatestApprovalSessionForItems(orderId, envelopes);
    let importedCount = 0;
    for (const envelope of envelopes) {
      const actorUserId = envelope.item.updated_by ?? envelope.item.created_by;
      if (!actorUserId) continue;
      importedCount += await this.importOrderWishesForItem({
        orderId,
        itemId: envelope.item.id,
        actorUserId,
      });
    }
    return linkedCount > 0 || importedCount > 0 ? this.repository.getOrderWorkspace(orderId) : envelopes;
  }

  getItemEnvelope(itemId: string): Promise<PhotoWorkspaceEnvelope | null> {
    return this.repository.getItemEnvelope(itemId);
  }

  async createItem(input: CreatePhotoWorkspaceItemInput): Promise<PhotoWorkspaceItemRow> {
    const sourceAssetUrl = trimRequired(input.sourceAssetUrl, 'sourceAssetUrl');
    const sourceAssetName = trimRequired(input.sourceAssetName, 'sourceAssetName');
    const label = trimRequired(input.label, 'label');
    const tariffLevel = await this.resolveTariffLevel(input.orderId, input.tariffLevel);
    const variantLimit = PHOTO_WORKSPACE_VARIANT_LIMITS[tariffLevel];
    const approvalSessionId = trimNullable(input.approvalSessionId)
      ?? await this.repository.getLatestApprovalSessionIdForOrder(input.orderId);
    const existing = (await this.repository.getOrderWorkspace(input.orderId))
      .find(envelope => samePhotoWorkspaceAssetUrl(envelope.item.source_asset_url, sourceAssetUrl));
    if (existing) {
      const item = await this.ensureItemApprovalSession({
        item: existing.item,
        approvalSessionId,
        actorUserId: input.actorUserId,
      });
      await this.importOrderWishesForItem({
        orderId: input.orderId,
        itemId: item.id,
        actorUserId: input.actorUserId,
      });
      return item;
    }

    const item = await this.repository.createItem({
      orderId: input.orderId,
      approvalSessionId,
      sourceAssetId: trimNullable(input.sourceAssetId),
      sourceAssetUrl,
      sourceAssetName,
      label,
      tariffLevel,
      variantLimit,
      actorUserId: input.actorUserId,
    });

    await this.repository.addJournal({
      orderId: input.orderId,
      itemId: item.id,
      actorUserId: input.actorUserId,
      eventType: 'item_created',
      payload: {
        sourceAssetUrl,
        sourceAssetName,
        tariffLevel,
        variantLimit,
      },
    });

    await this.importOrderWishesForItem({
      orderId: input.orderId,
      itemId: item.id,
      actorUserId: input.actorUserId,
    });

    return item;
  }

  async saveCrop(input: SavePhotoWorkspaceCropInput): Promise<PhotoWorkspaceItemRow> {
    const item = await this.repository.updateItemCrop({
      itemId: input.itemId,
      actorUserId: input.actorUserId,
      cropPayload: input.cropPayload,
    });
    const staleVariantCount = await this.repository.markVariantsStaleAfterRecrop(input.itemId, input.actorUserId);

    await this.repository.addJournal({
      orderId: item.order_id,
      itemId: input.itemId,
      actorUserId: input.actorUserId,
      eventType: 'crop_saved',
      payload: {
        staleVariantCount,
      },
    });

    return item;
  }

  async runCrop(input: RunPhotoWorkspaceCropInput): Promise<PhotoWorkspaceItemRow> {
    const envelope = await this.requireItemEnvelope(input.itemId);
    const cropPayload = requireSavedCropPayload(envelope.item.crop_payload);
    const result = await executeCropDocument(envelope.item.source_asset_url, cropPayload);
    const upload = await storageService.upload(
      result.buffer,
      `photo-workspace/crops/${input.itemId}/${uuidv4()}.jpg`,
      'image/jpeg',
    );
    const thumbnail = await generateThumbnail(result.buffer);
    const item = await this.repository.updateItemCropResult({
      itemId: input.itemId,
      actorUserId: input.actorUserId,
      cropResultUrl: upload.url,
      cropResultThumbnailUrl: thumbnail.thumbnailUrl,
    });

    await this.repository.addJournal({
      orderId: envelope.item.order_id,
      itemId: input.itemId,
      actorUserId: input.actorUserId,
      eventType: 'crop_ran',
      payload: {
        status: item.status,
        cropResultUrl: upload.url,
        cropResultThumbnailUrl: thumbnail.thumbnailUrl,
        warnings: result.plan.warnings.map(warning => ({
          code: warning.code,
          valuePx: warning.valuePx,
          ...(warning.valueMm == null ? {} : { valueMm: warning.valueMm }),
        })),
      },
    });

    return item;
  }

  async addReference(input: AddPhotoWorkspaceReferenceInput): Promise<PhotoWorkspaceReferenceRow> {
    const envelope = await this.requireItemEnvelope(input.itemId);
    const assetUrl = trimRequired(input.assetUrl, 'assetUrl');
    if (assetUrl === envelope.item.source_asset_url) {
      throw new Error('Reference image cannot be the source photo');
    }

    const params: AddReferenceRepositoryParams = {
      itemId: input.itemId,
      assetId: trimNullable(input.assetId),
      assetUrl,
      assetName: trimRequired(input.assetName, 'assetName'),
      thumbnailUrl: trimNullable(input.thumbnailUrl),
      source: trimNullable(input.source) ?? 'order',
      roles: normalizeRoles(input.roles, input.useInAi),
      useInAi: input.useInAi,
      description: trimOptional(input.description),
      actorUserId: input.actorUserId,
    };
    const reference = await this.repository.addReference(params);

    await this.repository.addJournal({
      orderId: envelope.item.order_id,
      itemId: input.itemId,
      actorUserId: input.actorUserId,
      eventType: 'reference_added',
      payload: {
        referenceId: reference.id,
        sourceAssetUrl: assetUrl,
      },
    });

    return reference;
  }

  async updateReference(input: UpdatePhotoWorkspaceReferenceInput): Promise<PhotoWorkspaceReferenceRow> {
    const params: UpdateReferenceRepositoryParams = {
      referenceId: input.referenceId,
      roles: normalizeRoles(input.roles, input.useInAi),
      useInAi: input.useInAi,
      description: trimOptional(input.description),
    };
    const reference = await this.repository.updateReference(params);

    await this.repository.addJournal({
      itemId: reference.item_id,
      actorUserId: input.actorUserId,
      eventType: 'reference_updated',
      payload: {
        referenceId: reference.id,
      },
    });

    return reference;
  }

  deleteReference(referenceId: string): Promise<boolean> {
    return this.repository.deleteReference(referenceId);
  }

  async addWish(input: AddPhotoWorkspaceWishInput): Promise<PhotoWorkspaceWishRow> {
    const params: AddWishRepositoryParams = {
      itemId: input.itemId,
      sourceType: trimRequired(input.sourceType, 'sourceType'),
      sourceId: trimNullable(input.sourceId),
      sourceLabel: trimNullable(input.sourceLabel),
      text: trimRequired(input.text, 'text'),
      actorUserId: input.actorUserId,
    };
    const wish = await this.repository.addWish(params);

    await this.repository.addJournal({
      itemId: input.itemId,
      actorUserId: input.actorUserId,
      eventType: 'wish_added',
      payload: {
        wishId: wish.id,
        source: wish.source_type,
      },
    });

    return wish;
  }

  async updateWish(input: UpdatePhotoWorkspaceWishInput): Promise<PhotoWorkspaceWishRow> {
    const params: UpdateWishRepositoryParams = {
      wishId: input.wishId,
      text: trimRequired(input.text, 'text'),
      status: input.status,
      rejectReason: trimNullable(input.rejectReason),
      actorUserId: input.actorUserId,
    };
    const wish = await this.repository.updateWish(params);

    await this.repository.addJournal({
      itemId: wish.item_id,
      actorUserId: input.actorUserId,
      eventType: input.status === 'pending' ? 'wish_updated' : `wish_${input.status}`,
      payload: {
        wishId: wish.id,
        status: wish.status,
      },
    });

    await this.refreshPromptPlanAfterWishChange(wish.item_id, input.actorUserId);

    return wish;
  }

  async importApprovalFeedback(input: ImportPhotoWorkspaceApprovalFeedbackInput): Promise<PhotoWorkspaceWishRow[]> {
    const envelope = await this.requireItemEnvelope(input.itemId);
    if (!envelope.item.approval_session_id) return [];

    const sources = await this.repository.getApprovalFeedbackWishSources(input.itemId);
    const seenTexts = new Set<string>();
    const imported: PhotoWorkspaceWishRow[] = [];

    for (const source of sources) {
      const text = trimOptional(source.text);
      if (!text || seenTexts.has(text)) continue;
      seenTexts.add(text);

      const sourceId = trimRequired(source.source_id, 'sourceId');
      const existing = await this.repository.findWishBySource(input.itemId, 'approval_revision', sourceId);
      if (existing) continue;

      const wish = await this.repository.addWish({
        itemId: input.itemId,
        sourceType: 'approval_revision',
        sourceId,
        sourceLabel: approvalFeedbackSourceLabel(source),
        text,
        actorUserId: input.actorUserId,
      });
      await this.repository.addJournal({
        orderId: envelope.item.order_id,
        itemId: input.itemId,
        actorUserId: input.actorUserId,
        eventType: 'wish_imported',
        payload: {
          wishId: wish.id,
          source: wish.source_type,
          sourceId,
        },
      });
      imported.push(wish);
    }

    return imported;
  }

  async rebuildPromptPlan(input: RebuildPhotoWorkspacePromptPlanInput): Promise<PhotoWorkspaceVariantRow[]> {
    const plan = buildPhotoWorkspacePromptPlan({
      variantLimit: input.variantLimit,
      acceptedWishes: input.acceptedWishes.map(wish => wish.trim()).filter(Boolean),
      retouchOptions: input.retouchOptions.map(option => option.trim()).filter(Boolean),
      documentLabel: trimRequired(input.documentLabel, 'documentLabel'),
    });
    const repositoryPlan: PromptPlanRepositoryItem[] = plan.map(item => ({ ...item }));
    const variants = await this.repository.replacePromptPlan(input.itemId, input.actorUserId, repositoryPlan);

    await this.repository.addJournal({
      itemId: input.itemId,
      actorUserId: input.actorUserId,
      eventType: 'prompt_plan_rebuilt',
      payload: {
        variantLimit: input.variantLimit,
      },
    });

    return variants;
  }

  async updateVariantPrompt(input: UpdatePhotoWorkspaceVariantPromptInput): Promise<PhotoWorkspaceVariantRow> {
    const basePrompt = trimRequired(input.basePrompt, 'basePrompt');
    const manualPrompt = trimOptional(input.manualPrompt);
    const finalPrompt = assembleFinalPrompt({
      basePrompt,
      manualPrompt,
      referencesSummary: trimOptional(input.referencesSummary),
    });
    const params: UpdateVariantPromptRepositoryParams = {
      variantId: input.variantId,
      basePrompt,
      manualPrompt,
      finalPrompt,
      promptReady: finalPrompt.trim().length > 0,
      actorUserId: input.actorUserId,
    };
    const variant = await this.repository.updateVariantPrompt(params);

    await this.repository.addJournal({
      itemId: variant.item_id,
      variantId: variant.id,
      actorUserId: input.actorUserId,
      eventType: 'variant_prompt_updated',
      payload: {
        variantSlotNumber: variant.slot_number,
        presetSlug: variant.preset_slug,
        promptReady: variant.prompt_ready,
      },
    });

    return variant;
  }

  getJournal(input: GetPhotoWorkspaceJournalInput): Promise<PhotoWorkspaceJournalRow[]> {
    return this.repository.getJournal(input.itemId);
  }

  private async requireItemEnvelope(itemId: string): Promise<PhotoWorkspaceEnvelope> {
    const envelope = await this.repository.getItemEnvelope(itemId);
    if (!envelope) {
      throw new Error('Photo workspace item not found');
    }
    return envelope;
  }

  private async linkLatestApprovalSessionForItems(orderId: string, envelopes: readonly PhotoWorkspaceEnvelope[]): Promise<number> {
    if (!envelopes.some(envelope => !envelope.item.approval_session_id)) return 0;
    const approvalSessionId = await this.repository.getLatestApprovalSessionIdForOrder(orderId);
    if (!approvalSessionId) return 0;

    let linkedCount = 0;
    for (const envelope of envelopes) {
      const item = await this.ensureItemApprovalSession({
        item: envelope.item,
        approvalSessionId,
        actorUserId: envelope.item.updated_by ?? envelope.item.created_by,
      });
      if (item !== envelope.item) linkedCount += 1;
    }
    return linkedCount;
  }

  private async ensureItemApprovalSession(input: {
    item: PhotoWorkspaceItemRow;
    approvalSessionId: string | null;
    actorUserId: string | null;
  }): Promise<PhotoWorkspaceItemRow> {
    if (input.item.approval_session_id || !input.approvalSessionId) return input.item;
    const params: UpdateItemApprovalSessionParams = {
      itemId: input.item.id,
      approvalSessionId: input.approvalSessionId,
      actorUserId: input.actorUserId,
    };
    return this.repository.updateItemApprovalSession(params);
  }

  private async resolveTariffLevel(
    orderId: string,
    requestedTariffLevel: PhotoWorkspaceTariffLevel,
  ): Promise<PhotoWorkspaceTariffLevel> {
    const source = await this.repository.getOrderProcessingSource(orderId);
    return highestTariffLevel(requestedTariffLevel, inferTariffLevelFromOrderProcessingSource(source));
  }

  private async normalizeExistingItemTariffs(
    orderId: string,
    envelopes: readonly PhotoWorkspaceEnvelope[],
  ): Promise<number> {
    const source = await this.repository.getOrderProcessingSource(orderId);
    const inferredTariffLevel = inferTariffLevelFromOrderProcessingSource(source);
    if (!inferredTariffLevel) return 0;

    let normalizedCount = 0;
    for (const envelope of envelopes) {
      const currentTariffLevel = normalizeTariffLevel(envelope.item.tariff_level);
      const tariffLevel = highestTariffLevel(currentTariffLevel, inferredTariffLevel);
      const variantLimit = Math.max(envelope.item.variant_limit, PHOTO_WORKSPACE_VARIANT_LIMITS[tariffLevel]);
      if (tariffLevel === currentTariffLevel && variantLimit === envelope.item.variant_limit) continue;

      const actorUserId = envelope.item.updated_by ?? envelope.item.created_by;
      const params: UpdateItemTariffParams = {
        itemId: envelope.item.id,
        tariffLevel,
        variantLimit,
        actorUserId,
      };
      await this.repository.updateItemTariff(params);
      await this.repository.addJournal({
        orderId,
        itemId: envelope.item.id,
        actorUserId,
        eventType: 'item_tariff_resolved',
        payload: {
          tariffLevel,
          variantLimit,
        },
      });

      if (actorUserId && canAutoReplacePromptPlan(envelope.variants)) {
        const acceptedWishes = envelope.wishes
          .filter(wish => wish.status === 'accepted')
          .map(wish => wish.text.trim())
          .filter(Boolean);
        const plan = buildPhotoWorkspacePromptPlan({
          variantLimit,
          acceptedWishes,
          retouchOptions: [],
          documentLabel: envelope.item.document_type,
        });
        await this.repository.replacePromptPlan(envelope.item.id, actorUserId, plan.map(item => ({ ...item })));
        await this.repository.addJournal({
          orderId,
          itemId: envelope.item.id,
          actorUserId,
          eventType: 'prompt_plan_rebuilt',
          payload: {
            variantLimit,
            reason: 'tariff_resolved',
          },
        });
      }

      normalizedCount += 1;
    }
    return normalizedCount;
  }

  private async refreshPromptPlanAfterWishChange(itemId: string, actorUserId: string): Promise<void> {
    const envelope = await this.requireItemEnvelope(itemId);
    if (!canAutoReplacePromptPlan(envelope.variants)) return;

    const acceptedWishes = envelope.wishes
      .filter(wish => wish.status === 'accepted')
      .map(wish => wish.text.trim())
      .filter(Boolean);
    const plan = buildPhotoWorkspacePromptPlan({
      variantLimit: envelope.item.variant_limit,
      acceptedWishes,
      retouchOptions: [],
      documentLabel: envelope.item.document_type,
    });

    await this.repository.replacePromptPlan(itemId, actorUserId, plan.map(item => ({ ...item })));
    await this.repository.addJournal({
      orderId: envelope.item.order_id,
      itemId,
      actorUserId,
      eventType: 'prompt_plan_rebuilt',
      payload: {
        variantLimit: envelope.item.variant_limit,
        reason: 'wish_updated',
      },
    });
  }

  private async importOrderWishesForItem(input: {
    orderId: string;
    itemId: string;
    actorUserId: string | null;
  }): Promise<number> {
    const sources = await this.repository.getOrderWishSources(input.orderId);
    if (!sources) return 0;

    const seenTexts = new Set<string>();
    let importedCount = 0;
    for (const source of [
      {
        sourceType: 'order_comment',
        sourceId: input.orderId,
        sourceLabel: 'Комментарий клиента',
        text: trimOptional(sources.comments),
      },
      {
        sourceType: 'order_wishes',
        sourceId: input.orderId,
        sourceLabel: 'Пожелания заказа',
        text: trimOptional(sources.wishes),
      },
    ]) {
      if (!source.text || seenTexts.has(source.text)) continue;
      seenTexts.add(source.text);

      const existing = await this.repository.findWishBySource(input.itemId, source.sourceType, source.sourceId);
      if (existing) continue;

      const wish = await this.repository.addWish({
        itemId: input.itemId,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        sourceLabel: source.sourceLabel,
        text: source.text,
        actorUserId: input.actorUserId,
      });
      await this.repository.addJournal({
        orderId: input.orderId,
        itemId: input.itemId,
        actorUserId: input.actorUserId,
        eventType: 'wish_imported',
        payload: {
          wishId: wish.id,
          source: wish.source_type,
        },
      });
      importedCount += 1;
    }
    return importedCount;
  }
}

function trimRequired(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  return trimmed;
}

function trimOptional(value?: string | null): string {
  return value?.trim() ?? '';
}

function trimNullable(value?: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed || null;
}

function inferTariffLevelFromOrderProcessingSource(
  source: PhotoWorkspaceOrderProcessingSourceRow | null,
): PhotoWorkspaceTariffLevel | null {
  const tokens = extractOrderItemTextTokens(source?.items).map(token => token.toLocaleLowerCase('ru-RU'));
  if (tokens.some(token => token.includes('processing-super') || token.includes('супер'))) return 'super';
  if (tokens.some(token => token.includes('processing-max') || token.includes('максим'))) return 'maximum';
  if (tokens.some(token => token.includes('processing-extended') || token.includes('расшир'))) return 'extended';
  if (tokens.some(token => token.includes('processing-basic') || token.includes('базов'))) return 'basic';
  return null;
}

function normalizeTariffLevel(value: string): PhotoWorkspaceTariffLevel {
  switch (value) {
    case 'extended':
    case 'maximum':
    case 'super':
      return value;
    case 'basic':
    default:
      return 'basic';
  }
}

function extractOrderItemTextTokens(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap(item => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
    const slug = Reflect.get(item, 'slug');
    const name = Reflect.get(item, 'name');
    return [slug, name].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  });
}

function highestTariffLevel(
  left: PhotoWorkspaceTariffLevel,
  right: PhotoWorkspaceTariffLevel | null,
): PhotoWorkspaceTariffLevel {
  if (!right) return left;
  return tariffRank(right) > tariffRank(left) ? right : left;
}

function tariffRank(level: PhotoWorkspaceTariffLevel): number {
  switch (level) {
    case 'super':
      return 4;
    case 'maximum':
      return 3;
    case 'extended':
      return 2;
    case 'basic':
      return 1;
  }
}

function approvalFeedbackSourceLabel(source: PhotoWorkspaceApprovalFeedbackWishSourceRow): string {
  return trimNullable(source.source_label) ?? 'Согласование фото';
}

function requireSavedCropPayload(payload: PhotoWorkspaceItemRow['crop_payload']): PhotoWorkspaceCropPayloadJsonb {
  const documentType = stringField(payload, 'documentType');
  const crownY = numberField(payload, 'crownY');
  const chinY = numberField(payload, 'chinY');
  const centerX = numberField(payload, 'centerX');
  const rotationDeg = numberField(payload, 'rotationDeg');
  const imageNaturalWidth = numberField(payload, 'imageNaturalWidth');
  const imageNaturalHeight = numberField(payload, 'imageNaturalHeight');
  const updatedAt = stringField(payload, 'updatedAt');
  if (
    !documentType
    || crownY == null
    || chinY == null
    || centerX == null
    || rotationDeg == null
    || imageNaturalWidth == null
    || imageNaturalHeight == null
    || !updatedAt
  ) {
    throw new Error('Workspace crop payload is required before crop run');
  }
  return {
    documentType,
    crownY,
    chinY,
    centerX,
    rotationDeg,
    imageNaturalWidth,
    imageNaturalHeight,
    updatedAt,
  };
}

function numberField(source: unknown, key: string): number | null {
  const value: unknown = objectField(source, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringField(source: unknown, key: string): string | null {
  const value: unknown = objectField(source, key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function objectField(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return null;
  return Reflect.get(source, key);
}

function canAutoReplacePromptPlan(variants: readonly PhotoWorkspaceVariantRow[]): boolean {
  return variants.every(variant => !variant.ai_original_url && !variant.photoshop_url && !variant.sent_at);
}

function samePhotoWorkspaceAssetUrl(left: string, right: string): boolean {
  const leftKey = photoWorkspaceAssetKey(left);
  const rightKey = photoWorkspaceAssetKey(right);
  return leftKey.length > 0 && leftKey === rightKey;
}

function photoWorkspaceAssetKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed, 'https://svoefoto.ru');
    if (parsed.pathname.startsWith('/media/') || parsed.pathname.startsWith('/uploads/')) {
      return parsed.pathname;
    }
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return trimmed.split(/[?#]/)[0] ?? trimmed;
  }
}

function normalizeRoles(roles: readonly string[], useInAi: boolean): string[] {
  const normalized = roles.map(role => role.trim()).filter(Boolean);
  if (useInAi && normalized.length === 0) {
    throw new Error('Reference role is required when reference is enabled for AI');
  }
  return normalized;
}
