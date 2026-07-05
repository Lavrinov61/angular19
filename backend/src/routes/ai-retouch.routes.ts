/**
 * ai-retouch.routes.ts — CRM-only AI retouch endpoints (fal.ai pipeline).
 * All endpoints require authenticateToken + bookings:manage permission.
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken, AuthRequest, requireUser, requirePermission } from '../middleware/auth.js';
import db from '../database/db.js';
import { pool } from '../database/db.js';
import { falAIService } from '../services/fal-ai.service.js';
import { createLogger } from '../utils/logger.js';
import {
  getOperationsCatalog,
  estimateCost,
  executePipeline,
  isLocalOperation,
  type PipelineResultMode,
  type RetouchOperation,
} from '../services/ai-retouch.service.js';
import { detectCropLines } from '../services/crop/crop-detect.service.js';
import { validateCropInput } from '../services/crop/crop-validation.js';
import { loadKnownDocumentTypes } from '../services/crop/document-crop-presets.js';
import { saveApprovalOriginalFromUrl } from '../services/approval-original.service.js';
import type AiRetouchJobs from '../types/generated/public/AiRetouchJobs.js';
import type { CountResult } from '../types/views/common-views.js';
import type {
  AiRetouchAdminLogRow,
  AiRetouchOperationStatsRow,
  AiRetouchStatsRow,
  AiRetouchUserStatsRow,
} from '../types/views/ai-retouch-views.js';

const logger = createLogger('ai-retouch.routes');
const router = Router();

const MAX_ACTIVE_PER_SESSION = 3;
const MAX_ACTIVE_GLOBAL = 5;

interface RetouchJobOriginalRow {
  approval_session_id: string;
  result_url: string | null;
  status: string;
}

interface SocketServerLike {
  to: (room: string) => { emit: (event: string, data: unknown) => void };
}

interface CreateJobBody {
  sessionId: string;
  photoId?: string;
  photoUrl: string;
  operations: RetouchOperation[];
  resultMode: PipelineResultMode;
}

function parseResultMode(value: unknown): PipelineResultMode {
  return value === 'work_result' ? 'work_result' : 'approval_photo';
}

function readStringField(body: unknown, key: string): string {
  if (typeof body !== 'object' || body === null) return '';
  const value = Reflect.get(body, key);
  return typeof value === 'string' ? value : '';
}

function readOptionalStringField(body: unknown, key: string): string | undefined {
  const value = readStringField(body, key);
  return value.length > 0 ? value : undefined;
}

function getQueryString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readOperationParams(value: unknown): import('../services/ai-retouch.service.js').RetouchOperationParams | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const params: import('../services/ai-retouch.service.js').RetouchOperationParams = {};
  for (const [key, item] of Object.entries(value)) {
    params[key] = item;
  }
  return params;
}

function readOperations(body: unknown): RetouchOperation[] {
  if (typeof body !== 'object' || body === null) return [];
  const operations = Reflect.get(body, 'operations');
  if (!Array.isArray(operations)) return [];
  return operations
    .map((op): RetouchOperation | null => {
      if (typeof op !== 'object' || op === null || Array.isArray(op)) return null;
      const type = Reflect.get(op, 'type');
      if (typeof type !== 'string' || type.length === 0) return null;
      return { type, params: readOperationParams(Reflect.get(op, 'params')) };
    })
    .filter((op): op is RetouchOperation => op !== null);
}

function readCreateJobBody(body: unknown): CreateJobBody {
  return {
    sessionId: readStringField(body, 'session_id'),
    photoId: readOptionalStringField(body, 'photo_id'),
    photoUrl: readStringField(body, 'photo_url'),
    operations: readOperations(body),
    resultMode: parseResultMode(readStringField(body, 'result_mode')),
  };
}

function getSocketServer(app: unknown): SocketServerLike | undefined {
  if (typeof app !== 'object' || app === null) return undefined;
  const socketServer = Reflect.get(app, 'socketServer');
  if (typeof socketServer !== 'object' || socketServer === null) return undefined;
  const to = Reflect.get(socketServer, 'to');
  return typeof to === 'function' ? { to: to.bind(socketServer) } : undefined;
}

// GET /api/photo-retouch/models — catalog of available operations
router.get('/models', authenticateToken, requirePermission('bookings:manage'), async (_req: AuthRequest, res) => {
  res.json({
    success: true,
    data: {
      operations: getOperationsCatalog(),
      enabled: falAIService.enabled,
      presets: [
        {
          id: 'document',
          label: 'Документ',
          operations: [
            { type: 'remove_background' },
            { type: 'replace_background', params: { prompt: 'plain white studio background' } },
            { type: 'enhance_face' },
          ],
        },
        {
          id: 'military',
          label: 'Парадный Герой',
          operations: [
            { type: 'remove_beard' },
            { type: 'uniform_overlay' },
            { type: 'enhance_face' },
            { type: 'replace_background', params: { prompt: 'plain light gray studio background' } },
          ],
        },
        {
          id: 'enhance',
          label: 'Улучшить качество',
          operations: [
            { type: 'enhance_face' },
            { type: 'upscale' },
          ],
        },
      ],
    },
  });
});

// POST /api/photo-retouch/jobs — create and start pipeline
router.post('/jobs', authenticateToken, requirePermission('bookings:manage'), async (req: AuthRequest, res) => {
  requireUser(req, res);

  // P1-2: сначала парсим и валидируем форму/операции, потом гейт 503 — чтобы local-операции
  // (crop_document) работали на dev без FAL_API_KEY. Нельзя проверить «все local» до парсинга.
  const { sessionId, photoId, photoUrl, operations, resultMode } = readCreateJobBody(req.body);

  if (!sessionId || !photoUrl || !operations.length) {
    res.status(400).json({ success: false, error: 'session_id, photo_url, and operations are required' });
    return;
  }

  // Validate operations
  const catalog = getOperationsCatalog();
  const validTypes = new Set(catalog.map(o => o.type));
  for (const op of operations) {
    if (!validTypes.has(op.type)) {
      res.status(400).json({ success: false, error: `Unknown operation: ${op.type}` });
      return;
    }
  }

  // P1-3: уровень-1 анти-тампера для crop-операций (безразмерные инварианты, без размеров изображения).
  // Ранний 400 на опечатки/подмену координат — job НЕ создаётся. Bounds-проверка — позже в executor.
  const cropOps = operations.filter(op => op.type === 'crop_document');
  if (cropOps.length > 0) {
    const knownTypes = await loadKnownDocumentTypes();
    for (const op of cropOps) {
      const v = validateCropInput(op.params ?? {}, knownTypes);
      if (!v.valid) {
        res.status(400).json({ success: false, error: v.errors.map(e => e.message).join('; ') });
        return;
      }
    }
  }

  // P1-2: гейт 503 ПОСЛЕ парсинга — обходим его, если все операции local (Rust tool, без fal.ai).
  const allLocal = operations.every(op => isLocalOperation(op.type));
  if (!falAIService.enabled && !allLocal) {
    res.status(503).json({ success: false, error: 'AI retouch not configured (FAL_API_KEY missing)' });
    return;
  }

  // Rate limit: max active jobs per session
  const sessionActive = await db.queryOne<CountResult>(
    `SELECT COUNT(*) as count FROM ai_retouch_jobs
     WHERE approval_session_id = $1 AND status IN ('pending', 'processing')`,
    [sessionId],
  );
  if (parseInt(sessionActive?.count || '0') >= MAX_ACTIVE_PER_SESSION) {
    res.status(429).json({ success: false, error: `Max ${MAX_ACTIVE_PER_SESSION} active jobs per session` });
    return;
  }

  // Rate limit: max active jobs globally
  const globalActive = await db.queryOne<CountResult>(
    `SELECT COUNT(*) as count FROM ai_retouch_jobs WHERE status IN ('pending', 'processing')`,
  );
  if (parseInt(globalActive?.count || '0') >= MAX_ACTIVE_GLOBAL) {
    res.status(429).json({ success: false, error: `Max ${MAX_ACTIVE_GLOBAL} active jobs globally, try later` });
    return;
  }

  const costEstimate = estimateCost(operations);
  const jobId = uuidv4();

  await db.query(
    `INSERT INTO ai_retouch_jobs (id, approval_session_id, source_photo_id, source_photo_url, operations, status, total_operations, cost_estimate_usd, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', $6, $7, $8)`,
    [jobId, sessionId, photoId || null, photoUrl, JSON.stringify(operations), operations.length, costEstimate, req.user.id],
  );

  // Fire-and-forget pipeline execution
  const io = getSocketServer(req.app);
  executePipeline({
    jobId,
    sessionId,
    sourcePhotoUrl: photoUrl,
    operations,
    createdBy: req.user.id,
    resultMode,
    socketServer: io,
  }).catch(err => logger.error('[AIRetouch] Pipeline unhandled error', { error: String(err) }));

  res.status(202).json({
    success: true,
    data: { job_id: jobId, status: 'processing', cost_estimate_usd: costEstimate },
  });
});

// POST /api/photo-retouch/jobs/:id/save-as-original — save completed work result as approval session original
router.post('/jobs/:id/save-as-original', authenticateToken, requirePermission('bookings:manage'), async (req: AuthRequest, res) => {
  const job = await db.queryOne<RetouchJobOriginalRow>(
    `SELECT approval_session_id, result_url, status
     FROM ai_retouch_jobs
     WHERE id = $1`,
    [req.params['id']],
  );
  if (!job) {
    res.status(404).json({ success: false, error: 'Job not found' });
    return;
  }
  if (job.status !== 'completed' || !job.result_url) {
    res.status(400).json({ success: false, error: 'Job result is not ready' });
    return;
  }

  const original = await saveApprovalOriginalFromUrl(job.approval_session_id, job.result_url);
  res.json({ success: true, original });
});

// POST /api/photo-retouch/detect-crop-lines — авто-определение линий кадрирования (макушка/подбородок/центр)
router.post('/detect-crop-lines', authenticateToken, requirePermission('bookings:manage'), async (req: AuthRequest, res) => {
  const photo_url = readStringField(req.body, 'photo_url');
  if (!photo_url || typeof photo_url !== 'string') {
    res.status(400).json({ success: false, error: 'photo_url is required' });
    return;
  }
  try {
    const data = await detectCropLines(photo_url);
    res.json({ success: true, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[AIRetouch] detect-crop-lines failed', { error: msg });
    res.status(422).json({ success: false, error: msg });
  }
});

// GET /api/photo-retouch/jobs/:id — job status
router.get('/jobs/:id', authenticateToken, requirePermission('bookings:manage'), async (req: AuthRequest, res) => {
  const job = await db.queryOne<AiRetouchJobs>(
    `SELECT * FROM ai_retouch_jobs WHERE id = $1`,
    [req.params['id']],
  );
  if (!job) {
    res.status(404).json({ success: false, error: 'Job not found' });
    return;
  }
  res.json({ success: true, data: job });
});

// POST /api/photo-retouch/jobs/:id/cancel — cancel a job
router.post('/jobs/:id/cancel', authenticateToken, requirePermission('bookings:manage'), async (req: AuthRequest, res) => {
  const result = await pool.query(
    `UPDATE ai_retouch_jobs SET status = 'cancelled', completed_at = NOW()
     WHERE id = $1 AND status IN ('pending', 'processing')
     RETURNING id`,
    [req.params['id']],
  );
  if (!result.rowCount) {
    res.status(404).json({ success: false, error: 'Job not found or already finished' });
    return;
  }
  res.json({ success: true });
});

// GET /api/photo-retouch/jobs — list jobs for a session
router.get('/jobs', authenticateToken, requirePermission('bookings:manage'), async (req: AuthRequest, res) => {
  const session_id = getQueryString(req.query['session_id']);
  if (!session_id) {
    res.status(400).json({ success: false, error: 'session_id is required' });
    return;
  }
  const rows = await db.query(
    `SELECT * FROM ai_retouch_jobs WHERE approval_session_id = $1 ORDER BY created_at DESC`,
    [session_id],
  );
  res.json({ success: true, data: rows });
});

// GET /api/photo-retouch/admin/logs — admin logs with user info, operations, costs
router.get('/admin/logs', authenticateToken, requirePermission('settings:manage'), async (req: AuthRequest, res) => {
  const page = Math.max(1, parseInt(getQueryString(req.query['page']) || '1', 10));
  const limit = Math.min(100, parseInt(getQueryString(req.query['limit']) || '50', 10));
  const offset = (page - 1) * limit;
  const status = getQueryString(req.query['status']) ?? undefined;

  let where = '';
  const params: unknown[] = [limit, offset];
  if (status) {
    where = `WHERE j.status = $3`;
    params.push(status);
  }

  const rows = await db.query<AiRetouchAdminLogRow>(
    `SELECT j.id, j.status, j.operations, j.total_operations,
            j.cost_estimate_usd, j.actual_cost_usd,
            j.error, j.error_operation,
            j.created_at, j.started_at, j.completed_at,
            j.source_photo_url, j.result_url, j.result_thumbnail_url,
            u.name as user_name, u.email as user_email,
            pas.title as session_title, pas.client_name
     FROM ai_retouch_jobs j
     LEFT JOIN users u ON j.created_by = u.id
     LEFT JOIN photo_approval_sessions pas ON j.approval_session_id = pas.id
     ${where}
     ORDER BY j.created_at DESC
     LIMIT $1 OFFSET $2`,
    params,
  );

  const countRow = await db.queryOne<CountResult>(
    `SELECT COUNT(*) as count FROM ai_retouch_jobs j ${where}`,
    status ? [status] : [],
  );

  res.json({
    success: true,
    data: rows,
    total: parseInt(countRow?.count || '0'),
    page,
    limit,
  });
});

// GET /api/photo-retouch/admin/stats — usage statistics
router.get('/admin/stats', authenticateToken, requirePermission('settings:manage'), async (_req: AuthRequest, res) => {
  const stats = await db.queryOne<AiRetouchStatsRow>(
    `SELECT
       COUNT(*) as total_jobs,
       COUNT(*) FILTER (WHERE status = 'completed') as completed,
       COUNT(*) FILTER (WHERE status = 'failed') as failed,
       COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
       COALESCE(SUM(actual_cost_usd) FILTER (WHERE status = 'completed'), 0) as total_cost_usd,
       COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) FILTER (WHERE status = 'completed'), 0) as avg_duration_sec
     FROM ai_retouch_jobs`,
  );

  // Per-user breakdown
  const perUser = await db.query<AiRetouchUserStatsRow>(
    `SELECT u.name as user_name, u.email,
            COUNT(*) as jobs,
            COUNT(*) FILTER (WHERE j.status = 'completed') as completed,
            COALESCE(SUM(j.actual_cost_usd) FILTER (WHERE j.status = 'completed'), 0) as cost_usd
     FROM ai_retouch_jobs j
     JOIN users u ON j.created_by = u.id
     GROUP BY u.id, u.name, u.email
     ORDER BY cost_usd DESC`,
  );

  // Per-operation breakdown
  const perOp = await db.query<AiRetouchOperationStatsRow>(
    `SELECT op->>'type' as operation_type, COUNT(*) as count
     FROM ai_retouch_jobs j, jsonb_array_elements(j.operations) as op
     WHERE j.status = 'completed'
     GROUP BY op->>'type'
     ORDER BY count DESC`,
  );

  res.json({
    success: true,
    data: {
      summary: stats,
      perUser,
      perOperation: perOp,
    },
  });
});

export default router;
