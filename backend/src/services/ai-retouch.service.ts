/**
 * ai-retouch.service.ts — High-level AI retouch pipeline executor.
 * Orchestrates fal.ai operations, uploads results to S3, creates approval variants.
 */

import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { falAIService, type FalResult, type FalStatusUpdate } from './fal-ai.service.js';
import { storageService } from './storage.service.js';
import { generateThumbnail } from './approval-thumbnail.service.js';
import { updateSessionCounters } from './approval-counters.service.js';
import { executeCropDocument } from './crop/crop-document.executor.js';

import { createLogger } from '../utils/logger.js';
import type AiRetouchJobs from '../types/generated/public/AiRetouchJobs.js';
import type PhotoApprovalSessions from '../types/generated/public/PhotoApprovalSessions.js';
export interface RetouchOperation {
  type: string;
  params?: RetouchOperationParams;
}

export type PipelineResultMode = 'approval_photo' | 'work_result';

export interface RetouchOperationParams {
  [key: string]: unknown;
}

interface FalInput {
  [key: string]: unknown;
}

const logger = createLogger('ai-retouch.service');
interface OperationDef {
  modelId?: string;
  cost: number;
  steps?: Array<{ modelId: string; purpose: string }>;
  requiresTemplate?: boolean;
  /** Локальная операция (Rust tool), НЕ fal.ai. Выполняется без FAL_API_KEY. */
  local?: boolean;
}

const OPERATIONS: { [type: string]: OperationDef } = {
  remove_background: { modelId: 'fal-ai/birefnet/v2', cost: 0.01 },
  replace_background: { modelId: 'fal-ai/bria/background/replace', cost: 0.02 },
  enhance_face: { modelId: 'fal-ai/codeformer', cost: 0.008 },
  upscale: { modelId: 'fal-ai/clarity-upscaler', cost: 0.12 },
  remove_beard: {
    steps: [
      { modelId: 'fal-ai/birefnet/v2', purpose: 'face_mask' },
      { modelId: 'fal-ai/flux-pro/v1/fill', purpose: 'inpaint' },
    ],
    cost: 0.14,
  },
  uniform_overlay: {
    modelId: 'fal-ai/flux-general/inpainting',
    cost: 0.12,
    requiresTemplate: true,
  },
  // Top-tier models
  custom_edit: { modelId: 'fal-ai/nano-banana-2/edit', cost: 0.05 },
  flux_fill: { modelId: 'fal-ai/flux-pro/v1.1', cost: 0.05 },
  // Локальная операция (Rust): детерминированное кадрирование под документ. Без fal.ai, cost 0.
  crop_document: { cost: 0, local: true },
};

export function getOperationsCatalog(): Array<{ type: string; label: string; cost: number; category: string }> {
  return [
    { type: 'remove_background', label: 'Удалить фон', cost: 0.01, category: 'background' },
    { type: 'replace_background', label: 'Заменить фон', cost: 0.02, category: 'background' },
    { type: 'enhance_face', label: 'Улучшить лицо', cost: 0.008, category: 'face' },
    { type: 'upscale', label: 'Апскейл', cost: 0.12, category: 'quality' },
    { type: 'remove_beard', label: 'Убрать бороду', cost: 0.14, category: 'military' },
    { type: 'uniform_overlay', label: 'Подставить форму', cost: 0.12, category: 'military' },
    { type: 'custom_edit', label: 'Свободное редактирование', cost: 0.05, category: 'advanced' },
    { type: 'flux_fill', label: 'Генерация (Flux Pro)', cost: 0.05, category: 'advanced' },
    { type: 'crop_document', label: 'Кадрировать под документ', cost: 0, category: 'document' },
  ];
}

/** Является ли операция локальной (Rust tool), а не fal.ai. Для гейта 503 в роуте (P1-2). */
export function isLocalOperation(type: string): boolean {
  return OPERATIONS[type]?.local === true;
}

export function estimateCost(operations: RetouchOperation[]): number {
  let total = 0;
  for (const op of operations) {
    const def = OPERATIONS[op.type];
    if (def) total += def.cost;
  }
  return total;
}

