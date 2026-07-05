import { v4 as uuidv4 } from 'uuid';
import {
  executePipeline,
  estimateCost,
  type PipelineContext,
  type PipelineExecutionResult,
  type RetouchOperation,
} from '../ai-retouch.service.js';
import {
  PHOTO_WORKSPACE_AI_ORIGINAL_RETENTION_DAYS,
} from './photo-workspace.constants.js';
import { PhotoWorkspaceRepository } from './photo-workspace.repository.js';
import type {
  PhotoWorkspaceEnvelope,
  PhotoWorkspaceVariantRow,
} from '../../types/views/photo-workspace-views.js';

export type ExecuteWorkspacePipeline = (ctx: PipelineContext) => Promise<PipelineExecutionResult | void>;

export interface RunWorkspaceAiGenerationInput {
  itemId: string;
  actorUserId: string;
  socketServer?: PipelineContext['socketServer'];
}

export interface RunWorkspaceAiGenerationResult {
  completed: number;
  failed: number;
}

export interface RetryWorkspaceAiVariantInput {
  variantId: string;
  actorUserId: string;
  socketServer?: PipelineContext['socketServer'];
}

const RETRYABLE_VARIANT_STATUSES = new Set(['planned', 'pending_generation', 'error', 'stale_after_recrop']);
const PHOTO_WORKSPACE_AI_GENERATION_CONCURRENCY = 2;

export class PhotoWorkspaceAiService {
  private readonly repository: PhotoWorkspaceRepository;
  private readonly execute: ExecuteWorkspacePipeline;

  constructor(
    repository = new PhotoWorkspaceRepository(),
    execute: ExecuteWorkspacePipeline = executePipeline,
  ) {
    this.repository = repository;
    this.execute = execute;
  }

  async runItemGeneration(input: RunWorkspaceAiGenerationInput): Promise<RunWorkspaceAiGenerationResult> {
    const envelope = await this.requireEnvelopeWithApprovalSession(input);
    const sourcePhotoUrl = requireString(envelope.item.crop_result_url, 'Workspace crop result is required before AI generation');
    const sessionId = requireString(envelope.item.approval_session_id, 'Workspace approval session is required before AI generation');
    const referenceUrls = collectAiReferenceUrls(envelope);
    const variants = await this.repository.claimItemVariantsForAiGeneration(envelope.item.id, input.actorUserId);

    const results = await runVariantGenerationPool(variants, PHOTO_WORKSPACE_AI_GENERATION_CONCURRENCY, variant =>
      this.startVariantGeneration({
        envelope,
        variant,
        sourcePhotoUrl,
        sessionId,
        actorUserId: input.actorUserId,
        referenceUrls,
        socketServer: input.socketServer,
      }),
    );
    const completed = results.filter(result => result.status === 'completed').length;
    const failed = results.length - completed;

    input.socketServer?.to('admin:visitor-chats').emit(failed > 0 ? 'photo-workspace:ai-partial' : 'photo-workspace:ai-complete', {
      orderId: envelope.item.order_id,
      itemId: envelope.item.id,
      completed,
      failed,
    });

    return { completed, failed };
  }

  async retryVariant(input: RetryWorkspaceAiVariantInput): Promise<PhotoWorkspaceVariantRow> {
    const existingVariant = await this.repository.getVariant(input.variantId);
    if (!existingVariant) {
      throw new Error('Photo workspace variant not found');
    }

    const envelope = await this.requireEnvelopeWithApprovalSession({
      itemId: existingVariant.item_id,
      actorUserId: input.actorUserId,
      socketServer: input.socketServer,
    });
    const variant = envelope.variants.find(candidate => candidate.id === input.variantId);
    if (!variant) {
      throw new Error('Photo workspace variant not found');
    }
    if (!isRetryableVariant(variant)) {
      throw new Error('Photo workspace variant is not ready for AI generation');
    }

    const sourcePhotoUrl = requireString(envelope.item.crop_result_url, 'Workspace crop result is required before AI generation');
    const sessionId = requireString(envelope.item.approval_session_id, 'Workspace approval session is required before AI generation');
    const referenceUrls = collectAiReferenceUrls(envelope);
    const result = await this.startVariantGeneration({
      envelope,
      variant,
      sourcePhotoUrl,
      sessionId,
      actorUserId: input.actorUserId,
      referenceUrls,
      socketServer: input.socketServer,
    });

    input.socketServer?.to('admin:visitor-chats').emit(result.status === 'completed' ? 'photo-workspace:ai-complete' : 'photo-workspace:ai-partial', {
      orderId: envelope.item.order_id,
      itemId: envelope.item.id,
      completed: result.status === 'completed' ? 1 : 0,
      failed: result.status === 'completed' ? 0 : 1,
    });

    const updatedVariant = await this.repository.getVariant(input.variantId);
    if (!updatedVariant) {
      throw new Error('Photo workspace variant not found after retry');
    }
    return updatedVariant;
  }

