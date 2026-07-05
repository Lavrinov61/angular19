import express, { type NextFunction, type Request, type Response } from 'express';
import sharp from 'sharp';
import { z } from 'zod';
import db from '../database/db.js';
import { optionalAuth, type AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createUploadLimiter } from '../middleware/upload-limiter.js';
import { enqueueCrmEvent } from '../services/crm-event-queue.service.js';
import { getRestorationWorkload } from '../services/restoration-workload.service.js';
import { storageService } from '../services/storage.service.js';
import {
  analyzeRestorationImages,
  buildBudgetFallbackEstimate,
  getRestorationAnalysisBudgetMs,
  type RestorationAnalysisFile,
  type RestorationAnalysisResult,
} from '../services/restoration-image-analysis.service.js';
import { createLogger } from '../utils/logger.js';
import { generateOrderId } from '../utils/secure-random.js';
import { createPresignedUploadRoutes, type VerifiedFile } from './shared/presigned-upload.factory.js';

const log = createLogger('restoration-orders');
const router = express.Router();

const MAX_RESTORATION_FILES = 5;
const MAX_RESTORATION_FILE_SIZE = 50 * 1024 * 1024;
const RESTORATION_VISION_PREVIEW_MAX_EDGE = 1600;
const RESTORATION_VISION_PREVIEW_QUALITY = 82;
const RESTORATION_CONVERSATION_SOURCE = 'restoration_upload';
const RESTORATION_METADATA_SOURCE = 'restoration_quick_upload';
const RESTORATION_ORDER_MODE = 'custom';
const RESTORATION_SERVICE_TYPE = 'restoration';

const RESTORATION_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'image/x-tiff',
  'image/heic',
  'image/heif',
]);

const completeFileSchema = z.object({
  s3Key: z.string().min(1),
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  fileSize: z.coerce.number().positive(),
  width: z.coerce.number().int().positive().optional(),
  height: z.coerce.number().int().positive().optional(),
});

const completeBodySchema = z.object({
  files: z.array(completeFileSchema).min(1).max(MAX_RESTORATION_FILES),
  outputTarget: z.unknown().optional(),
  note: z.string().trim().max(1000).optional(),
  pageUrl: z.string().trim().url().max(1000).optional(),
});

interface ClientFileMetadata {
  readonly s3Key: string;
  readonly width?: number;
  readonly height?: number;
}

interface RestorationOrderItem {
  readonly name: string;
  readonly service: string;
  readonly tariff: string;
  readonly description: string;
  readonly price: number | null;
  readonly quantity: number;
  readonly analysis: RestorationAnalysisResult;
  readonly uploadedFiles: readonly {
    readonly url: string;
    readonly s3Key: string;
    readonly fileName: string;
    readonly contentType: string;
    readonly fileSize: number;
    readonly width?: number;
    readonly height?: number;
  }[];
}

interface CreatedOrderRow {
  readonly order_id: string;
}

interface CreatedConversationRow {
  readonly id: string;
}

type RestorationAnalysisLog = Pick<
  RestorationAnalysisResult,
  | 'tier'
  | 'title'
  | 'price'
  | 'priceLabel'
  | 'leadTime'
  | 'clientReason'
  | 'confidence'
  | 'humanReviewRequired'
  | 'automaticPaymentAllowed'
  | 'reviewReason'
  | 'model'
  | 'scores'
  | 'outputTarget'
  | 'sourceMetrics'
> & {
  readonly internalNotes?: string;
};

function createMetadataByKey(rawFiles: readonly z.infer<typeof completeFileSchema>[]): Map<string, ClientFileMetadata> {
  const map = new Map<string, ClientFileMetadata>();
  for (const file of rawFiles) {
    map.set(file.s3Key, {
      s3Key: file.s3Key,
      width: file.width,
      height: file.height,
    });
  }
  return map;
}

function buildOrderItem(
  files: readonly VerifiedFile[],
  metadataByKey: Map<string, ClientFileMetadata>,
  estimate: RestorationAnalysisResult,
): RestorationOrderItem {
  return {
    name: estimate.title,
    service: 'Реставрация фото',
    tariff: estimate.title,
    description: `${estimate.reason} ${estimate.humanReviewRequired ? 'Стоимость подтвердит ретушёр до начала работы.' : 'Итог проверит ретушёр до начала ручной работы.'}`,
    price: estimate.price,
    quantity: 1,
    analysis: estimate,
    uploadedFiles: files.map(file => {
      const meta = metadataByKey.get(file.s3Key);
      return {
        url: file.s3Url,
        s3Key: file.s3Key,
        fileName: file.fileName,
        contentType: file.contentType,
        fileSize: file.fileSize,
        ...(meta?.width ? { width: meta.width } : {}),
        ...(meta?.height ? { height: meta.height } : {}),
      };
    }),
  };
}

