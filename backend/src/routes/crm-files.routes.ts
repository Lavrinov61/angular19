/**
 * CRM File Storage Routes — Wave 5
 * POST /api/files/crm/upload        — upload file (multer + ClamAV scan)
 * GET  /api/files/crm               — list files (by entity or all)
 * GET  /api/files/crm/:uuid/info    — file metadata
 * GET  /api/files/crm/:uuid         — download file
 * DELETE /api/files/crm/:uuid       — soft delete
 * POST /api/files/crm/:uuid/link    — link to entity
 */

import { Router, Request, Response } from 'express';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { createRequire } from 'module';
// clamscan не имеет ESM-экспортов, используем createRequire для совместимости
const _require = createRequire(import.meta.url);
const NodeClam = _require('clamscan');
import { config } from '../config/index.js';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { AuthRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import db from '../database/db.js';
import { createUploadLimiter } from '../middleware/upload-limiter.js';

import { createLogger } from '../utils/logger.js';
const router = Router();

const logger = createLogger('crm-files.routes');
// All CRM file endpoints require auth
router.use(authenticateToken);
router.use(requirePermission('inbox:view'));

// ─── CONSTANTS ─────────────────────────────────────────────────────────────

const STORAGE_DIR = config.crmStorage.dir;
const MAX_FILE_SIZE = config.crmStorage.maxFileSizeBytes;

// Allowed MIME types for CRM uploads
const ALLOWED_MIMES = new Set([
  // Images
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  // Archives
  'application/zip',
  'application/x-zip-compressed',
]);

// Blocked extensions (extra safety layer)
const BLOCKED_EXTENSIONS = new Set(['.exe', '.sh', '.bat', '.cmd', '.php', '.py', '.js', '.cgi', '.pl']);

// ─── ENSURE STORAGE DIR ───────────────────────────────────────────────────

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

await ensureDir(STORAGE_DIR);

// ─── CLAMAV ───────────────────────────────────────────────────────────────

let clamAvInstance: Awaited<ReturnType<typeof NodeClam.prototype.init>> | null = null;

async function getClamAV() {
  if (clamAvInstance) return clamAvInstance;
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const clamscan = await new (NodeClam as any)().init({
      removeInfected: false,
      quarantineInfected: false,
      scanLog: null,
      debugMode: false,
      fileList: null,
      scanRecursively: false,
      clamscan: {
        path: '/usr/bin/clamscan',
        db: null,
        scanArchives: true,
        active: true,
      },
      clamdscan: {
        socket: false,
        host: false,
        port: false,
        timeout: 60000,
        localFallback: true,
        path: '/usr/bin/clamdscan',
        configFile: null,
        multiscan: true,
        reloadDb: false,
        active: false, // prefer clamscan (no daemon required)
        bypassTest: false,
      },
      preference: 'clamscan',
    });
    clamAvInstance = clamscan;
    return clamscan;
  } catch (err) {
    logger.warn('[ClamAV] Init error', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Scan file for viruses. Returns { clean, result }.
 */
async function scanFile(filePath: string): Promise<{ clean: boolean; result: string }> {
  try {
    const clam = await getClamAV();
    if (!clam) {
      return { clean: true, result: 'skipped (ClamAV unavailable)' };
    }

    const { isInfected, viruses } = await clam.scanFile(filePath);

    if (isInfected) {
      return { clean: false, result: `INFECTED: ${viruses?.join(', ') || 'unknown'}` };
    }
    return { clean: true, result: 'clean' };
  } catch (err) {
    logger.warn('[ClamAV] Scan error', { error: err instanceof Error ? err.message : String(err) });
    return { clean: true, result: `error: ${err instanceof Error ? err.message : 'unknown'}` };
  }
}

// ─── MULTER CONFIG ────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: async (_req: Request, _file: Express.Multer.File, cb) => {
    await ensureDir(STORAGE_DIR);
    cb(null, STORAGE_DIR);
  },
  filename: (_req: Request, file: Express.Multer.File, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const ext = path.extname(file.originalname).toLowerCase();

    if (BLOCKED_EXTENSIONS.has(ext)) {
      cb(new Error(`File extension ${ext} is not allowed`));
      return;
    }
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      cb(new Error(`File type ${file.mimetype} is not allowed`));
      return;
    }
    cb(null, true);
  },
});

