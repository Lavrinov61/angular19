import { Router, Request, Response } from 'express';
import QRCode from 'qrcode';
import { AppError } from '../middleware/errorHandler.js';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import db from '../database/db.js';
import type ReviewPlatformStats from '../types/generated/public/ReviewPlatformStats.js';
import type {
  ReviewRequestStats,
  NpsAggregateStats,
  ReviewRequestListItem,
  ReviewRequestCountRow,
  NpsFeedRow,
} from '../types/views/review-views.js';
import { getAggregatedStats, triggerSync } from '../services/review-sync.service.js';
import {
  trackClick,
  getReviewPlatformUrl,
  getReviewRequestStats,
  scheduleReviewRequest,
} from '../services/review-request.service.js';

const router = Router();

/**
 * GET /api/reviews/stats — агрегированная статистика отзывов со всех платформ.
 * Публичный эндпоинт. Читает готовые данные из БД (без парсинга).
 */
router.get('/stats', async (_req: Request, res: Response) => {
  const stats = await getAggregatedStats();
  res.json(stats);
});

/**
 * POST /api/reviews/sync — ручной запуск синхронизации.
 * Запускает парсинг всех платформ прямо сейчас.
 */
router.post('/sync', authenticateToken, requirePermission('manage_settings' as any), async (_req: AuthRequest, res: Response) => {
  await triggerSync();
  const stats = await getAggregatedStats();
  res.json({ success: true, message: 'Sync complete', stats });
});

// ─── Review Request System ───────────────────────────────────────

/**
 * GET /api/reviews/go?t=TOKEN&p=PLATFORM
 * Трекинг клика + 302 редирект на платформу отзывов
 */
router.get('/go', async (req: Request, res: Response) => {
  try {
    const token = req.query['t'] as string;
    const platform = (req.query['p'] as string) || '2gis';

    if (!token) {
      res.redirect('https://svoefoto.ru/review');
      return;
    }

    const redirectUrl = await trackClick(token, platform);

    if (redirectUrl) {
      res.redirect(302, redirectUrl);
    } else {
      const fallbackUrl = getReviewPlatformUrl(null, platform);
      res.redirect(302, fallbackUrl);
    }
  } catch {
    res.redirect('https://svoefoto.ru/review');
  }
});

/**
 * GET /api/reviews/request-stats
 * Статистика запросов отзывов для CRM dashboard
 */
router.get('/request-stats', async (_req: Request, res: Response) => {
  const stats = await getReviewRequestStats();
  res.json({ success: true, data: stats });
});

/**
 * POST /api/reviews/send
 * Ручная отправка запроса отзыва от сотрудника
 */
router.post('/send', async (req: Request, res: Response) => {
  const { phone, email, clientName, locationSlug } = req.body;

  if (!phone && !email) throw new AppError(400, 'phone or email required');

  await scheduleReviewRequest({
    clientName: clientName || null,
    clientPhone: phone || null,
    clientEmail: email || null,
    source: 'manual',
    locationSlug: locationSlug || undefined,
    delayMinutes: 0,
  });

  res.json({ success: true, message: 'Review request scheduled' });
});

/**
 * GET /api/reviews/qr?location=soborny&format=svg
 * Генерация QR-кода для печати
 */
router.get('/qr', async (req: Request, res: Response) => {
  const location = (req.query['location'] as string) || 'soborny';
  const format = (req.query['format'] as string) || 'svg';
  const url = `https://svoefoto.ru/review?location=${encodeURIComponent(location)}`;

  if (format === 'svg') {
    const svg = await QRCode.toString(url, {
      type: 'svg',
      margin: 2,
      width: 300,
      errorCorrectionLevel: 'H',
    });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Content-Disposition', `inline; filename="review-qr-${location}.svg"`);
    res.send(svg);
  } else {
    const buffer = await QRCode.toBuffer(url, {
      type: 'png',
      margin: 2,
      width: 600,
      errorCorrectionLevel: 'H',
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="review-qr-${location}.png"`);
    res.send(buffer);
  }
});

// ─── CRM Dashboard Endpoints ────────────────────────────────────

/**
 * GET /api/reviews/dashboard-stats
 * Агрегированная статистика: review requests + NPS + platform ratings
 */
router.get('/dashboard-stats', authenticateToken, requirePermission('manage_settings' as never), async (_req: AuthRequest, res: Response) => {
  const [requestStats, platforms, npsStats] = await Promise.all([
    db.queryOne<ReviewRequestStats>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status IN ('sent','clicked'))::int AS sent,
         COUNT(*) FILTER (WHERE status = 'clicked')::int AS clicked,
         COUNT(*) FILTER (WHERE status IN ('sent','clicked') AND created_at >= NOW() - INTERVAL '7 days')::int AS sent7d,
         COUNT(*) FILTER (WHERE status = 'clicked' AND created_at >= NOW() - INTERVAL '7 days')::int AS clicked7d
       FROM review_requests`
    ),
    db.query<Pick<ReviewPlatformStats, 'platform' | 'review_count' | 'rating' | 'location_slug'>>(
      `SELECT platform, review_count, rating::float, location_slug
       FROM review_platform_stats
       ORDER BY review_count DESC`
    ),
    db.queryOne<NpsAggregateStats>(
      `SELECT
         COUNT(*)::int AS total,
         COALESCE(AVG(rating), 0)::float AS average,
         COUNT(*) FILTER (WHERE rating = 1)::int AS r1,
         COUNT(*) FILTER (WHERE rating = 2)::int AS r2,
         COUNT(*) FILTER (WHERE rating = 3)::int AS r3,
         COUNT(*) FILTER (WHERE rating = 4)::int AS r4,
         COUNT(*) FILTER (WHERE rating = 5)::int AS r5
       FROM customer_feedback
       WHERE source = 'photo_review_nps'`
    ),
  ]);

  const rs = requestStats ?? { total: 0, sent: 0, clicked: 0, sent7d: 0, clicked7d: 0 };
  const nps = npsStats ?? { total: 0, average: 0, r1: 0, r2: 0, r3: 0, r4: 0, r5: 0 };

  res.json({
    success: true,
    data: {
      requests: {
        ...rs,
        conversionRate: rs.sent > 0 ? Math.round(rs.clicked / rs.sent * 1000) / 10 : 0,
      },
      platforms: platforms ?? [],
      nps: {
        total: nps.total,
        average: Math.round(nps.average * 10) / 10,
        distribution: { 1: nps.r1, 2: nps.r2, 3: nps.r3, 4: nps.r4, 5: nps.r5 },
      },
    },
  });
});