function buildRestorationAnalysisLog(
  estimate: RestorationAnalysisResult,
  includeInternalNotes: boolean,
): RestorationAnalysisLog {
  return {
    tier: estimate.tier,
    title: estimate.title,
    price: estimate.price,
    priceLabel: estimate.priceLabel,
    leadTime: estimate.leadTime,
    clientReason: estimate.clientReason,
    confidence: estimate.confidence,
    humanReviewRequired: estimate.humanReviewRequired,
    automaticPaymentAllowed: estimate.automaticPaymentAllowed,
    reviewReason: estimate.reviewReason,
    model: estimate.model,
    scores: estimate.scores,
    outputTarget: estimate.outputTarget,
    sourceMetrics: estimate.sourceMetrics,
    ...(includeInternalNotes ? { internalNotes: estimate.internalNotes } : {}),
  };
}

async function createPersonalCabinetConversation(input: {
  readonly userId?: string | null;
  readonly userName?: string | null;
  readonly userPhone?: string | null;
  readonly userEmail?: string | null;
  readonly pageUrl?: string | null;
  readonly estimate: RestorationAnalysisResult;
  readonly fileCount: number;
}): Promise<string | null> {
  if (!input.userId) {
    return null;
  }

  const analysisLog = buildRestorationAnalysisLog(input.estimate, false);

  const row = await db.queryOne<CreatedConversationRow>(
    `INSERT INTO conversations (
        channel, user_id, visitor_name, visitor_phone, visitor_email,
        status, source, page_url, selected_service, selected_price,
        entry_context, metadata, last_message_content, last_message_at,
        message_count, unread_count
      ) VALUES (
        'web', $1, $2, $3, $4,
        'open', '${RESTORATION_CONVERSATION_SOURCE}', $5, 'Реставрация фото', $6,
        $7, $8, $9, NOW(),
        0, 0
      ) RETURNING id`,
    [
      input.userId,
      input.userName || 'Клиент',
      input.userPhone || null,
      input.userEmail || null,
      input.pageUrl || null,
      input.estimate.price,
      JSON.stringify({
        source: RESTORATION_METADATA_SOURCE,
        fileCount: input.fileCount,
        estimateTier: input.estimate.tier,
        outputTarget: input.estimate.outputTarget,
        automaticPaymentAllowed: input.estimate.automaticPaymentAllowed,
        confidence: input.estimate.confidence,
        model: input.estimate.model,
        reviewReason: input.estimate.reviewReason,
        scores: input.estimate.scores,
        sourceMetrics: input.estimate.sourceMetrics,
        restorationAnalysis: analysisLog,
      }),
      JSON.stringify({
        source: RESTORATION_METADATA_SOURCE,
        paymentRequired: input.estimate.automaticPaymentAllowed,
        estimateTitle: input.estimate.title,
        humanReviewRequired: input.estimate.humanReviewRequired,
        confidence: input.estimate.confidence,
        model: input.estimate.model,
        reviewReason: input.estimate.reviewReason,
        restorationAnalysis: analysisLog,
      }),
      `Быстрая оценка реставрации: ${input.estimate.title}`,
    ],
  );

  return row?.id ?? null;
}

