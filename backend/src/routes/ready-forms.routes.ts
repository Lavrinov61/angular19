import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer, { type FileFilterCallback } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import db from '../database/db.js';
import { requireUser, type AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createUploadLimiter } from '../middleware/upload-limiter.js';
import { createLogger } from '../utils/logger.js';
import type { ReadyFormDownloadRow, ReadyFormListRow, ReadyFormRow, ReadyFormTimestamp } from '../types/views/index.js';

const router = Router();
const logger = createLogger('ready-forms.routes');

const STORAGE_DIR = path.join(config.crmStorage.dir, 'ready-forms');
const MAX_READY_FORM_SIZE_BYTES = 100 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const READY_FORM_UPLOAD_LIMITER = createUploadLimiter('ul-ready-forms:', 60, 15 * 60 * 1000);

const ALLOWED_EXTENSIONS = new Set(['.psd', '.jpg', '.jpeg', '.png']);
const PSD_MIME_TYPES = new Set([
  'image/vnd.adobe.photoshop',
  'application/octet-stream',
  'application/x-photoshop',
  'application/photoshop',
  'application/psd',
  'image/x-photoshop',
  'image/photoshop',
  'image/psd',
]);
const MIME_TYPES_BY_EXTENSION = new Map<string, Set<string>>([
  ['.jpg', new Set(['image/jpeg'])],
  ['.jpeg', new Set(['image/jpeg'])],
  ['.png', new Set(['image/png'])],
  ['.psd', PSD_MIME_TYPES],
]);

const READY_FORM_PUBLIC_FIELDS = `
  rf.id::text AS id,
  rf.title,
  rf.description,
  rf.original_name,
  rf.stored_name,
  rf.mime_type,
  rf.file_size::text AS file_size,
  rf.extension,
  rf.uploaded_by::text AS uploaded_by,
  COALESCE(u.display_name, u.email) AS uploader_name,
  rf.created_at,
  rf.updated_at
`;

interface ReadyFormDto {
  id: string;
  title: string;
  description: string | null;
  originalName: string;
  storedName: string;
  mimeType: string;
  fileSize: number;
  extension: string;
  uploadedBy: string | null;
  uploaderName: string | null;
  createdAt: string;
  updatedAt: string;
  downloadUrl: string;
}

interface ReadyFormUploadBody {
  title?: unknown;
  description?: unknown;
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

await ensureDir(STORAGE_DIR);

function requireAdmin(req: AuthRequest, _res: Response, next: NextFunction): void {
  requireUser(req);
  if (req.user.role !== 'admin') {
    throw new AppError(403, 'Доступ только для администратора');
  }
  next();
}

function sanitizeOriginalName(originalName: string): string {
  const baseName = path.basename(originalName).replace(/[\r\n]/g, ' ').trim();
  return (baseName || 'ready-form').slice(0, 500);
}

function normalizeTitle(value: unknown, originalName: string): string {
  const requested = typeof value === 'string' ? value.trim() : '';
  const fallback = path.basename(originalName, path.extname(originalName)).trim() || originalName;
  return (requested || fallback).slice(0, 255);
}

function normalizeDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 2000) : null;
}

function timestampToIso(value: ReadyFormTimestamp): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapReadyForm(row: ReadyFormRow | ReadyFormListRow): ReadyFormDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    originalName: row.original_name,
    storedName: row.stored_name,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size),
    extension: row.extension,
    uploadedBy: row.uploaded_by,
    uploaderName: row.uploader_name,
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
    downloadUrl: `/api/admin/ready-forms/${row.id}/download`,
  };
}

function getUploadBody(body: unknown): ReadyFormUploadBody {
  return typeof body === 'object' && body !== null ? body as ReadyFormUploadBody : {};
}

function getQueryString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim();
  return null;
}

function parseLimitedInt(value: unknown, fallback: number, max: number): number {
  const raw = getQueryString(value);
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function getUuidParam(req: Request): string {
  const id = req.params['id'];
  if (!id || !UUID_RE.test(id)) {
    throw new AppError(400, 'Некорректный идентификатор формы');
  }
  return id;
}

function isAllowedReadyForm(file: Express.Multer.File): boolean {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedMimes = MIME_TYPES_BY_EXTENSION.get(ext);
  return ALLOWED_EXTENSIONS.has(ext) && !!allowedMimes?.has(file.mimetype);
}

function isSafeStoragePath(filePath: string): boolean {
  const storageRoot = path.resolve(STORAGE_DIR);
  const resolvedPath = path.resolve(filePath);
  return resolvedPath === storageRoot || resolvedPath.startsWith(`${storageRoot}${path.sep}`);
}

function asciiFilenameFallback(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_').trim();
  return fallback || 'ready-form';
}

async function removeUploadedFile(filePath: string, reason: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    logger.warn('Failed to remove ready form file', {
      reason,
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb) => {
    ensureDir(STORAGE_DIR).then(
      () => cb(null, STORAGE_DIR),
      (error: unknown) => cb(error instanceof Error ? error : new Error(String(error)), STORAGE_DIR),
    );
  },
  filename: (_req: Request, file: Express.Multer.File, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_READY_FORM_SIZE_BYTES },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (!isAllowedReadyForm(file)) {
      cb(new AppError(415, 'Можно загружать только PSD, JPG или PNG'));
      return;
    }
    cb(null, true);
  },
});

