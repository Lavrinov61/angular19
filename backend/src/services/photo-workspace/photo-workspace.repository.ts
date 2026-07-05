import type { PoolClient } from 'pg';
import crypto from 'crypto';
import db from '../../database/db.js';
import type { RetouchOperation } from '../ai-retouch.service.js';
import type { PhotoWorkspaceCropPayloadJsonb, PhotoWorkspaceJournalPayloadJsonb } from '../../types/jsonb/photo-workspace-jsonb.js';
import type { IdResult } from '../../types/views/common-views.js';
import type {
  PhotoWorkspaceApprovalSessionLinkRow,
  PhotoWorkspaceApprovalFeedbackWishSourceRow,
  PhotoWorkspaceEnvelope,
  PhotoWorkspaceItemRow,
  PhotoWorkspaceJournalRow,
  PhotoWorkspaceNotificationBatchRow,
  PhotoWorkspaceOrderProcessingSourceRow,
  PhotoWorkspaceOrderWishSourceRow,
  PhotoWorkspaceReferenceRow,
  PhotoWorkspaceVariantRow,
  PhotoWorkspaceWishRow,
} from '../../types/views/photo-workspace-views.js';

export interface CreateWorkspaceItemParams {
  orderId: string;
  approvalSessionId: string | null;
  sourceAssetId: string | null;
  sourceAssetUrl: string;
  sourceAssetName: string;
  label: string;
  tariffLevel: string;
  variantLimit: number;
  actorUserId: string;
}

export interface SaveCropRepositoryParams {
  itemId: string;
  actorUserId: string;
  cropPayload: PhotoWorkspaceCropPayloadJsonb;
}

export interface UpdateItemCropResultRepositoryParams {
  itemId: string;
  actorUserId: string;
  cropResultUrl: string;
  cropResultThumbnailUrl: string | null;
}

export interface AddReferenceRepositoryParams {
  itemId: string;
  assetId: string | null;
  assetUrl: string;
  assetName: string;
  thumbnailUrl: string | null;
  source: string;
  roles: readonly string[];
  useInAi: boolean;
  description: string;
  actorUserId: string;
}

export interface UpdateReferenceRepositoryParams {
  referenceId: string;
  roles: readonly string[];
  useInAi: boolean;
  description: string;
}

export interface AddWishRepositoryParams {
  itemId: string;
  sourceType: string;
  sourceId: string | null;
  sourceLabel: string | null;
  text: string;
  actorUserId: string | null;
}

export interface UpdateWishRepositoryParams {
  wishId: string;
  text: string;
  status: string;
  rejectReason: string | null;
  actorUserId: string;
}

export interface PromptPlanRepositoryItem {
  slotNumber: number;
  presetSlug: string;
  presetLabel: string;
  internalName: string;
  enabled: boolean;
  basePrompt: string;
  manualPrompt: string;
  finalPrompt: string;
  promptReady: boolean;
}

export interface UpdateVariantPromptRepositoryParams {
  variantId: string;
  basePrompt: string;
  manualPrompt: string;
  finalPrompt: string;
  promptReady: boolean;
  actorUserId: string;
}

export interface MarkVariantAiCompletedParams {
  variantId: string;
  actorUserId: string;
  aiJobId: string;
  aiOriginalUrl: string;
  aiOriginalThumbnailUrl: string | null;
  aiOriginalExpiresAt: string;
}

export interface CreateAiRetouchJobParams {
  jobId: string;
  sessionId: string;
  sourcePhotoUrl: string;
  operations: readonly RetouchOperation[];
  createdBy: string;
  costEstimateUsd: number;
}

export interface UpdateItemApprovalSessionParams {
  itemId: string;
  approvalSessionId: string;
  actorUserId: string | null;
}

export interface UpdateItemTariffParams {
  itemId: string;
  tariffLevel: string;
  variantLimit: number;
  actorUserId: string | null;
}

export interface EnsureApprovalSessionForOrderParams {
  orderId: string;
  actorUserId: string;
}

export interface CompletePhotoshopUploadParams {
  variantId: string;
  actorUserId: string;
  photoshopUrl: string;
  photoshopThumbnailUrl: string | null;
}

export interface SetVariantCheckedParams {
  variantId: string;
  checked: boolean;
  actorUserId: string;
}

export interface EnsureApprovalPrimaryPhotoParams {
  approvalPhotoId?: string | null;
  approvalSessionId: string;
  originalPhotoUrl: string;
  retouchedPhotoUrl: string;
  thumbnailUrl: string | null;
}

export interface AddApprovalVariantParams {
  approvalPhotoId: string;
  variantUrl: string;
  thumbnailUrl: string | null;
  label: string | null;
}

export interface UpdateApprovalPrimaryPhotoParams {
  approvalPhotoId: string;
  retouchedPhotoUrl: string;
  thumbnailUrl: string | null;
}

export interface UpdateApprovalVariantFileParams {
  approvalVariantId: string;
  variantUrl: string;
  thumbnailUrl: string | null;
}

export interface DeleteApprovalPrimaryPhotoParams {
  approvalPhotoId: string;
}

export interface DeleteApprovalVariantParams {
  approvalVariantId: string;
}

export interface ClearVariantApprovalLinkParams {
  variantId: string;
  actorUserId: string;
}

