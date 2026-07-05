/**
 * Session Replay + Поведенческая аналитика + Heatmap
 *
 * Публичные endpoints (ingestion, rate-limited, без auth):
 *   POST /api/replay/sessions         — создать сессию
 *   POST /api/replay/chunks           — загрузить чанк rrweb
 *   POST /api/replay/sessions/:id/end — завершить сессию
 *   POST /api/replay/events           — батч поведенческих событий
 *
 * CRM endpoints (requirePermission('clients:view')):
 *   GET  /api/replay/sessions         — список сессий
 *   GET  /api/replay/sessions/:id     — метаданные сессии
 *   GET  /api/replay/sessions/:id/chunks — чанки для воспроизведения
 *   GET  /api/replay/heatmap          — агрегат кликов по странице
 *   GET  /api/replay/analytics/funnel — воронка конверсий
 *   GET  /api/replay/analytics/top-pages — топ страниц
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import db from '../database/db.js';
import { mpQuery } from '../database/mp-db.js';
import { createLogger } from '../utils/logger.js';
import { createRateLimitStore } from '../middleware/rate-limit-store.js';
import type { CountResult } from '../types/views/common-views.js';
import type {
  ReplayFunnelStepRow,
  ReplayHeatmapClickRow,
  ReplayHeatmapPageRow,
  ReplaySessionCreateRow,
  ReplaySessionEndRow,
  ReplaySessionListRow,
  ReplayStatsRow,
  ReplayTopPageRow,
} from '../types/views/replay-views.js';

const replayLog = createLogger('replay');

const router = Router();

// ─── Rate limiter для публичных ingestion endpoints ────────────────────────────
const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 минута
  max: 120,                   // 120 запросов/мин на IP — достаточно для активного пользователя
  message: 'Too many requests',
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('replay:'),
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function detectDeviceType(userAgent: string): string {
  if (/Mobile|Android|iPhone/.test(userAgent)) return 'mobile';
  if (/iPad|Tablet/.test(userAgent)) return 'tablet';
  return 'desktop';
}

interface ReplayMpSyncInput {
  replaySessionId: string;
  visitorId: string | null;
  fingerprintVisitorId: string | null;
  startedAtIso: string;
  landingPage: string | null;
}

function syncReplaySessionLinkToMp(input: ReplayMpSyncInput): void {
  const { replaySessionId, visitorId, fingerprintVisitorId, startedAtIso, landingPage } = input;
  if (!visitorId && !fingerprintVisitorId) return;

  void Promise.allSettled([
    mpQuery(
      `UPDATE ad_clicks
       SET session_id = COALESCE(session_id, $1)
       WHERE session_id IS NULL
         AND clicked_at >= $4::timestamp - INTERVAL '30 minutes'
         AND clicked_at <= $4::timestamp + INTERVAL '2 hours'
         AND (
           ($2 IS NOT NULL AND visitor_id::text = $2)
           OR ($3 IS NOT NULL AND fingerprint_visitor_id = $3)
         )
         AND ($5 IS NULL OR landing_page ILIKE '%' || $5 || '%')`,
      [replaySessionId, visitorId, fingerprintVisitorId, startedAtIso, landingPage],
    ),
    mpQuery(
      `UPDATE visitor_sessions
       SET posthog_distinct_id = COALESCE(posthog_distinct_id, $1),
           updated_at = NOW()
       WHERE posthog_distinct_id IS NULL
         AND (
           ($2 IS NOT NULL AND visitor_id::text = $2)
           OR ($3 IS NOT NULL AND fingerprint_visitor_id = $3)
         )`,
      [replaySessionId, visitorId, fingerprintVisitorId],
    ),
  ]).then(results => {
    const rejected = results.find(r => r.status === 'rejected');
    if (rejected?.status === 'rejected') {
      replayLog.warn('replay link sync failed', {
        replaySessionId,
        visitorId,
        fingerprintVisitorId,
        error: String(rejected.reason),
      });
    }
  });
}

// ─── POST /sessions — создать сессию ──────────────────────────────────────────

router.post('/sessions', ingestLimiter, async (req: Request, res: Response): Promise<void> => {
  const {
    visitor_id, fingerprint_visitor_id, user_id,
    landing_page, user_agent, screen_width, screen_height,
  } = req.body;

  if (!visitor_id) throw new AppError(400, 'visitor_id required');

  const device_type = detectDeviceType(user_agent || '');

  const session = await db.queryOne<ReplaySessionCreateRow>(
    `INSERT INTO replay_sessions
       (visitor_id, fingerprint_visitor_id, user_id, landing_page, user_agent,
        screen_width, screen_height, device_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      visitor_id,
      fingerprint_visitor_id || null,
      user_id || null,
      landing_page || null,
      user_agent || null,
      screen_width || null,
      screen_height || null,
      device_type,
    ]
  );

  if (session?.id) {
    syncReplaySessionLinkToMp({
      replaySessionId: session.id,
      visitorId: visitor_id || null,
      fingerprintVisitorId: fingerprint_visitor_id || null,
      startedAtIso: new Date().toISOString(),
      landingPage: landing_page || null,
    });
  }

  res.status(201).json({ success: true, session_id: session!.id });
});

// ─── PATCH /sessions/:id/fingerprint — post-hoc fp fill ──────────────────────

router.patch('/sessions/:id/fingerprint', ingestLimiter, async (req: Request, res: Response): Promise<void> => {
  const { visitor_id, fingerprint_visitor_id } = req.body;

  if (!visitor_id || !fingerprint_visitor_id) {
    throw new AppError(400, 'visitor_id and fingerprint_visitor_id required');
  }
  if (!/^sf_[A-Za-z0-9]{10,}$/.test(fingerprint_visitor_id)) {
    throw new AppError(400, 'invalid fingerprint_visitor_id format');
  }

  const result = await db.query(
    `UPDATE replay_sessions
        SET fingerprint_visitor_id = $1
      WHERE id = $2
        AND visitor_id = $3
        AND fingerprint_visitor_id IS NULL
      RETURNING id`,
    [fingerprint_visitor_id, req.params.id, visitor_id]
  );

  if (result.length === 0) {
    throw new AppError(403, 'session not found, visitor_id mismatch, or fingerprint already set');
  }

  syncReplaySessionLinkToMp({
    replaySessionId: req.params.id,
    visitorId: visitor_id,
    fingerprintVisitorId: fingerprint_visitor_id,
    startedAtIso: new Date().toISOString(),
    landingPage: null,
  });

  res.json({ success: true });
});

// ─── POST /chunks — загрузить чанк rrweb ──────────────────────────────────────

router.post('/chunks', ingestLimiter, async (req: Request, res: Response): Promise<void> => {
  const { session_id, chunk_index, events, event_count, start_time, end_time } = req.body;

  if (!session_id || chunk_index == null || !Array.isArray(events)) {
    throw new AppError(400, 'session_id, chunk_index, events required');
  }
  if (events.length > 5000) throw new AppError(400, 'Too many events in chunk');

  const eventsJson = JSON.stringify(events);
  const size_bytes = Buffer.byteLength(eventsJson, 'utf8');

  // Upsert чанка
  await db.query(
    `INSERT INTO replay_chunks (session_id, chunk_index, events, event_count, size_bytes, start_time, end_time)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
     ON CONFLICT (session_id, chunk_index) DO UPDATE
       SET events      = EXCLUDED.events,
           event_count = EXCLUDED.event_count,
           size_bytes  = EXCLUDED.size_bytes,
           start_time  = EXCLUDED.start_time,
           end_time    = EXCLUDED.end_time`,
    [session_id, chunk_index, eventsJson, event_count || events.length, size_bytes, start_time || null, end_time || null]
  );

  // Обновляем агрегаты сессии
  await db.query(
    `UPDATE replay_sessions
     SET chunk_count      = (SELECT count(*) FROM replay_chunks WHERE session_id = $1),
         total_size_bytes = (SELECT COALESCE(sum(size_bytes), 0) FROM replay_chunks WHERE session_id = $1)
     WHERE id = $1`,
    [session_id]
  );

  res.json({ success: true });
});

// ─── POST /sessions/:id/end — завершить сессию ────────────────────────────────

router.post('/sessions/:id/end', ingestLimiter, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  // total_pages/total_clicks уже считаются в POST /events — не перезаписываем
  const { has_error, chat_session_id } = req.body;

  const updated = await db.queryOne<ReplaySessionEndRow>(
    `UPDATE replay_sessions
     SET ended_at         = NOW(),
         duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INT,
         is_complete      = TRUE,
         has_error        = COALESCE($2, has_error),
         chat_session_id  = COALESCE($3, chat_session_id)
     WHERE id = $1
     RETURNING visitor_id, fingerprint_visitor_id, landing_page, total_pages, duration_seconds, started_at`,
    [id, has_error ?? null, chat_session_id ?? null]
  );

  // Sync session link + engagement metrics to visitor_sessions (cross-DB, fire-and-forget)
  if (updated) {
    syncReplaySessionLinkToMp({
      replaySessionId: id,
      visitorId: updated.visitor_id,
      fingerprintVisitorId: updated.fingerprint_visitor_id,
      startedAtIso: updated.started_at,
      landingPage: updated.landing_page,
    });

    const isBounce = updated.total_pages <= 1 && (updated.duration_seconds ?? 0) < 30;
    mpQuery(
      `UPDATE visitor_sessions
       SET posthog_distinct_id = COALESCE(posthog_distinct_id, $1),
           pages_viewed = COALESCE(pages_viewed, 0) + $4,
           total_page_views = GREATEST(COALESCE(total_page_views, 0), COALESCE(pages_viewed, 0) + $4),
           duration_seconds = COALESCE(duration_seconds, 0) + COALESCE($5, 0),
           is_bounce = $6,
           updated_at = NOW()
       WHERE (($2 IS NOT NULL AND fingerprint_visitor_id = $2)
           OR ($3 IS NOT NULL AND visitor_id::text = $3))`,
      [id, updated.fingerprint_visitor_id, updated.visitor_id, updated.total_pages, updated.duration_seconds, isBounce],
    ).catch(err => replayLog.warn('engagement sync failed', { error: String(err) }));
  }

  res.json({ success: true });
});

// ─── POST /events — батч поведенческих событий ────────────────────────────────

router.post('/events', ingestLimiter, async (req: Request, res: Response): Promise<void> => {
  const { events } = req.body;

  if (!Array.isArray(events) || events.length === 0) {
    throw new AppError(400, 'events array required');
  }
  if (events.length > 200) throw new AppError(400, 'Max 200 events per batch');

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;
  // hasError считается per-session ниже, при обновлении счётчиков

  for (const ev of events) {
    if (!ev.session_id || !ev.visitor_id || !ev.event_type) continue;

    placeholders.push(
      `($${idx},$${idx+1},$${idx+2},$${idx+3},$${idx+4},$${idx+5},$${idx+6},$${idx+7},$${idx+8},$${idx+9},$${idx+10},$${idx+11},$${idx+12},$${idx+13},$${idx+14})`
    );
    values.push(
      ev.session_id,
      ev.visitor_id,
      ev.event_type,
      ev.event_category || null,
      ev.page_path || null,
      ev.page_title || null,
      ev.element_selector ? String(ev.element_selector).substring(0, 500) : null,
      ev.element_text ? String(ev.element_text).substring(0, 200) : null,
      ev.value_numeric != null ? Number(ev.value_numeric) : null,
      ev.value_text || null,
      JSON.stringify(ev.properties || {}),
      ev.click_x != null ? Math.round(ev.click_x) : null,
      ev.click_y != null ? Math.round(ev.click_y) : null,
      ev.viewport_width || null,
      ev.viewport_height || null,
    );
    idx += 15;
  }

  if (placeholders.length === 0) {
    res.json({ success: true, count: 0 });
    return;
  }

  await db.query(
    `INSERT INTO behavior_events
       (session_id, visitor_id, event_type, event_category,
        page_path, page_title, element_selector, element_text,
        value_numeric, value_text, properties,
        click_x, click_y, viewport_width, viewport_height)
     VALUES ${placeholders.join(', ')}`,
    values
  );

  // Обновляем счётчики кликов/страниц и флаг ошибки per-session
  const sessionIds = [...new Set(events.map(e => e.session_id).filter(Boolean))];
  for (const sid of sessionIds) {
    const clicks = events.filter(e => e.session_id === sid && e.event_type === 'click').length;
    const pages = events.filter(e => e.session_id === sid && e.event_type === 'page_view').length;
    const hasErrorForSession = events.some(e => e.session_id === sid && e.event_type === 'js_error');
    if (clicks > 0 || pages > 0 || hasErrorForSession) {
      await db.query(
        `UPDATE replay_sessions
         SET total_clicks = total_clicks + $2,
             total_pages  = total_pages + $3,
             has_error    = has_error OR $4
         WHERE id = $1`,
        [sid, clicks, pages, hasErrorForSession]
      );
    }
  }

  res.json({ success: true, count: placeholders.length });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRM — READ ENDPOINTS (requirePermission('clients:view'))
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /stats — KPI для дашборда ────────────────────────────────────────────

router.get('/stats', authenticateToken, requirePermission('clients:view'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { days = '30' } = req.query as Record<string, string>;
  const daysNum = Math.min(parseInt(days, 10) || 30, 90);

  const stats = await db.queryOne<ReplayStatsRow>(
    `SELECT
       COUNT(*)::INT                                                      AS total_sessions,
       ROUND(AVG(duration_seconds))::INT                                  AS avg_duration,
       COUNT(*) FILTER (WHERE has_error = TRUE)::INT                      AS error_sessions,
       COUNT(*) FILTER (WHERE device_type = 'desktop')::INT               AS desktop_count,
       COUNT(*) FILTER (WHERE device_type = 'mobile')::INT                AS mobile_count,
       COUNT(*) FILTER (WHERE device_type = 'tablet')::INT                AS tablet_count,
       COUNT(DISTINCT visitor_id)::INT                                    AS unique_visitors
     FROM replay_sessions
     WHERE started_at > NOW() - $1::interval`,
    [`${daysNum} days`]
  );

  res.json({ success: true, data: stats ?? {
    total_sessions: 0, avg_duration: 0, error_sessions: 0,
    desktop_count: 0, mobile_count: 0, tablet_count: 0, unique_visitors: 0,
  }});
});

// ─── GET /sessions — список сессий ────────────────────────────────────────────

const ALLOWED_SORT_FIELDS = ['started_at', 'duration_seconds', 'total_clicks'] as const;

router.get('/sessions', authenticateToken, requirePermission('clients:view'), async (req: AuthRequest, res: Response): Promise<void> => {
  const {
    phone, visitor_id, user_id,
    days = '30', page = '1', limit = '20', device_type,
    has_error, min_duration, landing_page, sort = 'started_at',
    sort_dir = 'desc',
  } = req.query as Record<string, string>;

  const daysNum   = Math.min(parseInt(days, 10) || 30, 90);
  const pageNum   = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum  = Math.min(parseInt(limit, 10) || 20, 100);
  const offset    = (pageNum - 1) * limitNum;

  const conditions: string[] = [`rs.started_at > NOW() - $1::interval`];
  const params: unknown[] = [`${daysNum} days`];
  let pi = 2;

  if (visitor_id) {
    conditions.push(`rs.visitor_id = $${pi++}`);
    params.push(visitor_id);
  }

  if (user_id) {
    conditions.push(`rs.user_id = $${pi++}`);
    params.push(user_id);
  }

  if (device_type) {
    conditions.push(`rs.device_type = $${pi++}`);
    params.push(device_type);
  }

  // Поиск по телефону — через users таблицу
  if (phone) {
    const normalizedPhone = phone.replace(/\D/g, '');
    conditions.push(`rs.user_id IN (SELECT id FROM users WHERE phone LIKE $${pi++})`);
    params.push(`%${normalizedPhone}`);
  }

  // Фильтр по ошибкам
  if (has_error === 'true') {
    conditions.push(`rs.has_error = TRUE`);
  } else if (has_error === 'false') {
    conditions.push(`rs.has_error = FALSE`);
  }

  // Минимальная длительность
  if (min_duration) {
    const minDur = parseInt(min_duration, 10);
    if (minDur > 0) {
      conditions.push(`rs.duration_seconds >= $${pi++}`);
      params.push(minDur);
    }
  }

  // Поиск по лендингу
  if (landing_page) {
    conditions.push(`rs.landing_page ILIKE $${pi++}`);
    params.push(`%${landing_page}%`);
  }

  const where = conditions.join(' AND ');

  // Безопасный sort — только из whitelist
  const sortField = ALLOWED_SORT_FIELDS.includes(sort as typeof ALLOWED_SORT_FIELDS[number])
    ? `rs.${sort}` : 'rs.started_at';
  const sortDir = sort_dir === 'asc' ? 'ASC' : 'DESC';

  const rows = await db.query<ReplaySessionListRow>(
    `SELECT rs.id, rs.visitor_id, rs.user_id,
            rs.landing_page, rs.device_type,
            rs.started_at, rs.ended_at, rs.duration_seconds,
            rs.total_pages, rs.total_clicks, rs.chunk_count,
            rs.has_error, rs.is_complete,
            u.display_name AS user_name, u.phone AS user_phone
     FROM replay_sessions rs
     LEFT JOIN users u ON u.id = rs.user_id
     WHERE ${where}
     ORDER BY ${sortField} ${sortDir} NULLS LAST
     LIMIT $${pi} OFFSET $${pi + 1}`,
    [...params, limitNum, offset]
  );

  const total = await db.queryOne<CountResult>(
    `SELECT count(*) FROM replay_sessions rs WHERE ${where}`,
    params
  );

  res.json({
    success: true,
    data: rows,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: parseInt(total?.count || '0', 10),
      pages: Math.ceil(parseInt(total?.count || '0', 10) / limitNum),
    },
  });
});

// ─── GET /sessions/:id — метаданные сессии ────────────────────────────────────

router.get('/sessions/:id', authenticateToken, requirePermission('clients:view'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const session = await db.queryOne(
    `SELECT rs.*,
            u.display_name as user_name, u.phone as user_phone, u.email as user_email
     FROM replay_sessions rs
     LEFT JOIN users u ON u.id = rs.user_id
     WHERE rs.id = $1`,
    [id]
  );

  if (!session) throw new AppError(404, 'Session not found');

  // Агрегат событий для сессии
  const events = await db.query(
    `SELECT event_type, count(*) as count
     FROM behavior_events
     WHERE session_id = $1
     GROUP BY event_type
     ORDER BY count DESC`,
    [id]
  );

  res.json({ success: true, data: { ...session, event_summary: events } });
});

// ─── GET /sessions/:id/chunks — чанки для воспроизведения ─────────────────────

router.get('/sessions/:id/chunks', authenticateToken, requirePermission('clients:view'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const chunks = await db.query(
    `SELECT chunk_index, events, event_count, start_time, end_time
     FROM replay_chunks
     WHERE session_id = $1
     ORDER BY chunk_index ASC`,
    [id]
  );

  // Параллельно загружаем события для timeline
  const timelineEvents = await db.query(
    `SELECT event_type, page_path, page_title, element_text,
            click_x, click_y, timestamp, time_on_page_ms
     FROM behavior_events
     WHERE session_id = $1
       AND event_type IN ('page_view', 'click', 'rage_click', 'js_error', 'chat_open', 'form_submit')
     ORDER BY timestamp ASC`,
    [id]
  );

  res.json({ success: true, data: { chunks, timeline: timelineEvents } });
});

// ─── GET /heatmap — агрегат кликов ────────────────────────────────────────────

router.get('/heatmap', authenticateToken, requirePermission('clients:view'), async (req: AuthRequest, res: Response): Promise<void> => {
  const {
    page_path, days = '30', device_type,
    visitor_id,
  } = req.query as Record<string, string>;

  const daysNum = Math.min(parseInt(days, 10) || 30, 90);

  const conditions: string[] = [
    `be.timestamp > NOW() - $1::interval`,
    `be.event_type = 'click'`,
    `be.click_x IS NOT NULL`,
    `be.click_y IS NOT NULL`,
    `be.viewport_width IS NOT NULL`,
  ];
  const params: unknown[] = [`${daysNum} days`];
  let pi = 2;

  if (page_path) {
    conditions.push(`be.page_path = $${pi++}`);
    params.push(page_path);
  }

  if (device_type) {
    conditions.push(`rs.device_type = $${pi++}`);
    params.push(device_type);
  }

  if (visitor_id) {
    conditions.push(`be.visitor_id = $${pi++}`);
    params.push(visitor_id);
  }

  const where = conditions.join(' AND ');

  // Нормализованные координаты (click_x / viewport_width * 1000)
  const clicks = await db.query<ReplayHeatmapClickRow>(
    `SELECT
       ROUND(be.click_x * 1000.0 / NULLIF(be.viewport_width, 0))::INT   as nx,
       ROUND(be.click_y * 1000.0 / NULLIF(be.viewport_height, 0))::INT  as ny,
       count(*)::INT as count,
       be.page_path
     FROM behavior_events be
     LEFT JOIN replay_sessions rs ON rs.id = be.session_id
     WHERE ${where}
     GROUP BY nx, ny, be.page_path
     ORDER BY count DESC
     LIMIT 5000`,
    params
  );

  // Список страниц (для dropdown) — применяем те же фильтры что и для кликов
  const pages = await db.query<ReplayHeatmapPageRow>(
    `SELECT be.page_path, count(*)::INT as total_clicks
     FROM behavior_events be
     LEFT JOIN replay_sessions rs ON rs.id = be.session_id
     WHERE ${where}
       AND be.page_path IS NOT NULL
     GROUP BY be.page_path
     ORDER BY total_clicks DESC
     LIMIT 50`,
    params
  );

  res.json({ success: true, data: { clicks, pages, days: daysNum } });
});

// ─── GET /analytics/funnel — воронка конверсий ────────────────────────────────

router.get('/analytics/funnel', authenticateToken, requirePermission('clients:view'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { days = '30' } = req.query as Record<string, string>;
  const daysNum = Math.min(parseInt(days, 10) || 30, 90);

  const steps = await db.query<ReplayFunnelStepRow>(
    `WITH funnel_steps AS (
       SELECT
         COUNT(DISTINCT CASE WHEN event_type = 'page_view'           THEN visitor_id END) as landing,
         COUNT(DISTINCT CASE WHEN page_path LIKE '/services/%'
                              AND event_type = 'page_view'          THEN visitor_id END) as services,
         COUNT(DISTINCT CASE WHEN event_type = 'chat_open'           THEN visitor_id END) as chat_open,
         COUNT(DISTINCT CASE WHEN event_type = 'form_submit'         THEN visitor_id END) as form_submit
       FROM behavior_events
       WHERE timestamp > NOW() - $1::interval
     )
     SELECT
       unnest(ARRAY['Лендинг','Услуги','Открыл чат','Отправил форму']) as step,
       unnest(ARRAY[landing, services, chat_open, form_submit])::INT    as visitors,
       0 as sessions
     FROM funnel_steps`,
    [`${daysNum} days`]
  );

  // 5-й шаг "Отправил заказ" убран — он дублировал "Отправил форму"
  // (оба считали form_submit без фильтра). Добавить когда появится event_type='order_placed'.
  res.json({ success: true, data: steps, days: daysNum });
});

// ─── GET /analytics/top-pages — топ страниц ───────────────────────────────────

router.get('/analytics/top-pages', authenticateToken, requirePermission('clients:view'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { days = '30' } = req.query as Record<string, string>;
  const daysNum = Math.min(parseInt(days, 10) || 30, 90);

  const pages = await db.query<ReplayTopPageRow>(
    `SELECT
       be.page_path,
       count(*)::INT                                                         as visits,
       count(DISTINCT be.session_id)::INT                                    as unique_sessions,
       count(DISTINCT be.visitor_id)::INT                                    as unique_visitors,
       ROUND(AVG(be.time_on_page_ms))::INT                                   as avg_time_ms,
       COUNT(DISTINCT be.session_id) FILTER (WHERE rs.total_pages = 1)::INT  as bounce_count
     FROM behavior_events be
     JOIN replay_sessions rs ON rs.id = be.session_id
     WHERE be.event_type = 'page_view'
       AND be.timestamp > NOW() - $1::interval
       AND be.page_path IS NOT NULL
     GROUP BY be.page_path
     ORDER BY visits DESC
     LIMIT 50`,
    [`${daysNum} days`]
  );

  const result = pages.map(p => ({
    ...p,
    // bounce_rate = bounce_sessions / unique_sessions (корректная единица измерения)
    bounce_rate: p.unique_sessions > 0 ? Math.round((p.bounce_count / p.unique_sessions) * 100) : 0,
    avg_time_sec: p.avg_time_ms ? Math.round(p.avg_time_ms / 1000) : null,
  }));

  res.json({ success: true, data: result, days: daysNum });
});

export default router;