function uploadSingleReadyForm(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new AppError(413, 'Файл слишком большой. Максимальный размер — 100 МБ'));
      return;
    }

    next(error);
  });
}

router.use(requireAdmin);

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const query = getQueryString(req.query['q']);
  const limit = parseLimitedInt(req.query['limit'], 50, 100);
  const offset = parseLimitedInt(req.query['offset'], 0, 10_000);
  const where: string[] = ['rf.deleted_at IS NULL'];
  const params: unknown[] = [];

  if (query) {
    params.push(`%${query}%`);
    where.push(`(rf.title ILIKE $${params.length} OR rf.original_name ILIKE $${params.length})`);
  }

  params.push(limit);
  const limitParam = params.length;
  params.push(offset);
  const offsetParam = params.length;

  const rows = await db.query<ReadyFormListRow>(
    `SELECT ${READY_FORM_PUBLIC_FIELDS}, COUNT(*) OVER()::text AS total_count
     FROM public.ready_forms rf
     LEFT JOIN public.users u ON u.id = rf.uploaded_by
     WHERE ${where.join(' AND ')}
     ORDER BY rf.created_at DESC
     LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params,
  );

  const firstRow = rows[0];

  res.json({
    success: true,
    data: rows.map(mapReadyForm),
    total: firstRow ? Number(firstRow.total_count) : 0,
  });
});

router.post('/', READY_FORM_UPLOAD_LIMITER, uploadSingleReadyForm, async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  if (!req.file) {
    throw new AppError(400, 'Файл не загружен');
  }

  const body = getUploadBody(req.body);
  const originalName = sanitizeOriginalName(req.file.originalname);
  const ext = path.extname(originalName).toLowerCase();
  const storagePath = path.join(STORAGE_DIR, req.file.filename);
  const title = normalizeTitle(body['title'], originalName);
  const description = normalizeDescription(body['description']);
  const params: unknown[] = [
    title,
    description,
    originalName,
    req.file.filename,
    storagePath,
    req.file.mimetype,
    req.file.size,
    ext.replace('.', ''),
    req.user.id,
  ];

  try {
    const rows = await db.query<ReadyFormRow>(
      `WITH inserted AS (
        INSERT INTO public.ready_forms
          (title, description, original_name, stored_name, storage_path, mime_type, file_size, extension, uploaded_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      )
      SELECT ${READY_FORM_PUBLIC_FIELDS}, rf.storage_path
      FROM inserted rf
      LEFT JOIN public.users u ON u.id = rf.uploaded_by`,
      params,
    );

    const saved = rows[0];
    if (!saved) {
      throw new AppError(500, 'Не удалось сохранить форму');
    }

    res.status(201).json({ success: true, data: mapReadyForm(saved) });
  } catch (error) {
    await removeUploadedFile(storagePath, 'database insert failed');
    throw error;
  }
});

router.get('/:id/download', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const id = getUuidParam(req);
  const params: unknown[] = [id];
  const rows = await db.query<ReadyFormDownloadRow>(
    `SELECT id::text, original_name, storage_path, mime_type, file_size::text AS file_size
     FROM public.ready_forms
     WHERE id = $1 AND deleted_at IS NULL`,
    params,
  );
  const form = rows[0];

  if (!form) {
    throw new AppError(404, 'Форма не найдена');
  }
  if (!isSafeStoragePath(form.storage_path)) {
    logger.error('Ready form storage path is outside storage root', { id, path: form.storage_path });
    throw new AppError(500, 'Файл формы недоступен');
  }

  try {
    await fs.access(form.storage_path);
  } catch (error) {
    logger.warn('Ready form file is missing on disk', {
      id,
      path: form.storage_path,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new AppError(404, 'Файл формы не найден');
  }

  res.setHeader('Content-Type', form.mime_type || 'application/octet-stream');
  res.setHeader('Content-Length', form.file_size);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFilenameFallback(form.original_name)}"; filename*=UTF-8''${encodeURIComponent(form.original_name)}`,
  );

  createReadStream(form.storage_path).on('error', next).pipe(res);
});

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = getUuidParam(req);
  const params: unknown[] = [id];
  const rows = await db.query<ReadyFormDownloadRow>(
    `UPDATE public.ready_forms
     SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id::text, original_name, storage_path, mime_type, file_size::text AS file_size`,
    params,
  );
  const deleted = rows[0];

  if (!deleted) {
    throw new AppError(404, 'Форма не найдена');
  }

  if (isSafeStoragePath(deleted.storage_path)) {
    await removeUploadedFile(deleted.storage_path, 'ready form deleted');
  } else {
    logger.warn('Skipped deleting ready form outside storage root', { id, path: deleted.storage_path });
  }

  res.json({ success: true });
});

export default router;