export interface PipelineContext {
  jobId: string;
  sessionId: string;
  sourcePhotoUrl: string;
  operations: RetouchOperation[];
  createdBy: string;
  resultMode?: PipelineResultMode;
  workspaceItemId?: string;
  workspaceVariantId?: string;
  socketServer?: { to: (room: string) => { emit: (event: string, data: unknown) => void } };
}

export interface PipelineCompletedResult {
  status: 'completed';
  jobId: string;
  resultUrl: string;
  resultThumbnailUrl: string | null;
  resultPhotoId: string | null;
  actualCostUsd: number;
}

export interface PipelineFailedResult {
  status: 'failed';
  jobId: string;
  error: string;
  failedOperation: number;
}

export type PipelineExecutionResult = PipelineCompletedResult | PipelineFailedResult;

export async function executePipeline(ctx: PipelineContext): Promise<PipelineExecutionResult> {
  const { jobId, sessionId, operations, createdBy, socketServer } = ctx;
  let currentImageUrl = ctx.sourcePhotoUrl;

  try {
    await db.query(
      `UPDATE ai_retouch_jobs SET status = 'processing', started_at = NOW() WHERE id = $1`,
      [jobId],
    );

    let actualCost = 0;
    const intermediateUrls: string[] = [];

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      const def = OPERATIONS[op.type];
      if (!def) throw new Error(`Unknown operation: ${op.type}`);

      // Emit progress
      emitWs(socketServer, sessionId, 'retouch:progress', {
        jobId, sessionId,
        currentOperation: i + 1,
        totalOperations: operations.length,
        operationType: op.type,
        ...workspaceEventFields(ctx),
      });

      await db.query(
        `UPDATE ai_retouch_jobs SET current_operation = $2 WHERE id = $1`,
        [jobId, i + 1],
      );

      // Локальная операция (Rust tool): кадрирование под документ. Без fal.ai, без скачивания с CDN.
      if (def.local) {
        const { buffer } = await executeCropDocument(currentImageUrl, op.params || {});
        const s3Key = `approvals/ai/${jobId}/step-${i + 1}.jpg`;
        const { url: s3Url } = await storageService.upload(buffer, s3Key, 'image/jpeg');
        intermediateUrls.push(s3Url);
        currentImageUrl = s3Url;
        actualCost += def.cost; // 0
        await db.query(
          `UPDATE ai_retouch_jobs SET intermediate_urls = $2::jsonb WHERE id = $1`,
          [jobId, JSON.stringify(intermediateUrls)],
        );
        continue; // финализация ниже переиспользуется как есть
      }

      let result: FalResult;

      if (def.steps) {
        // Multi-step operation (e.g., remove_beard)
        result = await executeMultiStep(def.steps, currentImageUrl, op.params || {});
      } else {
        const input = buildInput(op.type, currentImageUrl, op.params || {});
        result = await falAIService.run(def.modelId!, input, {
          onStatus: status => emitFalStatusProgress(ctx, i, op, status),
        });
      }

      // Extract output image URL
      const outputUrl = extractImageUrl(result);
      if (!outputUrl) throw new Error(`No output image from ${op.type}`);

      // Download from fal CDN and upload to our S3
      const imageBuffer = await falAIService.downloadImage(outputUrl);
      const s3Key = `approvals/ai/${jobId}/step-${i + 1}.jpg`;
      const { url: s3Url } = await storageService.upload(imageBuffer, s3Key, 'image/jpeg');

      intermediateUrls.push(s3Url);
      currentImageUrl = s3Url;
      actualCost += def.cost;

      await db.query(
        `UPDATE ai_retouch_jobs SET intermediate_urls = $2::jsonb WHERE id = $1`,
        [jobId, JSON.stringify(intermediateUrls)],
      );
    }

    // Final result: upload with standard approval key, generate thumbnail.
    // P2-2: если хоть один шаг уже залил результат в наш S3 (включая local-ветку), берём буфер оттуда —
    // никакого лишнего fetch через downloadImage. downloadImage зовём ТОЛЬКО когда шагов не было.
    let resultBuffer: Buffer;
    if (intermediateUrls.length > 0) {
      const currentKey = storageService.keyFromUrl(currentImageUrl);
      if (!currentKey) {
        throw new Error('Intermediate result must be from our storage');
      }
      resultBuffer = (await storageService.downloadToBuffer(currentKey)).buffer;
    } else {
      resultBuffer = await falAIService.downloadImage(currentImageUrl.startsWith('http') ? currentImageUrl : ctx.sourcePhotoUrl);
    }

    const resultKey = `approvals/${uuidv4()}.jpg`;
    const { url: resultUrl } = await storageService.upload(resultBuffer, resultKey, 'image/jpeg');
    const { thumbnailUrl: resultThumbUrl } = await generateThumbnail(resultBuffer);

    let photoId: string | null = null;
    if (ctx.resultMode !== 'work_result') {
      // Create photo_approvals record (new variant in session)
      const revRound = await db.queryOne<Pick<PhotoApprovalSessions, 'current_revision_round'>>(
        `SELECT current_revision_round FROM photo_approval_sessions WHERE id = $1`,
        [sessionId],
      );

      photoId = uuidv4();
      await db.query(
        `INSERT INTO photo_approvals (id, approval_session_id, retouched_photo_url, thumbnail_url, status, revision_round, created_at)
         VALUES ($1, $2, $3, $4, 'pending', $5, NOW())`,
        [photoId, sessionId, resultUrl, resultThumbUrl, revRound?.current_revision_round || 1],
      );

      // Update session counters
      await updateSessionCounters(sessionId);
    }

    // Update job as completed
    await db.query(
      `UPDATE ai_retouch_jobs SET
        status = 'completed', result_url = $2, result_thumbnail_url = $3,
        result_photo_id = $4, actual_cost_usd = $5, completed_at = NOW()
       WHERE id = $1`,
      [jobId, resultUrl, resultThumbUrl, photoId, actualCost],
    );

    // Emit completion
    emitWs(socketServer, sessionId, 'retouch:completed', {
      jobId, sessionId,
      resultUrl, resultPhotoId: photoId,
      actualCostUsd: actualCost,
      ...workspaceEventFields(ctx),
    });

    logger.info(`[AIRetouch] Job ${jobId} completed, cost=$${actualCost.toFixed(4)}`);
    return {
      status: 'completed',
      jobId,
      resultUrl,
      resultThumbnailUrl: resultThumbUrl,
      resultPhotoId: photoId,
      actualCostUsd: actualCost,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[AIRetouch] Job ${jobId} failed:`, { detail: errorMsg });

    const currentOp = await db.queryOne<Pick<AiRetouchJobs, 'current_operation'>>(
      `SELECT current_operation FROM ai_retouch_jobs WHERE id = $1`,
      [jobId],
    );

    await db.query(
      `UPDATE ai_retouch_jobs SET status = 'failed', error = $2, error_operation = $3, completed_at = NOW()
       WHERE id = $1`,
      [jobId, errorMsg, currentOp?.current_operation || 0],
    );

    emitWs(socketServer, sessionId, 'retouch:failed', {
      jobId, sessionId,
      error: errorMsg,
      failedOperation: currentOp?.current_operation || 0,
      ...workspaceEventFields(ctx),
    });

    return {
      status: 'failed',
      jobId,
      error: errorMsg,
      failedOperation: currentOp?.current_operation || 0,
    };
  }
}

async function executeMultiStep(
  steps: Array<{ modelId: string; purpose: string }>,
  imageUrl: string,
  params: RetouchOperationParams,
): Promise<FalResult> {
  let lastResult: FalResult = {};

  for (const step of steps) {
    if (step.purpose === 'face_mask') {
      // BiRefNet for face segmentation
      lastResult = await falAIService.run(step.modelId, { image_url: imageUrl });
    } else if (step.purpose === 'inpaint') {
      // FLUX Pro Fill inpainting using mask from previous step
      const maskUrl = extractImageUrl(lastResult);
      lastResult = await falAIService.run(step.modelId, {
        image_url: imageUrl,
        mask_url: maskUrl,
        prompt: stringParam(params, 'prompt', 'clean shaven face, smooth skin, natural complexion'),
        num_images: 1,
      });
    }
  }

  return lastResult;
}

function buildInput(opType: string, imageUrl: string, params: RetouchOperationParams): FalInput {
  switch (opType) {
    case 'remove_background':
      return { image_url: imageUrl };

    case 'replace_background':
      return {
        image_url: imageUrl,
        prompt: stringParam(params, 'prompt', 'plain white studio background, professional photography'),
      };

    case 'enhance_face':
      return {
        image: imageUrl,
        upscale: 1,
        codeformer_fidelity: numberParam(params, 'fidelity', 0.7),
      };

    case 'upscale':
      return {
        image_url: imageUrl,
        upscale_factor: numberParam(params, 'factor', 2),
        prompt: stringParam(params, 'prompt', 'high resolution professional portrait photograph'),
      };

    case 'uniform_overlay':
      return {
        image_url: imageUrl,
        mask_url: params['mask_url'],
        prompt: stringParam(params, 'prompt', 'military uniform, professional portrait'),
        ip_adapter_image_url: params['template_url'],
        num_images: 1,
      };

    case 'custom_edit':
      // Nano Banana 2 — multimodal image editing by prompt
      return buildCustomEditInput(imageUrl, params);

    case 'flux_fill':
      // Flux Pro v1.1 — high-quality generation/editing
      return {
        prompt: stringParam(params, 'prompt', 'professional portrait photograph, studio lighting'),
        image_url: imageUrl,
        num_images: 1,
      };

    default:
      return { image_url: imageUrl, ...params };
  }
}

function buildCustomEditInput(imageUrl: string, params: RetouchOperationParams): FalInput {
  const referenceUrls = Array.isArray(params['reference_urls'])
    ? params['reference_urls'].filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];

  return {
    prompt: stringParam(params, 'prompt', 'enhance this portrait photo'),
    image_urls: [imageUrl, ...referenceUrls],
    num_images: 1,
    output_format: 'png',
    resolution: '1K',
  };
}

export function buildCustomEditInputForTest(imageUrl: string, params: RetouchOperationParams): FalInput {
  return buildCustomEditInput(imageUrl, params);
}

function stringParam(params: RetouchOperationParams, key: string, fallback: string): string {
  const value = params[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function numberParam(params: RetouchOperationParams, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function extractImageUrl(result: FalResult): string | null {
  if (result.image?.url) return result.image.url;
  if (result.images?.[0]?.url) return result.images[0].url;
  const output = result['output'];
  if (typeof output === 'string') return output;
  if (Array.isArray(output) && typeof output[0] === 'string') return output[0];
  return null;
}

function workspaceEventFields(ctx: PipelineContext): { workspaceItemId?: string; workspaceVariantId?: string } {
  return {
    ...(ctx.workspaceItemId ? { workspaceItemId: ctx.workspaceItemId } : {}),
    ...(ctx.workspaceVariantId ? { workspaceVariantId: ctx.workspaceVariantId } : {}),
  };
}

function emitFalStatusProgress(
  ctx: PipelineContext,
  operationIndex: number,
  op: RetouchOperation,
  status: FalStatusUpdate,
): void {
  emitWs(ctx.socketServer, ctx.sessionId, 'retouch:progress', {
    jobId: ctx.jobId,
    sessionId: ctx.sessionId,
    currentOperation: operationIndex + 1,
    totalOperations: ctx.operations.length,
    operationType: op.type,
    provider: 'fal.ai',
    providerStatus: status.status,
    ...(status.requestId ? { providerRequestId: status.requestId } : {}),
    ...(typeof status.queuePosition === 'number' ? { providerQueuePosition: status.queuePosition } : {}),
    ...(status.error ? { providerError: status.error } : {}),
    ...(latestFalLogMessage(status) ? { providerLogMessage: latestFalLogMessage(status) } : {}),
    ...workspaceEventFields(ctx),
  });
}

function latestFalLogMessage(status: FalStatusUpdate): string | null {
  const last = status.logs?.at(-1)?.message?.trim();
  return last && last.length > 0 ? last : null;
}

function emitWs(
  socketServer: PipelineContext['socketServer'],
  sessionId: string,
  event: string,
  data: unknown,
): void {
  try {
    socketServer?.to('admin:visitor-chats').emit(event, data);
  } catch (err) {
    logger.error(`[AIRetouch] WS emit ${event} failed:`, { error: String(err) });
  }
}