/**
 * GET /api/reviews/requests?status=X&channel=X&location=X&from=X&to=X&limit=50&offset=0
 * Список review requests с фильтрами и пагинацией
 */
router.get('/requests', authenticateToken, requirePermission('manage_settings' as never), async (req: AuthRequest, res: Response) => {
  const status = (req.query['status'] as string) || null;
  const channel = (req.query['channel'] as string) || null;
  const location = (req.query['location'] as string) || null;
  const from = (req.query['from'] as string) || null;
  const to = (req.query['to'] as string) || null;
  const limit = Math.min(Math.max(parseInt(req.query['limit'] as string, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query['offset'] as string, 10) || 0, 0);

  const params: unknown[] = [status, channel, location, from, to, limit, offset];

  const [rows, countRow] = await Promise.all([
    db.query<ReviewRequestListItem>(
      `SELECT
         rr.id, rr.order_id, rr.chat_session_id,
         rr.client_name, rr.client_phone, rr.client_email,
         rr.channel, rr.status, rr.source,
         rr.created_at, rr.sent_at, rr.clicked_at,
         rr.click_platform, rr.nps_rating, rr.error_message,
         rr.location_slug, rr.review_token,
         u.display_name AS employee_name
       FROM review_requests rr
       LEFT JOIN users u ON u.id = rr.employee_id
       WHERE ($1::text IS NULL OR rr.status = $1)
         AND ($2::text IS NULL OR rr.channel = $2)
         AND ($3::text IS NULL OR rr.location_slug = $3)
         AND ($4::timestamptz IS NULL OR rr.created_at >= $4)
         AND ($5::timestamptz IS NULL OR rr.created_at <= $5)
       ORDER BY rr.created_at DESC
       LIMIT $6 OFFSET $7`,
      params
    ),
    db.queryOne<ReviewRequestCountRow>(
      `SELECT COUNT(*)::int AS total
       FROM review_requests rr
       WHERE ($1::text IS NULL OR rr.status = $1)
         AND ($2::text IS NULL OR rr.channel = $2)
         AND ($3::text IS NULL OR rr.location_slug = $3)
         AND ($4::timestamptz IS NULL OR rr.created_at >= $4)
         AND ($5::timestamptz IS NULL OR rr.created_at <= $5)`,
      [status, channel, location, from, to]
    ),
  ]);

  res.json({ success: true, data: rows ?? [], total: countRow?.total ?? 0 });
});

/**
 * GET /api/reviews/nps-feed?limit=50&offset=0&source=X&from=X&to=X
 * Последние NPS-оценки из customer_feedback
 */
router.get('/nps-feed', authenticateToken, requirePermission('manage_settings' as never), async (req: AuthRequest, res: Response) => {
  const source = (req.query['source'] as string) || null;
  const from = (req.query['from'] as string) || null;
  const to = (req.query['to'] as string) || null;
  const limit = Math.min(Math.max(parseInt(req.query['limit'] as string, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query['offset'] as string, 10) || 0, 0);

  const rows = await db.query<NpsFeedRow>(
    `SELECT
       cf.id,
       cf.client_name,
       cf.client_phone,
       cf.rating AS nps_rating,
       cf.source AS channel,
       cf.comment,
       cf.created_at,
       u.display_name AS employee_name,
       NULL::text AS click_platform,
       NULL::text AS location_slug
     FROM customer_feedback cf
     LEFT JOIN users u ON u.id = cf.employee_id
     WHERE ($1::text IS NULL OR cf.source = $1)
       AND ($2::timestamptz IS NULL OR cf.created_at >= $2)
       AND ($3::timestamptz IS NULL OR cf.created_at <= $3)
     ORDER BY cf.created_at DESC
     LIMIT $4 OFFSET $5`,
    [source, from, to, limit, offset]
  );

  res.json({ success: true, data: rows ?? [] });
});

export default router;
