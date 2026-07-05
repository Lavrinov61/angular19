/**
 * Education print-estimate routes — калькулятор стоимости печати в кабинете подписчика.
 *
 * Namespace: /api/education/print-estimate/*
 *
 *   POST /presign  → выдать presigned-PUT URL под ключ print-estimates/{userId}/{uuid}.{ext}
 *                    (browser → S3 напрямую, минуя :3001). delete-on-replace прежних файлов.
 *   POST /         → оценить цену по уже загруженному файлу (re-callable на тумблер Ч/Б↔Цвет).
 *
 * Безопасность:
 *   - authenticateToken на обоих; per-user rate-limit 30/мин (не per-IP — кампусный NAT).
 *   - IDOR-binding: ключ всегда привязан к req.user.id; estimate проверяет префикс ключа.
 *   - Калькулятор только ОЦЕНИВАЕТ: ничего не пишет в БД, лимит не расходует.
 */

import express, { type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { z } from 'zod';

import { AppError } from '../../middleware/errorHandler.js';
import { ErrorCode } from '../../constants/error-codes.js';
import { validate } from '../../middleware/validate.js';
import { authenticateToken, requireUser, type AuthRequest } from '../../middleware/auth.js';
import { createRateLimitStore } from '../../middleware/rate-limit-store.js';
import { storageService } from '../../services/storage.service.js';
import { estimateEduPrint } from '../../services/edu-print-estimate.service.js';
import { createLogger } from '../../utils/logger.js';

const router = express.Router();
const log = createLogger('education-print-estimate.routes');

const KEY_PREFIX = 'print-estimates';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 МБ

// MIME-allowlist как у document-print-orders (PDF / Office / изображения).
const ALLOWED_MIMES = new Set<string>([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/rtf',
  'text/rtf',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'text/plain',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'image/bmp',
]);

// Per-user лимитер (по req.user.id; fallback на IP для незаауенченных edge-кейсов).
const estimateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req): string => {
    const user = (req as AuthRequest).user;
    return user?.id ?? req.ip ?? 'unknown';
  },
  message: { success: false, error: 'Слишком много запросов, попробуйте позже' },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('ul-edu-coverage:'),
});

const presignSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(160),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
});

const colorModeSchema = z.enum(['auto', 'color', 'bw']);

const estimateSchema = z.object({
  s3Key: z.string().trim().min(1).max(512),
  colorMode: colorModeSchema.default('auto'),
});

function userKeyPrefix(userId: string): string {
  return `${KEY_PREFIX}/${userId}/`;
}

/**
 * POST /presign — выдать presigned-PUT URL. Ключ привязан к userId (IDOR-binding).
 * Перед выдачей best-effort удаляем прежние файлы пользователя (delete-on-replace).
 */
router.post(
  '/presign',
  authenticateToken,
  estimateLimiter,
  validate(presignSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    requireUser(req);
    // fileSize валидируется zod (.max(MAX_FILE_SIZE)) — здесь только MIME-гейт.
    const { fileName, contentType } = req.body as z.infer<typeof presignSchema>;

    if (!ALLOWED_MIMES.has(contentType)) {
      throw new AppError(400, 'Неподдерживаемый тип файла', ErrorCode.VALIDATION_ERROR);
    }

    const userId = req.user.id;
    const ext = path.extname(fileName).toLowerCase() || '.bin';
    const s3Key = `${userKeyPrefix(userId)}${uuidv4()}${ext}`;

    // delete-on-replace: убрать прежние tmp-файлы этого пользователя (не блокируем выдачу).
    storageService
      .listObjectsByPrefix(userKeyPrefix(userId))
      .then(objects => Promise.all(objects.map(o => storageService.delete(o.key))))
      .catch((err: unknown) => log.debug('delete-on-replace skipped', { error: String(err) }));

    const { url } = await storageService.generatePresignedPutUrl(s3Key, contentType);

    res.json({ success: true, data: { s3Key, uploadUrl: url, contentType } });
  },
);

/**
 * POST / — оценить цену по уже загруженному файлу. Re-callable (тумблер цвета).
 * s3Key обязан начинаться с print-estimates/{userId}/ (IDOR), объект обязан существовать.
 */
router.post(
  '/',
  authenticateToken,
  estimateLimiter,
  validate(estimateSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    requireUser(req);
    const { s3Key, colorMode } = req.body as z.infer<typeof estimateSchema>;
    const userId = req.user.id;

    // IDOR-binding: нельзя подсунуть чужой/произвольный ключ в Rust analyze.
    // includes('..') ловит path-traversal (print-estimates/<userId>/../<other>/x.pdf
    // проходит startsWith, но указывает на чужой объект).
    if (s3Key.includes('..') || !s3Key.startsWith(userKeyPrefix(userId))) {
      throw new AppError(403, 'Доступ к файлу запрещён', ErrorCode.FORBIDDEN);
    }

    const head = await storageService.headObject(s3Key);
    if (!head) {
      throw new AppError(410, 'Файл не найден или истёк', ErrorCode.PRINT_ESTIMATE_FILE_NOT_FOUND);
    }

    const result = await estimateEduPrint({ userId, s3Key, colorMode });
    res.json({ success: true, data: result });
  },
);

export default router;