async function createRestorationOrder(input: {
  readonly files: readonly VerifiedFile[];
  readonly rawFiles: readonly z.infer<typeof completeFileSchema>[];
  readonly note?: string;
  readonly pageUrl?: string;
  readonly userId?: string | null;
  readonly userName?: string | null;
  readonly userPhone?: string | null;
  readonly userEmail?: string | null;
  readonly outputTarget?: unknown;
}): Promise<{ orderId: string; estimate: RestorationAnalysisResult; paymentUrl: string | null; items: readonly RestorationOrderItem[] }> {
  const metadataByKey = createMetadataByKey(input.rawFiles);
  const workload = await getRestorationWorkload();

  // Общий wall-clock барьер: скачивание+sharp (buildAnalysisFiles) и AI-анализ
  // ограничены единым бюджетом. Если не уложились — отдаём предвычисленную
  // ручную оценку по клиентским размерам, заказ создаётся без зависания.
  const budgetMs = getRestorationAnalysisBudgetMs();
  const fallbackEstimate = buildBudgetFallbackEstimate({
    files: buildClientAnalysisFiles(input.files, metadataByKey),
    outputTarget: input.outputTarget,
    workload,
  });

  let budgetTimer: NodeJS.Timeout | undefined;
  const enrichment = (async (): Promise<RestorationAnalysisResult> => {
    const analysisFiles = await buildAnalysisFiles(input.files, metadataByKey);
    return analyzeRestorationImages({
      files: analysisFiles,
      outputTarget: input.outputTarget,
      workload,
    });
  })();
  enrichment.catch(() => { /* проигравший в race промис не должен ронять процесс */ });

  let estimate: RestorationAnalysisResult;
  try {
    estimate = await Promise.race([
      enrichment,
      new Promise<RestorationAnalysisResult>(resolve => {
        budgetTimer = setTimeout(() => resolve(fallbackEstimate), budgetMs);
      }),
    ]);
  } catch (error) {
    log.warn('restoration analysis enrichment failed, using budget fallback', {
      fileCount: input.files.length,
      error: error instanceof Error ? error.message : String(error),
    });
    estimate = fallbackEstimate;
  } finally {
    if (budgetTimer) {
      clearTimeout(budgetTimer);
    }
  }

  const items = [buildOrderItem(input.files, metadataByKey, estimate)];
  const analysisLog = buildRestorationAnalysisLog(estimate, true);
  const orderId = generateOrderId();
  const orderStatus = estimate.automaticPaymentAllowed ? 'pending_payment' : 'new';
  const conversationId = await createPersonalCabinetConversation({
    userId: input.userId,
    userName: input.userName,
    userPhone: input.userPhone,
    userEmail: input.userEmail,
    pageUrl: input.pageUrl,
    estimate,
    fileCount: input.files.length,
  });
  const comments = [
    input.note?.trim() || null,
    buildOrderComment(estimate),
  ].filter((value): value is string => Boolean(value)).join('\n');

  await db.queryOne<CreatedOrderRow>(
    `INSERT INTO photo_print_orders (
        order_id, mode, contact_name, contact_phone, contact_email,
        comments, total_price, items, status, payment_status,
        description, source, service_type, priority, chat_session_id
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15
      ) RETURNING order_id`,
    [
      orderId,
      RESTORATION_ORDER_MODE,
      input.userName || 'Онлайн-клиент',
      input.userPhone || null,
      input.userEmail || null,
      comments,
      estimate.price,
      JSON.stringify(items),
      orderStatus,
      'none',
      'Реставрация фото',
      'online',
      RESTORATION_SERVICE_TYPE,
      estimate.tier === 'complex' || estimate.tier === 'pro' ? 'urgent' : 'normal',
      conversationId,
    ],
  );

  enqueueCrmEvent('order', orderId, 'order_created', {
    client_name: null,
    client_phone: null,
    preview: `Реставрация фото: ${estimate.title}`,
    status: orderStatus,
    priority: estimate.tier === 'complex' || estimate.tier === 'pro' ? 3 : 2,
    sort_time: new Date().toISOString(),
    channel: null,
    assigned_to: null,
    assigned_to_name: null,
    unread: false,
    metadata: {
      paymentRequired: estimate.automaticPaymentAllowed,
      source: RESTORATION_METADATA_SOURCE,
      fileCount: input.files.length,
      estimateTier: estimate.tier,
      estimatePrice: estimate.price,
      humanReviewRequired: estimate.humanReviewRequired,
      confidence: estimate.confidence,
      model: estimate.model,
      reviewReason: estimate.reviewReason,
      outputTarget: estimate.outputTarget,
      sourceMetrics: estimate.sourceMetrics,
      scores: estimate.scores,
      restorationAnalysis: analysisLog,
    },
  }).catch(err => log.warn('enqueueCrmEvent failed', { orderId, error: String(err) }));

  return {
    orderId,
    estimate,
    paymentUrl: estimate.automaticPaymentAllowed ? `/pay/${orderId}` : null,
    items,
  };
}