  private async startVariantGeneration(input: {
    envelope: PhotoWorkspaceEnvelope;
    variant: PhotoWorkspaceVariantRow;
    sourcePhotoUrl: string;
    sessionId: string;
    actorUserId: string;
    referenceUrls: readonly string[];
    socketServer?: PipelineContext['socketServer'];
  }): Promise<PipelineExecutionResult> {
    const jobId = uuidv4();
    const operations = buildVariantOperations(input.variant, input.referenceUrls);
    await this.repository.createAiRetouchJob({
      jobId,
      sessionId: input.sessionId,
      sourcePhotoUrl: input.sourcePhotoUrl,
      operations,
      createdBy: input.actorUserId,
      costEstimateUsd: estimateCost(operations),
    });
    await this.repository.markVariantGenerating(input.variant.id, input.actorUserId);
    await this.repository.addJournal({
      orderId: input.envelope.item.order_id,
      itemId: input.envelope.item.id,
      variantId: input.variant.id,
      actorUserId: input.actorUserId,
      eventType: 'ai_variant_started',
      payload: {
        variantSlotNumber: input.variant.slot_number,
        presetSlug: input.variant.preset_slug,
      },
    });

    return this.runVariant({
      ...input,
      jobId,
      operations,
    });
  }

  private async runVariant(input: {
    envelope: PhotoWorkspaceEnvelope;
    variant: PhotoWorkspaceVariantRow;
    jobId: string;
    operations: RetouchOperation[];
    sourcePhotoUrl: string;
    sessionId: string;
    actorUserId: string;
    referenceUrls: readonly string[];
    socketServer?: PipelineContext['socketServer'];
  }): Promise<PipelineExecutionResult> {
    try {
      const result = await this.execute({
        jobId: input.jobId,
        sessionId: input.sessionId,
        sourcePhotoUrl: input.sourcePhotoUrl,
        operations: input.operations,
        createdBy: input.actorUserId,
        resultMode: 'work_result',
        workspaceItemId: input.envelope.item.id,
        workspaceVariantId: input.variant.id,
        socketServer: input.socketServer,
      });

      if (result?.status === 'failed') {
        await this.markFailed(input, result.error);
        return result;
      }

      const completedResult = result?.status === 'completed'
        ? result
        : {
            status: 'completed' as const,
            jobId: input.jobId,
            resultUrl: input.sourcePhotoUrl,
            resultThumbnailUrl: null,
            resultPhotoId: null,
            actualCostUsd: 0,
          };

      await this.repository.markVariantAiCompleted({
        variantId: input.variant.id,
        actorUserId: input.actorUserId,
        aiJobId: completedResult.jobId,
        aiOriginalUrl: completedResult.resultUrl,
        aiOriginalThumbnailUrl: completedResult.resultThumbnailUrl,
        aiOriginalExpiresAt: aiOriginalExpiresAt(),
      });
      await this.repository.addJournal({
        orderId: input.envelope.item.order_id,
        itemId: input.envelope.item.id,
        variantId: input.variant.id,
        actorUserId: input.actorUserId,
        eventType: 'ai_variant_completed',
        payload: {
          aiJobId: completedResult.jobId,
          variantSlotNumber: input.variant.slot_number,
        },
      });

      return completedResult;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.markFailed(input, message);
      return {
        status: 'failed',
        jobId: input.jobId,
        error: message,
        failedOperation: 0,
      };
    }
  }

  private async markFailed(input: {
    envelope: PhotoWorkspaceEnvelope;
    variant: PhotoWorkspaceVariantRow;
    actorUserId: string;
  }, errorMessage: string): Promise<void> {
    const employeeMessage = toEmployeeFacingAiErrorMessage(errorMessage);
    await this.repository.markVariantAiFailed(input.variant.id, input.actorUserId, employeeMessage);
    await this.repository.addJournal({
      orderId: input.envelope.item.order_id,
      itemId: input.envelope.item.id,
      variantId: input.variant.id,
      actorUserId: input.actorUserId,
      eventType: 'ai_variant_failed',
      payload: {
        message: employeeMessage,
        variantSlotNumber: input.variant.slot_number,
      },
    });
  }

  private async requireEnvelope(itemId: string): Promise<PhotoWorkspaceEnvelope> {
    const envelope = await this.repository.getItemEnvelope(itemId);
    if (!envelope) {
      throw new Error('Photo workspace item not found');
    }
    return envelope;
  }

