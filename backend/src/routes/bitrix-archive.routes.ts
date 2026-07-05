/**
 * Bitrix24 Drive archive — OAuth + admin + file download endpoints.
 *
 * Public (no our auth — Bitrix calls these):
 *   POST /oauth/install   — первый callback при установке локального приложения
 *   POST /oauth/handler   — callback при открытии плейсмента в iframe Битрикс
 *   GET  /oauth/status    — диагностика: установлено ли, не истёк ли токен
 *
 * Admin (JWT + settings:manage):
 *   POST /admin/start          — старт прогона импорта (async)
 *   GET  /admin/status         — текущий run
 *   POST /admin/pause/:runId
 *   POST /admin/resume/:runId
 *   POST /admin/cancel/:runId
 *   GET  /admin/errors
 *   GET  /admin/files          — список импортированных файлов
 *   GET  /file/:id             — presigned URL на файл + audit log
 */

import { Router, Request, Response } from 'express';
import db from '../database/db.js';
import { createLogger } from '../utils/logger.js';
import { authenticateToken, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { photoAuditMiddleware } from '../middleware/photo-audit.middleware.js';
import {
  createRun,
  runImport,
  pauseRun,
  resumeRun,
  cancelRun,
  getLatestRun,
} from '../services/bitrix-import/importer.service.js';
import { getPresignedReadUrl } from '../services/bitrix-import/archive-writer.js';
import type { ImportRunConfig } from '../services/bitrix-import/types.js';
import type {
  BitrixOAuthStatusRow,
  BitrixImportRunBrief,
  BitrixPhotoImportRow,
  BitrixPhotoImportS3Keys,
} from '../types/views/bitrix-archive-views.js';

const logger = createLogger('bitrix-archive.routes');
const router = Router();

const EXPECTED_PORTAL_DOMAIN = (process.env['BITRIX_PORTAL_URL'] ?? '')
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '')
  .toLowerCase();

const ENCRYPTION_KEY = process.env['BITRIX_TOKEN_ENCRYPTION_KEY'] ?? '';

type InstallPayload = {
  AUTH_ID?: string;
  AUTH_EXPIRES?: string;
  REFRESH_ID?: string;
  member_id?: string;
  status?: string;
  DOMAIN?: string;
  APP_SID?: string;
  PLACEMENT?: string;
};

async function persistTokens(
  portalUrl: string,
  accessToken: string,
  refreshToken: string,
  expiresInSec: number,
): Promise<void> {
  const expiresAt = new Date(Date.now() + expiresInSec * 1000);
  const params: unknown[] = [portalUrl, accessToken, refreshToken, ENCRYPTION_KEY, expiresAt];
  await db.query(
    `
    INSERT INTO bitrix_oauth_tokens (portal_url, access_token_encrypted, refresh_token_encrypted, scope, expires_at)
    VALUES ($1, pgp_sym_encrypt($2, $4), pgp_sym_encrypt($3, $4), 'disk', $5)
    ON CONFLICT (portal_url) DO UPDATE SET
      access_token_encrypted = EXCLUDED.access_token_encrypted,
      refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
      expires_at = EXCLUDED.expires_at,
      updated_at = now()
    `,
    params,
  );
}

