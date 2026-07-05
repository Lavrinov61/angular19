/**
 * CRM Advanced Analytics Routes — Wave 7
 * Воронки, когорты, retention, каналы привлечения
 */

import { Router, Response } from 'express';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import db from '../database/db.js';
import { cacheGetOrFetch } from '../services/redis-cache.service.js';
import { rateLimitCrm } from '../middleware/rate-limiter.js';
import type { RevenueByChannelRow, PosRevenueByStudioRow } from '../types/views/index.js';

const router = Router();
router.use(authenticateToken, requirePermission('analytics:view'));
router.use(rateLimitCrm(10, 60));

// ── Утилита: период → SQL interval ────────────────────────────

function periodToInterval(period: string): string {
  switch (period) {
    case '7d':   return '7 days';
    case '30d':  return '30 days';
    case '90d':  return '90 days';
    case '180d': return '180 days';
    case '365d': return '365 days';
    default:     return '30 days';
  }
}

// ── GET /api/crm/analytics/funnel ─────────────────────────────
// ?type=online|studio  &period=7d|30d|90d

router.get('/funnel', async (req: AuthRequest, res: Response): Promise<void> => {
  const type     = req.query['type']   as string || 'online';
  const period   = req.query['period'] as string || '30d';
  const cacheKey = `crm:analytics:funnel:${type}:${period}`;

  const data = await cacheGetOrFetch(cacheKey, 300, 60, async () => {
    const interval = periodToInterval(period);

    if (type === 'online') {
      const rows = await db.query(
        `SELECT
           COUNT(*)                                                         AS step1_sessions,
           COUNT(CASE WHEN last_message_at IS NOT NULL THEN 1 END)         AS step2_engaged,
           COUNT(CASE WHEN (selected_service IS NOT NULL
                        OR selected_price   IS NOT NULL)  THEN 1 END)      AS step3_interested,
           (
             SELECT COUNT(DISTINCT ppo.id)
               FROM photo_print_orders ppo
              WHERE ppo.payment_status = 'paid'
                AND ppo.created_at >= NOW() - $1::interval
           )                                                                AS step4_paid
         FROM conversations
        WHERE created_at >= NOW() - $1::interval
          AND channel     != 'studio'`,
        [interval],
      );

      const r = rows[0] as Record<string, unknown>;
      return {
        success: true,
        type: 'online',
        period,
        steps: [
          { id: 1, label: 'Начали чат',       value: Number(r['step1_sessions']) },
          { id: 2, label: 'Вступили в диалог', value: Number(r['step2_engaged']) },
          { id: 3, label: 'Интерес к услуге', value: Number(r['step3_interested']) },
          { id: 4, label: 'Оформили заказ',   value: Number(r['step4_paid']) },
        ],
      };
    }

    const rows = await db.query(
      `SELECT
         COUNT(*)                                                                 AS step1_bookings,
         COUNT(CASE WHEN status NOT IN ('cancelled','no-show')  THEN 1 END)      AS step2_confirmed,
         COUNT(CASE WHEN status = 'completed'                   THEN 1 END)      AS step3_completed,
         (
           SELECT COUNT(DISTINCT pr.id)
             FROM pos_receipts pr
            WHERE pr.created_at >= NOW() - $1::interval
              AND pr.is_refund  = false
         )                                                                        AS step4_pos
       FROM bookings
      WHERE created_at >= NOW() - $1::interval`,
      [interval],
    );

    const r = rows[0] as Record<string, unknown>;
    return {
      success: true,
      type: 'studio',
      period,
      steps: [
        { id: 1, label: 'Запись создана',    value: Number(r['step1_bookings']) },
        { id: 2, label: 'Подтверждена',      value: Number(r['step2_confirmed']) },
        { id: 3, label: 'Завершена',         value: Number(r['step3_completed']) },
        { id: 4, label: 'Чек пробит (POS)', value: Number(r['step4_pos']) },
      ],
    };
  });

  res.json(data);
});