export interface MarkVariantSentParams {
  variantId: string;
  actorUserId: string;
  approvalPhotoId: string;
  approvalVariantId: string | null;
  approvalPositionKind: 'primary' | 'variant';
}

export interface UpsertScheduledNotificationParams {
  orderId: string;
  approvalSessionId: string;
  actorUserId: string;
  messageText: string;
  scheduledFor: string;
}

export interface EnsureApprovalPrimaryPhotoResult {
  approvalPhotoId: string;
  created: boolean;
  linkAlreadySent: boolean;
}

export interface AddJournalParams {
  orderId?: string;
  itemId: string | null;
  variantId?: string | null;
  actorUserId: string | null;
  eventType: string;
  payload?: PhotoWorkspaceJournalPayloadJsonb;
}

export interface PhotoWorkspaceRepositoryContract {
  getOrderWorkspace(orderId: string): Promise<PhotoWorkspaceEnvelope[]>;
  getItemEnvelope(itemId: string): Promise<PhotoWorkspaceEnvelope | null>;
  getOrderWishSources(orderId: string): Promise<PhotoWorkspaceOrderWishSourceRow | null>;
  getOrderProcessingSource(orderId: string): Promise<PhotoWorkspaceOrderProcessingSourceRow | null>;
  getApprovalFeedbackWishSources(itemId: string): Promise<PhotoWorkspaceApprovalFeedbackWishSourceRow[]>;
  getLatestApprovalSessionIdForOrder(orderId: string): Promise<string | null>;
  ensureApprovalSessionForOrder(params: EnsureApprovalSessionForOrderParams): Promise<string | null>;
  updateItemApprovalSession(params: UpdateItemApprovalSessionParams): Promise<PhotoWorkspaceItemRow>;
  updateItemTariff(params: UpdateItemTariffParams): Promise<PhotoWorkspaceItemRow>;
  createItem(params: CreateWorkspaceItemParams): Promise<PhotoWorkspaceItemRow>;
  updateItemCrop(params: SaveCropRepositoryParams): Promise<PhotoWorkspaceItemRow>;
  updateItemCropResult(params: UpdateItemCropResultRepositoryParams): Promise<PhotoWorkspaceItemRow>;
  markVariantsStaleAfterRecrop(itemId: string, actorUserId: string): Promise<number>;
  addReference(params: AddReferenceRepositoryParams): Promise<PhotoWorkspaceReferenceRow>;
  updateReference(params: UpdateReferenceRepositoryParams): Promise<PhotoWorkspaceReferenceRow>;
  deleteReference(referenceId: string): Promise<boolean>;
  findWishBySource(itemId: string, sourceType: string, sourceId: string | null): Promise<PhotoWorkspaceWishRow | null>;
  addWish(params: AddWishRepositoryParams): Promise<PhotoWorkspaceWishRow>;
  updateWish(params: UpdateWishRepositoryParams): Promise<PhotoWorkspaceWishRow>;
  replacePromptPlan(itemId: string, actorUserId: string, plan: readonly PromptPlanRepositoryItem[]): Promise<PhotoWorkspaceVariantRow[]>;
  updateVariantPrompt(params: UpdateVariantPromptRepositoryParams): Promise<PhotoWorkspaceVariantRow>;
  claimItemVariantsForAiGeneration(itemId: string, actorUserId: string): Promise<PhotoWorkspaceVariantRow[]>;
  createAiRetouchJob(params: CreateAiRetouchJobParams): Promise<void>;
  markVariantGenerating(variantId: string, actorUserId: string): Promise<void>;
  markVariantAiCompleted(params: MarkVariantAiCompletedParams): Promise<void>;
  markVariantAiFailed(variantId: string, actorUserId: string, errorMessage: string): Promise<void>;
  getVariant(variantId: string): Promise<PhotoWorkspaceVariantRow | null>;
  completePhotoshopUpload(params: CompletePhotoshopUploadParams): Promise<PhotoWorkspaceVariantRow>;
  setVariantChecked(params: SetVariantCheckedParams): Promise<PhotoWorkspaceVariantRow>;
  ensureApprovalPrimaryPhoto(params: EnsureApprovalPrimaryPhotoParams): Promise<EnsureApprovalPrimaryPhotoResult>;
  addApprovalVariant(params: AddApprovalVariantParams): Promise<{ approvalVariantId: string }>;
  updateApprovalPrimaryPhoto(params: UpdateApprovalPrimaryPhotoParams): Promise<void>;
  updateApprovalVariantFile(params: UpdateApprovalVariantFileParams): Promise<void>;
  deleteApprovalPrimaryPhoto(params: DeleteApprovalPrimaryPhotoParams): Promise<void>;
  deleteApprovalVariant(params: DeleteApprovalVariantParams): Promise<void>;
  clearVariantApprovalLink(params: ClearVariantApprovalLinkParams): Promise<void>;
  markVariantSent(params: MarkVariantSentParams): Promise<void>;
  upsertScheduledNotification(params: UpsertScheduledNotificationParams): Promise<void>;
  getDueNotifications(nowIso: string): Promise<PhotoWorkspaceNotificationBatchRow[]>;
  markNotificationSent(batchId: string): Promise<void>;
  purgeExpiredJournal(): Promise<number>;
  purgeExpiredAiOriginalLinks(): Promise<number>;
  getJournal(itemId: string): Promise<PhotoWorkspaceJournalRow[]>;
  addJournal(params: AddJournalParams): Promise<void>;
}