function renderSuccessHtml(title: string, message: string): string {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7f9; color: #1d2433; padding: 40px; text-align: center; }
    .card { background: #fff; max-width: 480px; margin: 0 auto; padding: 32px; border-radius: 16px; box-shadow: 0 2px 12px rgba(0,0,0,.06); }
    h1 { font-size: 20px; margin: 0 0 12px; }
    p { font-size: 14px; line-height: 1.5; color: #4b5563; margin: 0; }
    .ok { color: #10b981; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h1 class="ok">${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

// ─── OAuth install / handler / status ───────────────────────────────────────

router.post('/oauth/install', async (req: Request, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as InstallPayload;
  const { AUTH_ID, AUTH_EXPIRES, REFRESH_ID, member_id, DOMAIN, status, PLACEMENT } = body;

  logger.info('Bitrix install callback received', {
    domain: DOMAIN,
    member_id,
    status,
    placement: PLACEMENT,
    hasAuth: Boolean(AUTH_ID),
    hasRefresh: Boolean(REFRESH_ID),
  });

  if (!ENCRYPTION_KEY) {
    logger.error('BITRIX_TOKEN_ENCRYPTION_KEY missing in env');
    res.status(500).send('Server misconfigured');
    return;
  }

  if (!AUTH_ID || !REFRESH_ID || !DOMAIN) {
    logger.warn('Bitrix install: missing required fields');
    res.status(400).send('Missing AUTH_ID / REFRESH_ID / DOMAIN');
    return;
  }

  const normalizedDomain = DOMAIN.toLowerCase();
  if (EXPECTED_PORTAL_DOMAIN && normalizedDomain !== EXPECTED_PORTAL_DOMAIN) {
    logger.warn('Bitrix install from unexpected domain — rejected', {
      expected: EXPECTED_PORTAL_DOMAIN,
      actual: normalizedDomain,
    });
    res.status(403).send('Unexpected portal domain');
    return;
  }

  const expiresInSec = Number.parseInt(AUTH_EXPIRES ?? '3600', 10);
  const portalUrl = `https://${normalizedDomain}`;

  try {
    await persistTokens(
      portalUrl,
      AUTH_ID,
      REFRESH_ID,
      Number.isFinite(expiresInSec) ? expiresInSec : 3600,
    );
    logger.info('Bitrix tokens saved', { portal: portalUrl, expiresInSec });

    res
      .status(200)
      .type('html')
      .send(
        renderSuccessHtml(
          'Приложение установлено',
          'Архив фотографий с Bitrix24 Drive готов к импорту. Можно закрыть это окно.',
        ),
      );
  } catch (err) {
    logger.error('Failed to save Bitrix tokens', { err: (err as Error).message });
    res.status(500).send('Failed to save tokens');
  }
});

router.post('/oauth/handler', async (req: Request, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as InstallPayload;
  const { AUTH_ID, AUTH_EXPIRES, REFRESH_ID, DOMAIN, PLACEMENT } = body;

  logger.info('Bitrix handler callback', {
    domain: DOMAIN,
    placement: PLACEMENT,
    hasAuth: Boolean(AUTH_ID),
  });

  if (AUTH_ID && REFRESH_ID && DOMAIN && ENCRYPTION_KEY) {
    const normalizedDomain = DOMAIN.toLowerCase();
    if (!EXPECTED_PORTAL_DOMAIN || normalizedDomain === EXPECTED_PORTAL_DOMAIN) {
      const expiresInSec = Number.parseInt(AUTH_EXPIRES ?? '3600', 10);
      const portalUrl = `https://${normalizedDomain}`;
      try {
        await persistTokens(
          portalUrl,
          AUTH_ID,
          REFRESH_ID,
          Number.isFinite(expiresInSec) ? expiresInSec : 3600,
        );
      } catch (err) {
        logger.error('Failed to refresh tokens from handler', { err: (err as Error).message });
      }
    }
  }

  res
    .status(200)
    .type('html')
    .send(
      renderSuccessHtml(
        'Архив фотографий',
        'Импорт настраивается в админке. Статистика и запуск — в CRM → Архив.',
      ),
    );
});

router.get('/oauth/status', async (_req: Request, res: Response): Promise<void> => {
  const row = await db.queryOne<BitrixOAuthStatusRow>(
    `SELECT portal_url, scope, expires_at, updated_at
     FROM bitrix_oauth_tokens
     ORDER BY updated_at DESC
     LIMIT 1`,
  );

  if (!row) {
    res.status(200).json({ installed: false });
    return;
  }

  const expiresAt = new Date(row.expires_at);
  res.status(200).json({
    installed: true,
    portal_url: row.portal_url,
    scope: row.scope,
    expires_at: row.expires_at,
    updated_at: row.updated_at,
    access_token_valid: expiresAt > new Date(),
  });
});

// ─── Admin endpoints ────────────────────────────────────────────────────────

router.post(
  '/admin/start',
  authenticateToken,
  requirePermission('settings:manage'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const cfg = (req.body ?? {}) as ImportRunConfig;
    const runId = await createRun(req.user?.id ?? null, cfg);
    setImmediate(() => {
      runImport(runId, cfg).catch((err) => {
        logger.error('Import run crashed', { runId, err: (err as Error).message });
      });
    });
    res.status(202).json({ run_id: runId, status: 'running' });
  },
);

router.get(
  '/admin/status',
  authenticateToken,
  requirePermission('settings:manage'),
  async (_req: AuthRequest, res: Response): Promise<void> => {
    const run = await getLatestRun();
    res.status(200).json({ run });
  },
);

router.post(
  '/admin/pause/:runId',
  authenticateToken,
  requirePermission('settings:manage'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const runId = Number(req.params['runId']);
    if (!Number.isInteger(runId) || runId <= 0) {
      res.status(400).json({ error: 'Invalid runId' });
      return;
    }
    await pauseRun(runId);
    res.status(200).json({ ok: true });
  },
);

router.post(
  '/admin/resume/:runId',
  authenticateToken,
  requirePermission('settings:manage'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const runId = Number(req.params['runId']);
    if (!Number.isInteger(runId) || runId <= 0) {
      res.status(400).json({ error: 'Invalid runId' });
      return;
    }
    await resumeRun(runId);
    res.status(200).json({ ok: true });
  },
);

router.post(
  '/admin/cancel/:runId',
  authenticateToken,
  requirePermission('settings:manage'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const runId = Number(req.params['runId']);
    if (!Number.isInteger(runId) || runId <= 0) {
      res.status(400).json({ error: 'Invalid runId' });
      return;
    }
    await cancelRun(runId);
    res.status(200).json({ ok: true });
  },
);

router.get(
  '/admin/errors',
  authenticateToken,
  requirePermission('settings:manage'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const limit = Math.min(Number(req.query['limit'] ?? 50), 500);
    const rows = await db.query<BitrixImportRunBrief>(
      `SELECT id, started_at, finished_at, status, last_error, errors_count
       FROM bitrix_import_runs
       WHERE errors_count > 0 OR status = 'failed'
       ORDER BY started_at DESC
       LIMIT $1`,
      [limit],
    );
    res.status(200).json({ runs: rows });
  },
);

router.get(
  '/admin/files',
  authenticateToken,
  requirePermission('settings:manage'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const limit = Math.min(Number(req.query['limit'] ?? 50), 500);
    const offset = Math.max(Number(req.query['offset'] ?? 0), 0);
    const search = req.query['q'] ? String(req.query['q']).slice(0, 200) : null;

    const params: unknown[] = [limit, offset];
    let whereClause = '';
    if (search) {
      params.push(`%${search}%`);
      whereClause = `WHERE bitrix_name ILIKE $3 OR bitrix_folder_path ILIKE $3`;
    }

    const rows = await db.query<BitrixPhotoImportRow>(
      `SELECT id, bitrix_file_id, bitrix_folder_path, bitrix_name,
              s3_bucket, s3_key, size_bytes, mime_type,
              is_webp_preview_generated, imported_at
       FROM bitrix_photo_imports
       ${whereClause}
       ORDER BY imported_at DESC
       LIMIT $1 OFFSET $2`,
      params,
    );
    res.status(200).json({ files: rows });
  },
);

router.get(
  '/file/:id',
  authenticateToken,
  requirePermission('settings:manage'),
  photoAuditMiddleware({ action: 'presign', accessMethod: 'admin_panel', reasonFromQuery: true }),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const id = req.params['id'];
    const row = await db.queryOne<BitrixPhotoImportS3Keys>(
      `SELECT s3_key, webp_preview_key
       FROM bitrix_photo_imports
       WHERE id::text = $1 OR bitrix_file_id = $1`,
      [id],
    );
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const wantPreview = req.query['preview'] === 'true';
    const key = wantPreview && row.webp_preview_key ? row.webp_preview_key : row.s3_key;

    const url = await getPresignedReadUrl(key, 600);
    res.status(200).json({ url, expires_in: 600, key });
  },
);

export default router;