  private async requireEnvelopeWithApprovalSession(input: RunWorkspaceAiGenerationInput): Promise<PhotoWorkspaceEnvelope> {
    const envelope = await this.requireEnvelope(input.itemId);
    if (envelope.item.approval_session_id) return envelope;

    const approvalSessionId = await this.repository.getLatestApprovalSessionIdForOrder(envelope.item.order_id);
    const ensuredApprovalSessionId = approvalSessionId
      ?? await this.repository.ensureApprovalSessionForOrder({
        orderId: envelope.item.order_id,
        actorUserId: input.actorUserId,
      });
    if (!ensuredApprovalSessionId) return envelope;

    const item = await this.repository.updateItemApprovalSession({
      itemId: envelope.item.id,
      approvalSessionId: ensuredApprovalSessionId,
      actorUserId: input.actorUserId,
    });
    return { ...envelope, item };
  }
}

function isRetryableVariant(variant: PhotoWorkspaceVariantRow): boolean {
  return variant.enabled && variant.prompt_ready && RETRYABLE_VARIANT_STATUSES.has(variant.status) && variant.final_prompt.trim().length > 0;
}

function collectAiReferenceUrls(envelope: PhotoWorkspaceEnvelope): string[] {
  return envelope.references
    .filter(reference => reference.use_in_ai)
    .map(reference => reference.asset_url)
    .filter(url => url.trim().length > 0);
}

async function runVariantGenerationPool(
  variants: readonly PhotoWorkspaceVariantRow[],
  limit: number,
  worker: (variant: PhotoWorkspaceVariantRow) => Promise<PipelineExecutionResult>,
): Promise<PipelineExecutionResult[]> {
  if (variants.length === 0) return [];

  const concurrency = Math.max(1, Math.min(limit, variants.length));
  const results: PipelineExecutionResult[] = [];
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < variants.length) {
      const index = nextIndex;
      nextIndex += 1;
      const variant = variants[index];
      if (!variant) return;
      results[index] = await worker(variant);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runNext()));
  return results;
}

function buildVariantOperations(variant: PhotoWorkspaceVariantRow, referenceUrls: readonly string[]): RetouchOperation[] {
  return [{
    type: 'custom_edit',
    params: {
      prompt: variant.final_prompt.trim(),
      reference_urls: [...referenceUrls],
    },
  }];
}

function requireString(value: string | null, message: string): string {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function toEmployeeFacingAiErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return 'AI-вариант не сгенерирован из-за неизвестной ошибки. Сообщите администратору.';
  }

  const circuitBreakerLastError = /^Circuit breaker OPEN for fal-ai\b.*last:\s*(.+)$/iu.exec(trimmed)?.[1]?.trim();
  if (circuitBreakerLastError) {
    const lastMessage = toEmployeeFacingAiErrorMessage(circuitBreakerLastError);
    if (!lastMessage.includes('временно недоступен после нескольких ошибок')) {
      return lastMessage;
    }
  }

  if (/Exhausted balance|Top up your balance|User is locked|dashboard\/billing/iu.test(trimmed)) {
    return 'AI-сервис недоступен: закончился баланс fal.ai. Сообщите администратору, чтобы пополнить баланс.';
  }

  if (/fal\.ai is not configured|FAL_API_KEY missing/iu.test(trimmed)) {
    return 'AI-сервис не настроен: отсутствует ключ fal.ai. Сообщите администратору.';
  }

  if (/fal\.ai .*failed \(40[13]\)/iu.test(trimmed)) {
    return 'AI-сервис отклонил запрос: нет доступа к fal.ai. Сообщите администратору.';
  }

  if (/fal\.ai .*failed \(429\)|rate.?limit|too.?many/iu.test(trimmed)) {
    return 'AI-сервис временно ограничил запросы. Подождите минуту и повторите вариант.';
  }

  if (/timed out|timeout/iu.test(trimmed)) {
    return 'AI-сервис не ответил вовремя. Подождите минуту и повторите вариант.';
  }

  if (/No output image/iu.test(trimmed)) {
    return 'AI-сервис не вернул готовое изображение. Повторите вариант или передайте задачу ретушёру.';
  }

  if (/Download failed|image download/iu.test(trimmed)) {
    return 'Не удалось скачать результат из AI-сервиса. Повторите вариант позже.';
  }

  if (/Circuit breaker OPEN for fal-ai/iu.test(trimmed)) {
    return 'AI-сервис временно недоступен после нескольких ошибок. Подождите минуту и повторите вариант. Если не помогло, сообщите администратору.';
  }

  if (/fal\.ai/iu.test(trimmed)) {
    return 'AI-сервис fal.ai вернул ошибку. Повторите вариант позже или сообщите администратору.';
  }

  return trimmed;
}

function aiOriginalExpiresAt(): string {
  const expiresAt = new Date(Date.now() + PHOTO_WORKSPACE_AI_ORIGINAL_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return expiresAt.toISOString();
}