export class PhotoWorkspaceRepository implements PhotoWorkspaceRepositoryContract {
  async getOrderWorkspace(orderId: string): Promise<PhotoWorkspaceEnvelope[]> {
    const params: unknown[] = [orderId];
    const [items, references, wishes, variants] = await Promise.all([
      db.query<PhotoWorkspaceItemRow>(
        'SELECT * FROM photo_workspace_items WHERE order_id = $1 ORDER BY created_at ASC',
        params,
      ),
      db.query<PhotoWorkspaceReferenceRow>(
        `SELECT r.* FROM photo_workspace_references r
         JOIN photo_workspace_items i ON i.id = r.item_id
         WHERE i.order_id = $1 ORDER BY r.created_at ASC`,
        params,
      ),
      db.query<PhotoWorkspaceWishRow>(
        `SELECT w.* FROM photo_workspace_wishes w
         JOIN photo_workspace_items i ON i.id = w.item_id
         WHERE i.order_id = $1 ORDER BY w.created_at ASC`,
        params,
      ),
      db.query<PhotoWorkspaceVariantRow>(
        `SELECT v.* FROM photo_workspace_variants v
         JOIN photo_workspace_items i ON i.id = v.item_id
         WHERE i.order_id = $1 ORDER BY v.slot_number ASC`,
        params,
      ),
    ]);

    return items.map(item => ({
      item,
      references: filterByItemId(references, item.id),
      wishes: filterByItemId(wishes, item.id),
      variants: filterByItemId(variants, item.id),
    }));
  }

  async getItemEnvelope(itemId: string): Promise<PhotoWorkspaceEnvelope | null> {
    const itemParams: unknown[] = [itemId];
    const item = await db.queryOne<PhotoWorkspaceItemRow>(
      'SELECT * FROM photo_workspace_items WHERE id = $1',
      itemParams,
    );
    if (!item) return null;

    const params: unknown[] = [itemId];
    const [references, wishes, variants] = await Promise.all([
      db.query<PhotoWorkspaceReferenceRow>(
        'SELECT * FROM photo_workspace_references WHERE item_id = $1 ORDER BY created_at ASC',
        params,
      ),
      db.query<PhotoWorkspaceWishRow>(
        'SELECT * FROM photo_workspace_wishes WHERE item_id = $1 ORDER BY created_at ASC',
        params,
      ),
      db.query<PhotoWorkspaceVariantRow>(
        'SELECT * FROM photo_workspace_variants WHERE item_id = $1 ORDER BY slot_number ASC',
        params,
      ),
    ]);

    return { item, references, wishes, variants };
  }

  async getOrderWishSources(orderId: string): Promise<PhotoWorkspaceOrderWishSourceRow | null> {
    const params: unknown[] = [orderId];
    return db.queryOne<PhotoWorkspaceOrderWishSourceRow>(
      'SELECT comments, wishes FROM photo_print_orders WHERE id = $1',
      params,
    );
  }

  async getOrderProcessingSource(orderId: string): Promise<PhotoWorkspaceOrderProcessingSourceRow | null> {
    const params: unknown[] = [orderId];
    return db.queryOne<PhotoWorkspaceOrderProcessingSourceRow>(
      'SELECT items FROM photo_print_orders WHERE id = $1',
      params,
    );
  }

  async getApprovalFeedbackWishSources(itemId: string): Promise<PhotoWorkspaceApprovalFeedbackWishSourceRow[]> {
    const params: unknown[] = [itemId];
    return db.query<PhotoWorkspaceApprovalFeedbackWishSourceRow>(
      `WITH item_session AS (
         SELECT approval_session_id
         FROM photo_workspace_items
         WHERE id = $1
       ),
       session_approvals AS (
         SELECT pa.id, pa.comment, pa.updated_at
         FROM photo_approvals pa
         JOIN item_session i ON i.approval_session_id = pa.approval_session_id
         WHERE i.approval_session_id IS NOT NULL
       ),
       approval_comments AS (
         SELECT
           'approval:' || id::text || ':comment' AS source_id,
           'Комментарий согласования' AS source_label,
           comment AS text,
           updated_at AS created_at
         FROM session_approvals
       ),
       approval_annotations AS (
         SELECT
           'approval_annotation:' || paa.id::text AS source_id,
           'Аннотация согласования' AS source_label,
           paa.annotation ->> 'comment' AS text,
           paa.created_at
         FROM photo_approval_annotations paa
         JOIN session_approvals sa ON sa.id = paa.approval_id
       ),
       revision_comments AS (
         SELECT
           'approval_revision:' || r.id::text || ':comment' AS source_id,
           'Комментарий доработки #' || r.revision_number::text AS source_label,
           r.client_comment AS text,
           r.created_at
         FROM photo_approval_revisions r
         JOIN session_approvals sa ON sa.id = r.approval_id
       ),
       revision_annotations AS (
         SELECT
           'approval_revision:' || r.id::text || ':annotation:' || COALESCE(annotation_row.value ->> 'id', annotation_row.ordinality::text) AS source_id,
           'Аннотация доработки #' || r.revision_number::text AS source_label,
           annotation_row.value -> 'annotation' ->> 'comment' AS text,
           r.created_at
         FROM photo_approval_revisions r
         JOIN session_approvals sa ON sa.id = r.approval_id
         CROSS JOIN LATERAL jsonb_array_elements(
           CASE
             WHEN jsonb_typeof(r.annotations_snapshot) = 'array' THEN r.annotations_snapshot
             ELSE '[]'::jsonb
           END
         ) WITH ORDINALITY AS annotation_row(value, ordinality)
       )
       SELECT source_id, source_label, BTRIM(text) AS text, created_at
       FROM (
         SELECT * FROM approval_comments
         UNION ALL
         SELECT * FROM approval_annotations
         UNION ALL
         SELECT * FROM revision_comments
         UNION ALL
         SELECT * FROM revision_annotations
       ) sources
       WHERE NULLIF(BTRIM(text), '') IS NOT NULL
       ORDER BY created_at ASC NULLS LAST, source_id ASC`,
      params,
    );
  }