function buildOrderComment(estimate: RestorationAnalysisResult): string {
  const prefix = estimate.automaticPaymentAllowed ? 'AI-оценка' : 'AI-анализ требует проверки';
  const reviewReason = estimate.reviewReason ? ` Причина ручной проверки: ${estimate.reviewReason}` : '';
  return `${prefix}: ${estimate.title}, ${estimate.priceLabel}. ${estimate.reason}${reviewReason}`;
}

function buildClientAnalysisFiles(
  files: readonly VerifiedFile[],
  metadataByKey: Map<string, ClientFileMetadata>,
): readonly RestorationAnalysisFile[] {
  return files.map(file => {
    const meta = metadataByKey.get(file.s3Key);
    return {
      s3Key: file.s3Key,
      fileName: file.fileName,
      contentType: file.contentType,
      fileSize: file.fileSize,
      sourceUrl: file.s3Url,
      ...(meta?.width ? { width: meta.width } : {}),
      ...(meta?.height ? { height: meta.height } : {}),
    };
  });
}

function buildAnalysisFiles(
  files: readonly VerifiedFile[],
  metadataByKey: Map<string, ClientFileMetadata>,
): Promise<readonly RestorationAnalysisFile[]> {
  return Promise.all(files.map(async file => {
    const meta = metadataByKey.get(file.s3Key);
    const imageInput = await readStoredImageAnalysisInput(file);
    return {
      s3Key: file.s3Key,
      fileName: file.fileName,
      contentType: file.contentType,
      fileSize: file.fileSize,
      sourceUrl: file.s3Url,
      ...(imageInput.analysisImageUrl ? { analysisImageUrl: imageInput.analysisImageUrl } : {}),
      ...(meta?.width ? { width: meta.width } : imageInput.width ? { width: imageInput.width } : {}),
      ...(meta?.height ? { height: meta.height } : imageInput.height ? { height: imageInput.height } : {}),
    };
  }));
}

async function readStoredImageAnalysisInput(
  file: VerifiedFile,
): Promise<{
  readonly width?: number;
  readonly height?: number;
  readonly analysisImageUrl?: string;
}> {
  try {
    const tempPath = await storageService.downloadToTemp(file.s3Key);
    const metadata = await sharp(tempPath, { failOn: 'none' }).metadata();
    const preview = await sharp(tempPath, { failOn: 'none' })
      .rotate()
      .resize({
        width: RESTORATION_VISION_PREVIEW_MAX_EDGE,
        height: RESTORATION_VISION_PREVIEW_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({
        quality: RESTORATION_VISION_PREVIEW_QUALITY,
        mozjpeg: true,
      })
      .toBuffer();
    return {
      ...(metadata.width && metadata.width > 0 ? { width: metadata.width } : {}),
      ...(metadata.height && metadata.height > 0 ? { height: metadata.height } : {}),
      analysisImageUrl: `data:image/jpeg;base64,${preview.toString('base64')}`,
    };
  } catch (error) {
    log.warn('failed to prepare restoration image preview for vision analysis', {
      s3Key: file.s3Key,
      contentType: file.contentType,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

const uploadRouter = createPresignedUploadRoutes({
  prefix: 'restoration',
  allowedMimes: RESTORATION_MIME_TYPES,
  maxFileSize: MAX_RESTORATION_FILE_SIZE,
  maxFiles: MAX_RESTORATION_FILES,
  auth: [optionalAuth],
  rateLimiter: createUploadLimiter('ul-restoration:', 80, 15 * 60 * 1000),
  onComplete: async (files: VerifiedFile[], req: Request, res: Response): Promise<void> => {
    const parsed = completeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.issues[0]?.message || 'Некорректные данные загрузки');
    }

    const authReq = req as AuthRequest;
    const order = await createRestorationOrder({
      files,
      rawFiles: parsed.data.files,
      note: parsed.data.note,
      pageUrl: parsed.data.pageUrl,
      userId: authReq.user?.id ?? null,
      userName: authReq.user?.display_name ?? null,
      userPhone: authReq.user?.phone ?? null,
      userEmail: authReq.user?.email ?? null,
      outputTarget: parsed.data.outputTarget,
    });

    res.status(201).json({
      success: true,
      data: {
        orderId: order.orderId,
        paymentUrl: order.paymentUrl,
        estimate: order.estimate,
        files: order.items[0]?.uploadedFiles ?? [],
      },
    });
  },
});

router.get('/workload', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const workload = await getRestorationWorkload();
    res.json({ success: true, data: workload });
  } catch (error) {
    next(error);
  }
});

router.use('/upload', uploadRouter);

export default router;