// ─── POST /files/crm/upload ───────────────────────────────────────────────

const crmUploadLimiter = createUploadLimiter('ul-crm:', 100, 15 * 60 * 1000);

router.post('/upload', crmUploadLimiter, upload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.file) throw new AppError(400, 'No file uploaded');

  const {
    entity_type = null,
    entity_id = null,
    is_public = 'false',
    tags = '',
  } = req.body as Record<string, string>;

  const fileUuid = uuidv4();
  const ext = path.extname(req.file.originalname).toLowerCase();
  const storedFilename = req.file.filename; // already set by multer diskStorage
  const storagePath = path.join(STORAGE_DIR, storedFilename);

  // Scan with ClamAV
  const { clean, result } = await scanFile(storagePath);

  if (!clean) {
    // Delete infected file immediately
    await fs.unlink(storagePath).catch(() => {});
    throw new AppError(422, `File rejected by antivirus: ${result}`);
  }

  const tagsArr = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const isPublicBool = is_public === 'true';

  const saved = await db.queryOne<{ id: number }>(
    `INSERT INTO crm_files
       (uuid, filename, original_name, mime_type, size_bytes, storage_path,
        entity_type, entity_id, uploaded_by, is_public, tags, clamav_status, clamav_result)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      fileUuid,
      storedFilename,
      req.file.originalname,
      req.file.mimetype,
      req.file.size,
      storagePath,
      entity_type,
      entity_id,
      req.user!.id,
      isPublicBool,
      tagsArr,
      result.startsWith('skipped') ? 'skipped' : 'clean',
      result,
    ]
  );

  res.status(201).json({
    success: true,
    data: {
      id: saved?.id,
      uuid: fileUuid,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      url: `/api/files/crm/${fileUuid}`,
      clamavStatus: result.startsWith('skipped') ? 'skipped' : 'clean',
    },
  });
});

// ─── GET /files/crm — list files ─────────────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response) => {
  const entityType = req.query['entity_type'] as string | undefined;
  const entityId = req.query['entity_id'] as string | undefined;
  const limit = Math.min(parseInt(req.query['limit'] as string) || 50, 200);
  const offset = parseInt(req.query['offset'] as string) || 0;

  const params: unknown[] = [];
  const conditions = ['deleted_at IS NULL'];
  let p = 1;

  if (entityType) {
    conditions.push(`entity_type = $${p++}`);
    params.push(entityType);
  }
  if (entityId) {
    conditions.push(`entity_id = $${p++}`);
    params.push(entityId);
  }

  params.push(offset, limit);

  const rows = await db.query<{
    id: number; uuid: string; original_name: string; mime_type: string;
    size_bytes: string; entity_type: string | null; entity_id: string | null;
    uploaded_by: string; tags: string[]; clamav_status: string; created_at: string;
    total_count: string;
  }>(
    `SELECT f.id, f.uuid, f.original_name, f.mime_type, f.size_bytes,
            f.entity_type, f.entity_id, f.uploaded_by,
            f.tags, f.clamav_status, f.created_at,
            COUNT(*) OVER() AS total_count
     FROM crm_files f
     WHERE ${conditions.join(' AND ')}
     ORDER BY f.created_at DESC
     OFFSET $${p} LIMIT $${p + 1}`,
    params
  );

  const total = rows.length > 0 ? parseInt(rows[0].total_count) : 0;

  res.json({
    success: true,
    data: rows.map(r => ({
      ...r,
      url: `/api/files/crm/${r.uuid}`,
      total_count: undefined,
    })),
    total,
  });
});

// ─── GET /files/crm/:uuid/info ────────────────────────────────────────────

router.get('/:uuid/info', async (req: Request, res: Response) => {
  const { uuid } = req.params;

  const file = await db.queryOne<{
    id: number; uuid: string; original_name: string; mime_type: string;
    size_bytes: string; entity_type: string | null; entity_id: string | null;
    uploaded_by: string; is_public: boolean; tags: string[];
    clamav_status: string; created_at: string;
  }>(
    `SELECT id, uuid, original_name, mime_type, size_bytes,
            entity_type, entity_id, uploaded_by, is_public, tags,
            clamav_status, created_at
     FROM crm_files WHERE uuid = $1 AND deleted_at IS NULL`,
    [uuid]
  );

  if (!file) throw new AppError(404, 'File not found');

  res.json({
    success: true,
    data: { ...file, url: `/api/files/crm/${file.uuid}` },
  });
});

// ─── GET /files/crm/:uuid — download ─────────────────────────────────────

router.get('/:uuid', async (req: AuthRequest, res: Response): Promise<void> => {
  const { uuid } = req.params;

  const file = await db.queryOne<{
    original_name: string; mime_type: string; storage_path: string;
    is_public: boolean; uploaded_by: string; clamav_status: string;
  }>(
    `SELECT original_name, mime_type, storage_path, is_public, uploaded_by, clamav_status
     FROM crm_files WHERE uuid = $1 AND deleted_at IS NULL`,
    [uuid]
  );

  if (!file) throw new AppError(404, 'File not found');

  // Check access: public files are accessible, private require auth
  if (!file.is_public) {
    if (!req.user) throw new AppError(401, 'Authentication required');
    // Admin/employee/manager can access any file; owner can access their own
    if (
      req.user.role !== 'admin' &&
      req.user.role !== 'employee' &&
      req.user.role !== 'manager' &&
      req.user.id !== file.uploaded_by
    ) {
      throw new AppError(403, 'Access denied');
    }
  }

  // Don't serve infected files
  if (file.clamav_status === 'infected') throw new AppError(403, 'File has been flagged by antivirus');

  const filePath = path.resolve(file.storage_path);
  const exists = await fs.access(filePath).then(() => true).catch(() => false);
  if (!exists) throw new AppError(404, 'File not found on disk');

  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.original_name)}"`);

  const stream = createReadStream(filePath);
  stream.pipe(res);
});