  async getLatestApprovalSessionIdForOrder(orderId: string): Promise<string | null> {
    const params: unknown[] = [orderId];
    const row = await db.queryOne<IdResult>(
      `SELECT id
       FROM photo_approval_sessions
       WHERE order_id = $1
         AND deleted_at IS NULL
       ORDER BY link_sent_at DESC NULLS LAST, created_at DESC NULLS LAST
       LIMIT 1`,
      params,
    );
    return row?.id ?? null;
  }

  async ensureApprovalSessionForOrder(params: EnsureApprovalSessionForOrderParams): Promise<string | null> {
    const publicToken = crypto.randomBytes(24).toString('hex');
    const orderParams: unknown[] = [params.orderId];
    const queryParams: unknown[] = [params.orderId, params.actorUserId, publicToken];

    return db.transaction(async (client: PoolClient) => {
      await client.query(
        'SELECT id FROM photo_print_orders WHERE id = $1 FOR UPDATE',
        orderParams,
      );

      const existing = await client.query<IdResult>(
        `SELECT id
         FROM photo_approval_sessions
         WHERE order_id = $1
           AND deleted_at IS NULL
         ORDER BY link_sent_at DESC NULLS LAST, created_at DESC NULLS LAST
         LIMIT 1`,
        orderParams,
      );
      if (existing.rows[0]?.id) return existing.rows[0].id;

      const inserted = await client.query<IdResult>(
        `INSERT INTO photo_approval_sessions (
           public_token, client_name, client_phone, client_id, contact_id, photographer_id,
           title, description, order_id, chat_session_id, sla_hours
         )
         SELECT
           $3,
           NULLIF(BTRIM(COALESCE(p.contact_name, '')), ''),
           NULLIF(BTRIM(COALESCE(p.contact_phone, '')), ''),
           c.user_id,
           c.contact_id,
           $2,
           CONCAT('Согласование фото ', COALESCE(p.order_id, p.id::text)),
           NULL,
           p.id,
           p.chat_session_id,
           48
         FROM photo_print_orders p
         LEFT JOIN conversations c ON c.id = p.chat_session_id
         WHERE p.id = $1
         RETURNING id`,
        queryParams,
      );
      return inserted.rows[0]?.id ?? null;
    });
  }

  async updateItemApprovalSession(params: UpdateItemApprovalSessionParams): Promise<PhotoWorkspaceItemRow> {
    const queryParams: unknown[] = [
      params.itemId,
      params.approvalSessionId,
      params.actorUserId,
    ];
    return requireRow(await db.queryOne<PhotoWorkspaceItemRow>(
      `UPDATE photo_workspace_items
       SET approval_session_id = $2,
           updated_by = COALESCE($3::uuid, updated_by),
           updated_at = NOW()
       WHERE id = $1
         AND (approval_session_id IS NULL OR approval_session_id = $2)
       RETURNING *`,
      queryParams,
    ), 'Photo workspace approval session link returned no row');
  }