// ── GET /api/crm/analytics/cohorts ────────────────────────────
// ?period=90d|180d|365d  &groupBy=week|month

router.get('/cohorts', async (req: AuthRequest, res: Response): Promise<void> => {
  const period   = req.query['period']  as string || '180d';
  const groupBy  = req.query['groupBy'] as string || 'month';

  if (!['week', 'month'].includes(groupBy)) {
    throw new AppError(400, 'groupBy должен быть week или month');
  }

  const cacheKey = `crm:analytics:cohorts:${period}:${groupBy}`;

  const data = await cacheGetOrFetch(cacheKey, 900, 180, async () => {
    const interval     = periodToInterval(period);
    const trunc        = groupBy === 'week' ? 'week' : 'month';
    const extractField = groupBy === 'week' ? 'WEEK' : 'MONTH';

    const rows = await db.query(
      `WITH all_orders AS (
         SELECT
           contact_phone,
           DATE_TRUNC('${trunc}', created_at) AS order_period
         FROM photo_print_orders
         WHERE payment_status = 'paid'
           AND contact_phone  IS NOT NULL
           AND created_at    >= NOW() - $1::interval
       ),
       first_order AS (
         SELECT contact_phone, MIN(order_period) AS cohort
         FROM all_orders
         GROUP BY contact_phone
       ),
       cohort_data AS (
         SELECT
           fo.cohort,
           COUNT(DISTINCT fo.contact_phone)   AS cohort_size,
           EXTRACT(${extractField} FROM AGE(ao.order_period, fo.cohort))
                                              AS period_offset,
           COUNT(DISTINCT ao.contact_phone)   AS retained
         FROM first_order fo
         JOIN all_orders ao ON ao.contact_phone = fo.contact_phone
         GROUP BY fo.cohort, ao.order_period
       )
       SELECT
         cohort,
         cohort_size,
         JSONB_AGG(
           JSONB_BUILD_OBJECT('offset', period_offset, 'retained', retained)
           ORDER BY period_offset
         ) AS periods
       FROM cohort_data
       GROUP BY cohort, cohort_size
       ORDER BY cohort DESC
       LIMIT 8`,
      [interval],
    );

    interface CohortRaw { cohort: string; cohort_size: number; periods: { offset: number; retained: number }[] }

    return {
      success: true,
      groupBy,
      period,
      cohorts: (rows as CohortRaw[]).map(r => ({
        cohort:     r.cohort,
        cohortSize: Number(r.cohort_size),
        periods:    r.periods.map(p => ({
          offset:   Number(p.offset),
          retained: Number(p.retained),
          rate:     r.cohort_size > 0
            ? Math.round((Number(p.retained) / Number(r.cohort_size)) * 100)
            : 0,
        })),
      })),
    };
  });

  res.json(data);
});

// ── GET /api/crm/analytics/retention ─────────────────────────
// ?period=90d|180d|365d