// ─── DELETE /files/crm/:uuid — soft delete ───────────────────────────────

router.delete('/:uuid', async (req: AuthRequest, res: Response) => {
  const { uuid } = req.params;

  const file = await db.queryOne<{ id: number; uploaded_by: string; storage_path: string }>(
    'SELECT id, uploaded_by, storage_path FROM crm_files WHERE uuid = $1 AND deleted_at IS NULL',
    [uuid]
  );

  if (!file) throw new AppError(404, 'File not found');

  // Only admin or uploader can delete
  if (req.user!.role !== 'admin' && req.user!.id !== file.uploaded_by) {
    throw new AppError(403, 'Access denied');
  }

  await db.query(
    'UPDATE crm_files SET deleted_at = NOW() WHERE id = $1',
    [file.id]
  );

  res.json({ success: true });
});

// ─── POST /files/crm/:uuid/link — link to entity ─────────────────────────

router.post('/:uuid/link', async (req: AuthRequest, res: Response) => {
  const { uuid } = req.params;
  const { entity_type, entity_id } = req.body as { entity_type: string; entity_id: string };

  if (!entity_type || !entity_id) throw new AppError(400, 'entity_type and entity_id required');

  const valid = ['order', 'task', 'booking', 'client', 'email', 'shared', 'production_order'];
  if (!valid.includes(entity_type)) throw new AppError(400, `entity_type must be one of: ${valid.join(', ')}`);

  const updated = await db.queryOne<{ id: number }>(
    `UPDATE crm_files SET entity_type = $1, entity_id = $2
     WHERE uuid = $3 AND deleted_at IS NULL
     RETURNING id`,
    [entity_type, entity_id, uuid]
  );

  if (!updated) throw new AppError(404, 'File not found');

  res.json({ success: true });
});

export default router;