  async updateItemTariff(params: UpdateItemTariffParams): Promise<PhotoWorkspaceItemRow> {
    const queryParams: unknown[] = [
      params.itemId,
      params.tariffLevel,
      params.variantLimit,
      params.actorUserId,
    ];
    return requireRow(await db.queryOne<PhotoWorkspaceItemRow>(
      `UPDATE photo_workspace_items
       SET tariff_level = $2,
           variant_limit = $3,
           updated_by = COALESCE($4::uuid, updated_by),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      queryParams,
    ), 'Photo workspace tariff update returned no row');
  }

  async createItem(params: CreateWorkspaceItemParams): Promise<PhotoWorkspaceItemRow> {
    const queryParams: unknown[] = [
      params.orderId,
      params.approvalSessionId,
      params.sourceAssetId,
      params.sourceAssetUrl,
      params.sourceAssetName,
      params.label,
      params.tariffLevel,
      params.variantLimit,
      params.actorUserId,
      params.actorUserId,
    ];

    return requireRow(await db.queryOne<PhotoWorkspaceItemRow>(
      `INSERT INTO photo_workspace_items (
         order_id, approval_session_id, source_asset_id, source_asset_url, source_asset_name,
         label, tariff_level, variant_limit, created_by, updated_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      queryParams,
    ), 'Photo workspace item insert returned no row');
  }

  async updateItemCrop(params: SaveCropRepositoryParams): Promise<PhotoWorkspaceItemRow> {
    const queryParams: unknown[] = [
      params.itemId,
      JSON.stringify(params.cropPayload),
      params.actorUserId,
    ];

    return requireRow(await db.queryOne<PhotoWorkspaceItemRow>(
      `UPDATE photo_workspace_items
       SET crop_payload = $2::jsonb,
           updated_by = $3,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      queryParams,
    ), 'Photo workspace crop update returned no row');
  }

  async updateItemCropResult(params: UpdateItemCropResultRepositoryParams): Promise<PhotoWorkspaceItemRow> {
    const queryParams: unknown[] = [
      params.itemId,
      params.cropResultUrl,
      params.cropResultThumbnailUrl,
      params.actorUserId,
    ];

    return requireRow(await db.queryOne<PhotoWorkspaceItemRow>(
      `UPDATE photo_workspace_items
       SET crop_result_url = $2,
           crop_result_thumbnail_url = $3,
           status = 'crop_ready',
           updated_by = $4,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      queryParams,
    ), 'Photo workspace crop result update returned no row');
  }

  async markVariantsStaleAfterRecrop(itemId: string, actorUserId: string): Promise<number> {
    const params: unknown[] = [itemId, actorUserId];
    const rows = await db.query<PhotoWorkspaceVariantRow>(
      `UPDATE photo_workspace_variants
       SET status = 'stale_after_recrop',
           updated_by = $2,
           updated_at = NOW()
       WHERE item_id = $1
         AND sent_at IS NULL
         AND status <> 'sent_to_client'
       RETURNING *`,
      params,
    );
    return rows.length;
  }

  async addReference(params: AddReferenceRepositoryParams): Promise<PhotoWorkspaceReferenceRow> {
    const queryParams: unknown[] = [
      params.itemId,
      params.assetId,
      params.assetUrl,
      params.assetName,
      params.thumbnailUrl,
      params.source,
      [...params.roles],
      params.useInAi,
      params.description,
      params.actorUserId,
    ];

    return requireRow(await db.queryOne<PhotoWorkspaceReferenceRow>(
      `INSERT INTO photo_workspace_references (
         item_id, asset_id, asset_url, asset_name, thumbnail_url,
         source, roles, use_in_ai, description, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      queryParams,
    ), 'Photo workspace reference insert returned no row');
  }

  async updateReference(params: UpdateReferenceRepositoryParams): Promise<PhotoWorkspaceReferenceRow> {
    const queryParams: unknown[] = [
      params.referenceId,
      [...params.roles],
      params.useInAi,
      params.description,
    ];

    return requireRow(await db.queryOne<PhotoWorkspaceReferenceRow>(
      `UPDATE photo_workspace_references
       SET roles = $2,
           use_in_ai = $3,
           description = $4,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      queryParams,
    ), 'Photo workspace reference update returned no row');
  }

  async deleteReference(referenceId: string): Promise<boolean> {
    const params: unknown[] = [referenceId];
    const rows = await db.query<PhotoWorkspaceReferenceRow>(
      'DELETE FROM photo_workspace_references WHERE id = $1 RETURNING *',
      params,
    );
    return rows.length > 0;
  }

  async findWishBySource(itemId: string, sourceType: string, sourceId: string | null): Promise<PhotoWorkspaceWishRow | null> {
    const params: unknown[] = [itemId, sourceType, sourceId];
    return db.queryOne<PhotoWorkspaceWishRow>(
      `SELECT * FROM photo_workspace_wishes
       WHERE item_id = $1
         AND source_type = $2
         AND source_id IS NOT DISTINCT FROM $3
       ORDER BY created_at ASC
       LIMIT 1`,
      params,
    );
  }

  async addWish(params: AddWishRepositoryParams): Promise<PhotoWorkspaceWishRow> {
    const queryParams: unknown[] = [
      params.itemId,
      params.sourceType,
      params.sourceId,
      params.sourceLabel,
      params.text,
      params.actorUserId,
      params.actorUserId,
    ];

    return requireRow(await db.queryOne<PhotoWorkspaceWishRow>(
      `INSERT INTO photo_workspace_wishes (
         item_id, source_type, source_id, source_label, text, created_by, updated_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      queryParams,
    ), 'Photo workspace wish insert returned no row');
  }

  async updateWish(params: UpdateWishRepositoryParams): Promise<PhotoWorkspaceWishRow> {
    const queryParams: unknown[] = [
      params.wishId,
      params.text,
      params.status,
      params.rejectReason,
      params.actorUserId,
    ];

    return requireRow(await db.queryOne<PhotoWorkspaceWishRow>(
      `UPDATE photo_workspace_wishes
       SET text = $2,
           status = $3,
           reject_reason = $4,
           updated_by = $5,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      queryParams,
    ), 'Photo workspace wish update returned no row');
  }

  async replacePromptPlan(itemId: string, actorUserId: string, plan: readonly PromptPlanRepositoryItem[]): Promise<PhotoWorkspaceVariantRow[]> {
    return db.transaction(async (client: PoolClient) => {
      const deleteParams: unknown[] = [itemId];
      await client.query(
        `DELETE FROM photo_workspace_variants
         WHERE item_id = $1
           AND sent_at IS NULL`,
        deleteParams,
      );

      const variants: PhotoWorkspaceVariantRow[] = [];
      for (const item of plan) {
        const insertParams: unknown[] = [
          itemId,
          item.slotNumber,
          item.internalName,
          item.presetSlug,
          item.presetLabel,
          item.enabled,
          item.basePrompt,
          item.manualPrompt,
          item.finalPrompt,
          item.promptReady,
          actorUserId,
          actorUserId,
        ];
        const result = await client.query<PhotoWorkspaceVariantRow>(
          `INSERT INTO photo_workspace_variants (
             item_id, slot_number, internal_name, preset_slug, preset_label,
             enabled, base_prompt, manual_prompt, final_prompt, prompt_ready,
             created_by, updated_by
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING *`,
          insertParams,
        );
        const row = result.rows[0];
        if (!row) {
          throw new Error('Photo workspace prompt variant insert returned no row');
        }
        variants.push(row);
      }
      return variants;
    });
  }

  async updateVariantPrompt(params: UpdateVariantPromptRepositoryParams): Promise<PhotoWorkspaceVariantRow> {
    const queryParams: unknown[] = [
      params.variantId,
      params.basePrompt,
      params.manualPrompt,
      params.finalPrompt,
      params.promptReady,
      params.actorUserId,
    ];

    return requireRow(await db.queryOne<PhotoWorkspaceVariantRow>(
      `UPDATE photo_workspace_variants
       SET base_prompt = $2,
           manual_prompt = $3,
           final_prompt = $4,
           prompt_ready = $5,
           updated_by = $6,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      queryParams,
    ), 'Photo workspace variant prompt update returned no row');
  }

  async claimItemVariantsForAiGeneration(itemId: string, actorUserId: string): Promise<PhotoWorkspaceVariantRow[]> {
    const params: unknown[] = [
      itemId,
      actorUserId,
      ['planned', 'pending_generation'],
    ];

    return db.query<PhotoWorkspaceVariantRow>(
      `WITH candidates AS (
         SELECT id
         FROM photo_workspace_variants
         WHERE item_id = $1
           AND enabled = true
           AND prompt_ready = true
           AND btrim(final_prompt) <> ''
           AND status = ANY($3::text[])
         ORDER BY slot_number ASC
         FOR UPDATE SKIP LOCKED
       ),
       updated AS (
         UPDATE photo_workspace_variants v
         SET status = 'generating',
             error_message = NULL,
             updated_by = $2,
             updated_at = NOW()
         FROM candidates c
         WHERE v.id = c.id
         RETURNING v.*
       )
       SELECT * FROM updated ORDER BY slot_number ASC`,
      params,
    );
  }

  async createAiRetouchJob(params: CreateAiRetouchJobParams): Promise<void> {
    const queryParams: unknown[] = [
      params.jobId,
      params.sessionId,
      params.sourcePhotoUrl,
      JSON.stringify(params.operations),
      params.operations.length,
      params.costEstimateUsd,
      params.createdBy,
    ];
    await db.query(
      `INSERT INTO ai_retouch_jobs (
         id, approval_session_id, source_photo_url, operations,
         status, total_operations, cost_estimate_usd, created_by
       )
       VALUES ($1, $2, $3, $4::jsonb, 'pending', $5, $6, $7)`,
      queryParams,
    );
  }

  async markVariantGenerating(variantId: string, actorUserId: string): Promise<void> {
    const params: unknown[] = [variantId, actorUserId];
    await db.query<PhotoWorkspaceVariantRow>(
      `UPDATE photo_workspace_variants
       SET status = 'generating',
           error_message = NULL,
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $1`,
      params,
    );
  }

  async markVariantAiCompleted(params: MarkVariantAiCompletedParams): Promise<void> {
    const queryParams: unknown[] = [
      params.variantId,
      params.actorUserId,
      params.aiJobId,
      params.aiOriginalUrl,
      params.aiOriginalThumbnailUrl,
      params.aiOriginalExpiresAt,
    ];
    await db.query<PhotoWorkspaceVariantRow>(
      `UPDATE photo_workspace_variants
       SET status = 'needs_photoshop_check',
           ai_job_id = $3,
           ai_original_url = $4,
           ai_original_thumbnail_url = $5,
           ai_original_expires_at = $6,
           error_message = NULL,
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $1`,
      queryParams,
    );
  }

  async markVariantAiFailed(variantId: string, actorUserId: string, errorMessage: string): Promise<void> {
    const params: unknown[] = [variantId, actorUserId, errorMessage];
    await db.query<PhotoWorkspaceVariantRow>(
      `UPDATE photo_workspace_variants
       SET status = 'error',
           error_message = $3,
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $1`,
      params,
    );
  }

  async getVariant(variantId: string): Promise<PhotoWorkspaceVariantRow | null> {
    const params: unknown[] = [variantId];
    return db.queryOne<PhotoWorkspaceVariantRow>(
      'SELECT * FROM photo_workspace_variants WHERE id = $1',
      params,
    );
  }

  async completePhotoshopUpload(params: CompletePhotoshopUploadParams): Promise<PhotoWorkspaceVariantRow> {
    const queryParams: unknown[] = [
      params.variantId,
      params.actorUserId,
      params.photoshopUrl,
      params.photoshopThumbnailUrl,
    ];
    return requireRow(await db.queryOne<PhotoWorkspaceVariantRow>(
      `UPDATE photo_workspace_variants
       SET photoshop_url = $3,
           photoshop_thumbnail_url = $4,
           photoshop_uploaded_by = $2,
           photoshop_uploaded_at = NOW(),
           checked_by = NULL,
           checked_at = NULL,
           status = 'photoshop_uploaded',
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      queryParams,
    ), 'Photo workspace Photoshop upload update returned no row');
  }

  async setVariantChecked(params: SetVariantCheckedParams): Promise<PhotoWorkspaceVariantRow> {
    const queryParams: unknown[] = [params.variantId, params.actorUserId, params.checked];
    return requireRow(await db.queryOne<PhotoWorkspaceVariantRow>(
      `UPDATE photo_workspace_variants
       SET checked_by = CASE WHEN $3 THEN $2 ELSE NULL END,
           checked_at = CASE WHEN $3 THEN NOW() ELSE NULL END,
           status = CASE WHEN $3 THEN 'checked' ELSE 'photoshop_uploaded' END,
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      queryParams,
    ), 'Photo workspace checked update returned no row');
  }

  async ensureApprovalPrimaryPhoto(params: EnsureApprovalPrimaryPhotoParams): Promise<EnsureApprovalPrimaryPhotoResult> {
    const sessionParams: unknown[] = [params.approvalSessionId];
    const sessionLink = requireRow(await db.queryOne<PhotoWorkspaceApprovalSessionLinkRow>(
      'SELECT link_sent_at FROM photo_approval_sessions WHERE id = $1',
      sessionParams,
    ), 'Photo approval session not found');
    const linkAlreadySent = sessionLink.link_sent_at !== null;

    if (params.approvalPhotoId) {
      await this.updateApprovalPrimaryPhoto({
        approvalPhotoId: params.approvalPhotoId,
        retouchedPhotoUrl: params.retouchedPhotoUrl,
        thumbnailUrl: params.thumbnailUrl,
      });
      return { approvalPhotoId: params.approvalPhotoId, created: false, linkAlreadySent };
    }

    const queryParams: unknown[] = [
      params.approvalSessionId,
      params.retouchedPhotoUrl,
      params.thumbnailUrl,
      params.originalPhotoUrl,
    ];
    const row = requireRow(await db.queryOne<IdResult>(
      `INSERT INTO photo_approvals (
         approval_session_id, retouched_photo_url, thumbnail_url, original_photo_url, status
       )
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id`,
      queryParams,
    ), 'Photo approval primary insert returned no row');
    await db.query(
      'UPDATE photo_approval_sessions SET total_photos = total_photos + 1, updated_at = NOW() WHERE id = $1',
      sessionParams,
    );
    return { approvalPhotoId: row.id, created: true, linkAlreadySent };
  }

  async addApprovalVariant(params: AddApprovalVariantParams): Promise<{ approvalVariantId: string }> {
    const queryParams: unknown[] = [
      params.approvalPhotoId,
      params.variantUrl,
      params.thumbnailUrl,
      params.label,
    ];
    const row = requireRow(await db.queryOne<IdResult>(
      `INSERT INTO photo_approval_variants (approval_id, variant_url, thumbnail_url, label, sort_order)
       VALUES (
         $1, $2, $3, $4,
         (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM photo_approval_variants WHERE approval_id = $1)
       )
       RETURNING id`,
      queryParams,
    ), 'Photo approval variant insert returned no row');
    return { approvalVariantId: row.id };
  }

  async updateApprovalPrimaryPhoto(params: UpdateApprovalPrimaryPhotoParams): Promise<void> {
    const queryParams: unknown[] = [params.approvalPhotoId, params.retouchedPhotoUrl, params.thumbnailUrl];
    await db.query(
      `UPDATE photo_approvals
       SET retouched_photo_url = $2,
           thumbnail_url = $3,
           selected_variant_id = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      queryParams,
    );
  }

  async updateApprovalVariantFile(params: UpdateApprovalVariantFileParams): Promise<void> {
    const queryParams: unknown[] = [params.approvalVariantId, params.variantUrl, params.thumbnailUrl];
    await db.query(
      `WITH updated AS (
         UPDATE photo_approval_variants
         SET variant_url = $2,
             thumbnail_url = $3,
             is_selected = FALSE,
             selected_at = NULL
         WHERE id = $1
         RETURNING approval_id, id
       )
       UPDATE photo_approvals
       SET selected_variant_id = NULL,
           updated_at = NOW()
       WHERE id = (SELECT approval_id FROM updated)
         AND selected_variant_id = (SELECT id FROM updated)`,
      queryParams,
    );
  }

  async deleteApprovalPrimaryPhoto(params: DeleteApprovalPrimaryPhotoParams): Promise<void> {
    const queryParams: unknown[] = [params.approvalPhotoId];
    await db.query(
      `WITH deleted AS (
         DELETE FROM photo_approvals WHERE id = $1 RETURNING approval_session_id
       )
       UPDATE photo_approval_sessions
       SET total_photos = GREATEST(total_photos - 1, 0),
           updated_at = NOW()
       WHERE id = (SELECT approval_session_id FROM deleted)`,
      queryParams,
    );
  }

  async deleteApprovalVariant(params: DeleteApprovalVariantParams): Promise<void> {
    const queryParams: unknown[] = [params.approvalVariantId];
    await db.query(
      `WITH deleted AS (
         DELETE FROM photo_approval_variants WHERE id = $1 RETURNING approval_id, id
       )
       UPDATE photo_approvals
       SET selected_variant_id = NULL,
           updated_at = NOW()
       WHERE id = (SELECT approval_id FROM deleted)
         AND selected_variant_id = (SELECT id FROM deleted)`,
      queryParams,
    );
  }

  async clearVariantApprovalLink(params: ClearVariantApprovalLinkParams): Promise<void> {
    const queryParams: unknown[] = [params.variantId, params.actorUserId];
    await db.query(
      `UPDATE photo_workspace_variants
       SET status = CASE WHEN checked_at IS NULL THEN 'photoshop_uploaded' ELSE 'checked' END,
           approval_photo_id = NULL,
           approval_variant_id = NULL,
           approval_position_kind = NULL,
           sent_at = NULL,
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $1`,
      queryParams,
    );
  }

  async markVariantSent(params: MarkVariantSentParams): Promise<void> {
    const queryParams: unknown[] = [
      params.variantId,
      params.actorUserId,
      params.approvalPhotoId,
      params.approvalVariantId,
      params.approvalPositionKind,
    ];
    await db.query(
      `UPDATE photo_workspace_variants
       SET status = 'sent_to_client',
           approval_photo_id = $3,
           approval_variant_id = $4,
           approval_position_kind = $5,
           sent_at = NOW(),
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $1`,
      queryParams,
    );
  }

  async upsertScheduledNotification(params: UpsertScheduledNotificationParams): Promise<void> {
    const queryParams: unknown[] = [
      params.orderId,
      params.approvalSessionId,
      params.actorUserId,
      params.messageText,
      params.scheduledFor,
    ];
    await db.query(
      `WITH updated AS (
         UPDATE photo_workspace_notification_batches
         SET pending_change_count = pending_change_count + 1,
             message_text = $4,
             scheduled_for = $5,
             last_change_at = NOW(),
             updated_at = NOW()
         WHERE approval_session_id = $2
           AND status = 'scheduled'
         RETURNING id
       )
       INSERT INTO photo_workspace_notification_batches (
         order_id, approval_session_id, created_by, message_text, scheduled_for
       )
       SELECT $1, $2, $3, $4, $5
       WHERE NOT EXISTS (SELECT 1 FROM updated)`,
      queryParams,
    );
  }

  async getDueNotifications(nowIso: string): Promise<PhotoWorkspaceNotificationBatchRow[]> {
    const params: unknown[] = [nowIso];
    return db.query<PhotoWorkspaceNotificationBatchRow>(
      `SELECT * FROM photo_workspace_notification_batches
       WHERE status = 'scheduled'
         AND scheduled_for <= $1
       ORDER BY scheduled_for ASC`,
      params,
    );
  }

  async markNotificationSent(batchId: string): Promise<void> {
    const params: unknown[] = [batchId];
    await db.query(
      `UPDATE photo_workspace_notification_batches
       SET status = 'sent',
           sent_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      params,
    );
  }

  async purgeExpiredJournal(): Promise<number> {
    const params: unknown[] = [];
    const rows = await db.query<IdResult>(
      `DELETE FROM photo_workspace_journal
       WHERE expires_at < NOW()
       RETURNING id`,
      params,
    );
    return rows.length;
  }

  async getJournal(itemId: string): Promise<PhotoWorkspaceJournalRow[]> {
    const params: unknown[] = [itemId];
    return db.query<PhotoWorkspaceJournalRow>(
      `SELECT * FROM photo_workspace_journal
       WHERE item_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      params,
    );
  }

  async purgeExpiredAiOriginalLinks(): Promise<number> {
    const params: unknown[] = [];
    const rows = await db.query<IdResult>(
      `UPDATE photo_workspace_variants
       SET ai_original_url = NULL,
           ai_original_thumbnail_url = NULL,
           ai_original_expires_at = NULL,
           updated_at = NOW()
       WHERE ai_original_expires_at IS NOT NULL
         AND ai_original_expires_at < NOW()
         AND status <> 'sent_to_client'
       RETURNING id`,
      params,
    );
    return rows.length;
  }

  async addJournal(params: AddJournalParams): Promise<void> {
    const queryParams: unknown[] = [
      params.orderId ?? null,
      params.itemId,
      params.variantId ?? null,
      params.actorUserId,
      params.eventType,
      JSON.stringify(params.payload ?? {}),
    ];

    await db.query<PhotoWorkspaceJournalRow>(
      `INSERT INTO photo_workspace_journal (
         order_id, item_id, variant_id, actor_id, event_type, payload
       )
       VALUES (
         COALESCE(
           $1::uuid,
           (SELECT order_id FROM photo_workspace_items WHERE id = $2::uuid),
           (SELECT i.order_id FROM photo_workspace_variants v JOIN photo_workspace_items i ON i.id = v.item_id WHERE v.id = $3::uuid)
         ),
         $2,
         $3,
         $4,
         $5,
         $6::jsonb
       )`,
      queryParams,
    );
  }
}

function filterByItemId<Row extends { item_id: string }>(rows: readonly Row[], itemId: string): Row[] {
  return rows.filter(row => row.item_id === itemId);
}

function requireRow<Row>(row: Row | null, message: string): Row {
  if (!row) {
    throw new Error(message);
  }
  return row;
}