router.get('/retention', async (req: AuthRequest, res: Response): Promise<void> => {
  const period   = req.query['period'] as string || '90d';
  const cacheKey = `crm:analytics:retention:${period}`;

  const data = await cacheGetOrFetch(cacheKey, 900, 180, async () => {
    const interval = periodToInterval(period);

    const rows = await db.query(
      `WITH first_time AS (
         SELECT contact_phone, MIN(created_at) AS first_at
         FROM photo_print_orders
         WHERE payment_status = 'paid'
           AND contact_phone  IS NOT NULL
           AND created_at    >= NOW() - $1::interval
         GROUP BY contact_phone
       ),
       returned_30 AS (
         SELECT DISTINCT p.contact_phone
         FROM photo_print_orders p
         JOIN first_time ft ON ft.contact_phone = p.contact_phone
         WHERE p.created_at      >  ft.first_at + INTERVAL '1 day'
           AND p.created_at      <= ft.first_at + INTERVAL '30 days'
           AND p.payment_status   = 'paid'
       ),
       returned_60 AS (
         SELECT DISTINCT p.contact_phone
         FROM photo_print_orders p
         JOIN first_time ft ON ft.contact_phone = p.contact_phone
         WHERE p.created_at      >  ft.first_at + INTERVAL '30 days'
           AND p.created_at      <= ft.first_at + INTERVAL '60 days'
           AND p.payment_status   = 'paid'
       ),
       returned_90 AS (
         SELECT DISTINCT p.contact_phone
         FROM photo_print_orders p
         JOIN first_time ft ON ft.contact_phone = p.contact_phone
         WHERE p.created_at      >  ft.first_at + INTERVAL '60 days'
           AND p.created_at      <= ft.first_at + INTERVAL '90 days'
           AND p.payment_status   = 'paid'
       ),
       chat_cohort AS (
         SELECT
           COUNT(DISTINCT c.visitor_phone)  AS total_engaged,
           COUNT(DISTINCT CASE
             WHEN c.visitor_phone IN (SELECT contact_phone FROM first_time)
             THEN c.visitor_phone END)      AS converted
         FROM conversations c
         WHERE c.created_at   >= NOW() - $1::interval
           AND c.visitor_phone IS NOT NULL
       )
       SELECT
         (SELECT COUNT(*) FROM first_time)   AS total_customers,
         (SELECT COUNT(*) FROM returned_30)  AS returned_30d,
         (SELECT COUNT(*) FROM returned_60)  AS returned_60d,
         (SELECT COUNT(*) FROM returned_90)  AS returned_90d,
         cc.total_engaged,
         cc.converted
       FROM chat_cohort cc`,
      [interval],
    );

    const r     = rows[0] as Record<string, unknown>;
    const total = Number(r['total_customers']);

    return {
      success: true,
      period,
      totalCustomers:  total,
      chatToOrderRate: Number(r['total_engaged']) > 0
        ? Math.round((Number(r['converted']) / Number(r['total_engaged'])) * 100)
        : 0,
      retention: [
        {
          period:   '0–30 дней',
          returned: Number(r['returned_30d']),
          rate:     total > 0 ? Math.round((Number(r['returned_30d']) / total) * 100) : 0,
        },
        {
          period:   '31–60 дней',
          returned: Number(r['returned_60d']),
          rate:     total > 0 ? Math.round((Number(r['returned_60d']) / total) * 100) : 0,
        },
        {
          period:   '61–90 дней',
          returned: Number(r['returned_90d']),
          rate:     total > 0 ? Math.round((Number(r['returned_90d']) / total) * 100) : 0,
        },
      ],
    };
  });

  res.json(data);
});

// ── GET /api/crm/analytics/channels ──────────────────────────
// ?period=7d|30d|90d

