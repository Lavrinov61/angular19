import { Router, Request, Response } from 'express';
import db from '../database/db.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { verifyJwt } from '../utils/jwt-keys.js';
import { wsReconnectAttemptsTotal } from '../services/metrics.service.js';

import { createLogger } from '../utils/logger.js';
const router = Router();

const logger = createLogger('app-logs.routes');
const VALID_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
const VALID_LEVEL_SET: ReadonlySet<string> = new Set(VALID_LEVELS);

type AppLogLevel = (typeof VALID_LEVELS)[number];

interface AppLogContext {
  [key: string]: unknown;
}

interface UnknownRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidLevel(value: unknown): value is AppLogLevel {
  return typeof value === 'string' && VALID_LEVEL_SET.has(value);
}

function textOrNull(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  return String(value).replace(/\u0000/g, '').slice(0, maxLength);
}

function logContext(value: unknown): AppLogContext {
  if (!isRecord(value)) return {};
  return value;
}

function contextText(context: AppLogContext, key: string, maxLength: number): string | null {
  return textOrNull(context[key], maxLength);
}

function contextNumber(context: AppLogContext, key: string): number | null {
  const value = context[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function queryText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Извлечь userId из JWT (если есть), без прерывания запроса.
 */
function extractUserId(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const decoded: unknown = verifyJwt(authHeader.slice(7));
    return isRecord(decoded) && typeof decoded['userId'] === 'string' ? decoded['userId'] : null;
  } catch {
    return null;
  }
}

/**
 * POST /api/app-logs — принимает одиночный лог.
 * Без JWT — логи нужны и от неавторизованных пользователей.
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const body = isRecord(req.body) ? req.body : {};
  const rawLevel = body['level'];
  const message = textOrNull(body['message'], 2000);

  if (!rawLevel || !message) throw new AppError(400, 'level and message required');

  const safeLevel = isValidLevel(rawLevel) ? rawLevel : 'info';
  const context = logContext(body['context']);
  const userId = extractUserId(req);

  await db.query(
    `INSERT INTO app_logs (level, message, context, app_version, device_info, visitor_id, user_id, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'frontend')`,
    [
      safeLevel,
      message,
      JSON.stringify(context),
      textOrNull(body['appVersion'], 100),
      textOrNull(body['deviceInfo'], 500),
      textOrNull(body['visitorId'], 100),
      userId,
    ]
  );

  const prefix = safeLevel === 'error' ? '🔴' : safeLevel === 'warn' ? '🟡' : '📱';
  logger.info(`${prefix} [AppLog] [${safeLevel}] ${message}`, context ? { context } : undefined);

  res.json({ success: true });
});

/**
 * POST /api/app-logs/batch — принимает массив логов от frontend LoggerService.
 * Без JWT — батч может приходить от неавторизованных.
 */
router.post('/batch', async (req: Request, res: Response): Promise<void> => {
  const body = isRecord(req.body) ? req.body : {};
  const logs = body['logs'];
  if (!Array.isArray(logs) || logs.length === 0) {
    res.json({ success: true, inserted: 0, failed: 0 });
    return;
  }

  const userId = extractUserId(req);
  let inserted = 0;
  let failed = 0;

  for (const rawLog of logs.slice(0, 50)) {
    const log = isRecord(rawLog) ? rawLog : {};
    const safeLevel = isValidLevel(log['level']) ? log['level'] : 'info';
    const context = logContext(log['context']);
    const message = textOrNull(log['message'], 2000) || '';
    const service = textOrNull(log['service'], 100);
    const fingerprint = textOrNull(log['fingerprint'], 128);

    try {
      await db.query(
        `INSERT INTO app_logs (level, message, context, app_version, service, user_id, url,
          http_status, http_method, http_url, stack_trace, fingerprint, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'frontend')`,
        [
          safeLevel,
          message,
          JSON.stringify(context),
          textOrNull(log['appVersion'], 100),
          service,
          userId,
          textOrNull(log['url'], 1000),
          contextNumber(context, 'httpStatus'),
          contextText(context, 'httpMethod', 20),
          contextText(context, 'httpUrl', 1000),
          contextText(context, 'stack', 5000),
          fingerprint,
        ]
      );
      inserted++;
    } catch (error) {
      failed++;
      logger.warn('[AppLog] Failed to store frontend log', {
        error: String(error),
        service,
        fingerprint,
      });
      continue;
    }

    // Stdout для journalctl
    if (safeLevel === 'error' || safeLevel === 'warn') {
      const prefix = safeLevel === 'error' ? '🔴' : '🟡';
      const svc = service ? `[${service}]` : '';
      logger.info(`${prefix} [AppLog] ${svc} ${message}`);
    }

    // Phase 4 observability: frontend reports WS reconnect attempts via app-logs.
    if (context['wsMetric'] === 'reconnect') {
      wsReconnectAttemptsTotal.inc({ reason: String(context['reason'] || 'unknown') });
    }
  }

  res.json({ success: true, inserted, failed });
});

/**
 * GET /api/app-logs/stats — статистика ошибок (для admin UI)
 */
router.get('/stats', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !['admin', 'manager'].includes(req.user.role)) {
    throw new AppError(403, 'Admin access required');
  }

  const [stats] = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE level = 'error' AND created_at > NOW() - INTERVAL '1 hour') AS errors_1h,
      COUNT(*) FILTER (WHERE level = 'error' AND created_at > NOW() - INTERVAL '24 hours') AS errors_24h,
      COUNT(*) FILTER (WHERE level = 'warn' AND created_at > NOW() - INTERVAL '24 hours') AS warnings_24h,
      COUNT(DISTINCT fingerprint) FILTER (WHERE level = 'error' AND created_at > NOW() - INTERVAL '24 hours') AS unique_errors_24h
    FROM app_logs
  `);

  const topServices = await db.query(`
    SELECT service, COUNT(*) AS count
    FROM app_logs
    WHERE level = 'error' AND created_at > NOW() - INTERVAL '24 hours' AND service IS NOT NULL
    GROUP BY service ORDER BY count DESC LIMIT 5
  `);

  res.json({ success: true, data: { ...stats, topServices } });
});

/**
 * GET /api/app-logs/recent — последние логи (для админов).
 * Параметры: ?level=error&service=InboxService&since=2026-03-04T00:00:00Z&grouped=true&limit=100
 */
router.get('/recent', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !['admin', 'manager'].includes(req.user.role)) {
    throw new AppError(403, 'Admin access required');
  }

  const limit = Math.min(parseInt(String(req.query['limit'] || '100'), 10), 500);
  const level = queryText(req.query['level']);
  const service = queryText(req.query['service']);
  const since = queryText(req.query['since']);
  const grouped = req.query['grouped'] === 'true';

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (level) { conditions.push(`level = $${idx++}`); params.push(level); }
  if (service) { conditions.push(`service = $${idx++}`); params.push(service); }
  if (since) { conditions.push(`created_at >= $${idx++}`); params.push(since); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  if (grouped) {
    const query = `
      SELECT fingerprint, level, service, message,
        MAX(url) AS url, MAX(http_status) AS http_status, MAX(http_url) AS http_url,
        MAX(context) AS context, MAX(stack_trace) AS stack_trace,
        COUNT(*) AS occurrence_count,
        MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
      FROM app_logs ${where}
      GROUP BY fingerprint, level, service, message
      ORDER BY last_seen DESC LIMIT $${idx}
    `;
    params.push(limit);
    const logs = await db.query(query, params);
    res.json({ success: true, data: logs });
  } else {
    const query = `
      SELECT id, level, message, context, service, app_version, url,
        http_status, http_method, http_url, stack_trace, fingerprint,
        device_info, visitor_id, user_id, source, created_at
      FROM app_logs ${where}
      ORDER BY created_at DESC LIMIT $${idx}
    `;
    params.push(limit);
    const logs = await db.query(query, params);
    res.json({ success: true, data: logs });
  }
});

export default router;