router.get('/channels', async (req: AuthRequest, res: Response): Promise<void> => {
  const period   = req.query['period'] as string || '30d';
  const cacheKey = `crm:analytics:channels:${period}`;

  const data = await cacheGetOrFetch(cacheKey, 300, 60, async () => {
    const interval = periodToInterval(period);

    const rows = await db.query(
      `SELECT
         COALESCE(vcs.channel, 'unknown')          AS channel,
         COUNT(DISTINCT vcs.id)                    AS sessions,
         COUNT(DISTINCT ppo.id)                    AS orders,
         COALESCE(SUM(ppo.total_price), 0)         AS revenue,
         ROUND(AVG(vcs.csat_score), 1)             AS avg_csat,
         ROUND(
           COUNT(DISTINCT ppo.id)::numeric
           / NULLIF(COUNT(DISTINCT vcs.id), 0) * 100,
         1)                                        AS conversion_rate
       FROM conversations vcs
       LEFT JOIN photo_print_orders ppo
         ON ppo.chat_session_id = vcs.id
         AND ppo.payment_status = 'paid'
       WHERE vcs.created_at >= NOW() - $1::interval
       GROUP BY vcs.channel
       ORDER BY revenue DESC, sessions DESC`,
      [interval],
    );

    const posRows = await db.query(
      `SELECT
         COUNT(*)                    AS receipts,
         COALESCE(SUM(total), 0)    AS revenue
       FROM pos_receipts
       WHERE created_at >= NOW() - $1::interval
         AND is_refund   = false`,
      [interval],
    );

    interface ChannelRaw { channel: string; sessions: number; orders: number; revenue: number; avg_csat: number | null; conversion_rate: number }
    interface PosRaw { receipts: number; revenue: number }

    return {
      success: true,
      period,
      onlineChannels: (rows as ChannelRaw[]).map(r => ({
        channel:        r.channel,
        sessions:       Number(r.sessions),
        orders:         Number(r.orders),
        revenue:        Number(r.revenue),
        conversionRate: Number(r.conversion_rate) || 0,
        avgCsat:        r.avg_csat != null ? Number(r.avg_csat) : null,
      })),
      posTotal: {
        receipts: Number((posRows[0] as PosRaw)?.receipts || 0),
        revenue:  Number((posRows[0] as PosRaw)?.revenue  || 0),
      },
    };
  });

  res.json(data);
});

// ── GET /api/crm/analytics/revenue-attribution ──────────────
// ?period=7d|30d|90d

router.get('/revenue-attribution', async (req: AuthRequest, res: Response): Promise<void> => {
  const period   = req.query['period'] as string || '30d';
  const cacheKey = `crm:analytics:revenue-attribution:${period}`;

  const data = await cacheGetOrFetch(cacheKey, 300, 60, async () => {
    const interval = periodToInterval(period);

    const channelRows = await db.query<RevenueByChannelRow>(
      `SELECT
         COALESCE(c.channel, 'walk-in')     AS channel,
         COUNT(*)::text                      AS orders,
         COALESCE(SUM(ppo.total_price), 0)::text AS revenue,
         ROUND(AVG(ppo.total_price)::numeric, 0)::text AS avg_check
       FROM photo_print_orders ppo
       LEFT JOIN conversations c
         ON c.id = ppo.chat_session_id
       WHERE ppo.created_at >= NOW() - $1::interval
         AND ppo.payment_status = 'paid'
       GROUP BY COALESCE(c.channel, 'walk-in')
       ORDER BY SUM(ppo.total_price) DESC NULLS LAST`,
      [interval],
    );

    const posRows = await db.query<PosRevenueByStudioRow>(
      `SELECT
         s.name                              AS studio,
         COUNT(*)::text                      AS count,
         COALESCE(SUM(pr.total::numeric), 0)::text AS revenue
       FROM pos_receipts pr
       JOIN studios s ON s.id = pr.studio_id
       WHERE pr.created_at >= NOW() - $1::interval
         AND pr.voided_at IS NULL
         AND (pr.is_refund IS NULL OR pr.is_refund = false)
       GROUP BY s.name
       ORDER BY SUM(pr.total::numeric) DESC NULLS LAST`,
      [interval],
    );

    const totalRevenue = channelRows.reduce((s, r) => s + parseFloat(r.revenue), 0);

    return {
      period,
      channels: channelRows.map(r => {
        const rev = parseFloat(r.revenue);
        return {
          channel:  r.channel,
          orders:   parseInt(r.orders, 10),
          revenue:  rev,
          avgCheck: parseInt(r.avg_check, 10),
          share:    totalRevenue > 0 ? Math.round((rev / totalRevenue) * 1000) / 10 : 0,
        };
      }),
      posStudios: posRows.map(r => ({
        studio:  r.studio,
        count:   parseInt(r.count, 10),
        revenue: parseFloat(r.revenue),
      })),
      totalRevenue,
    };
  });

  res.json({ success: true, data });
});

export default router;
