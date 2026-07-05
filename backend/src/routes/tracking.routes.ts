/**
 * Tracking Routes — замена Python tracking_api.py (:5051).
 *
 * Обрабатывает рекламные клики, QR-сканирования и сессии посетителей.
 * Вызывается из Angular frontend через /api/tracking/*.
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { mpQuery } from '../database/mp-db.js';
import { createLogger } from '../utils/logger.js';
import { createRateLimitStore } from '../middleware/rate-limit-store.js';
import { enqueueVisitorSessionUpdate } from '../workers/visitor-session-worker.js';
import { adClicksTotal, adClicksErrorsTotal } from '../services/metrics.service.js';
import type {
  PurchaseInsertResult, TouchpointInsertResult,
  AdClickSession, TrackingStatsRow, SourceClicksRow,
  CustomerJourneyClickRow,
  CustomerJourneyCustomerRow,
  CustomerJourneyPurchaseRow,
  CustomerJourneyTouchpointRow,
} from '../types/views/tracking-views.js';

const router = Router();
const log = createLogger('tracking');

interface TrackingClickBody {
  visitor_id?: string;
  fingerprint_visitor_id?: string;
  replay_session_id?: string;
  posthog_distinct_id?: string;
  session_id?: string;
  tracking_id?: string;
  tracking?: string;
  tracking_referrer?: string;
  tracking_pos?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  platform?: string;
  referrer?: string;
  user_agent?: string;
  device_fingerprint?: string;
  landing_page?: string;
  host?: string;
  first_visit_id?: string;
  device_is_mobile?: boolean;
}

interface TrackingMetka {
  ad_platform?: string | null;
  source_type?: string | null;
  banner_id?: string | null;
  keyword?: string | null;
  search_phrase?: string | null;
}

function isTrackingClickBody(body: unknown): body is TrackingClickBody {
  return typeof body === 'object' && body !== null;
}

const clickLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: 'Too many click events',
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('rl:click:'),
  keyGenerator: (req) => {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
    const body = isTrackingClickBody(req.body) ? req.body : null;
    const fpId = body?.fingerprint_visitor_id ?? '';
    return fpId ? `${ip}:${fpId}` : ip;
  },
});

// ────── Helpers ──────

function parseTrackingMetka(tracking: string): TrackingMetka {
  if (!tracking) return {};
  const parts = tracking.split('_');

  if (tracking.startsWith('direct1_') && parts.length >= 4) {
    return {
      ad_platform: 'yandex_direct',
      source_type: parts[1] ?? null,
      banner_id: parts[2] ?? null,
      keyword: parts.slice(3).join('_') || null,
    };
  }
  if (tracking.startsWith('vkads2_') && parts.length >= 2) {
    return {
      ad_platform: 'vk_ads',
      banner_id: parts[1] ?? null,
      search_phrase: parts.slice(2).join('_') || null,
    };
  }
  return {};
}

function getIpPrefix(ip: string | undefined): string | null {
  if (!ip) return null;
  const parts = ip.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  return ip;
}

function normalizeUtmSource(source: string | undefined): string | undefined {
  if (!source) return source;
  const s = source.toLowerCase().trim();
  if (['yandex', 'ya', 'ya_direct', 'direct', 'ydirect', 'yandex_direct'].includes(s)) return 'yandex_direct';
  if (['vk', 'vkontakte'].includes(s)) return 'vk_ads';
  return source;
}

function detectPlatform(utmSource: string | undefined): string | null {
  if (!utmSource) return null;
  const s = utmSource.toLowerCase();
  if (['ya', 'ya_direct', 'ydirect', 'yandex_direct'].includes(s)) return 'yandex_direct';
  if (s.includes('yandex') || s.includes('direct')) return 'yandex_direct';
  if (s === 'vkontakte' || s.includes('vk')) return 'vk_ads';
  if (s.includes('google')) return 'google_ads';
  if (s.includes('facebook') || s.includes('fb')) return 'facebook_ads';
  return null;
}

function getReplaySessionId(data: TrackingClickBody): string | null {
  const replaySessionId = data.replay_session_id;
  if (typeof replaySessionId === 'string' && replaySessionId.trim()) return replaySessionId.trim();

  const legacySessionId = data.posthog_distinct_id;
  if (typeof legacySessionId === 'string' && legacySessionId.trim()) return legacySessionId.trim();

  const sessionId = data.session_id;
  if (typeof sessionId === 'string' && sessionId.trim()) return sessionId.trim();

  return null;
}

function toUUID(trackingId: string): string {
  try {
    // Validate if already a UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trackingId)) return trackingId;
  } catch { /* not a uuid */ }
  // Generate deterministic UUID v5 from short ID
  return crypto.createHash('md5').update(`tracking:${trackingId}`).digest('hex')
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

const LOCATIONS: Record<string, { name: string; shop_id: string }> = {
  studio1: { name: 'Своё Фото (Соборный)', shop_id: 'b23f22ad-ac9b-4d8f-829a-35f1d6640eeb' },
  studio2: { name: 'Своё Фото (2-ая Баррикадная)', shop_id: '77e856a9-3a5d-4e6f-b2ab-9b8d1b23651e' },
};

// ────── Routes ──────

router.post('/click', clickLimiter, async (req: Request, res: Response) => {
  if (!isTrackingClickBody(req.body)) { res.status(400).json({ success: false, error: 'No data provided' }); return; }
  const data = req.body;

  const trackingData = parseTrackingMetka(data.tracking || '');
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
  const ipPrefix = getIpPrefix(clientIp);
  const trackingId = data.tracking_id ? toUUID(data.tracking_id) : crypto.randomUUID();
  const utmSource = normalizeUtmSource(data.utm_source);
  const replaySessionId = getReplaySessionId(data);

  let clickId: number | undefined;
  try {
    const rows = await mpQuery<PurchaseInsertResult>(`
      INSERT INTO ad_clicks (
        tracking_id, visitor_id, fingerprint_visitor_id, session_id,
        tracking, tracking_referrer, tracking_pos,
        banner_id, keyword, search_phrase, campaign_id,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        ad_platform, referrer, user_agent, ip_address, device_fingerprint,
        landing_page, host, first_visit_id, device_is_mobile
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24, $25
      )
      ON CONFLICT (tracking_id) DO UPDATE SET
        fingerprint_visitor_id = COALESCE(ad_clicks.fingerprint_visitor_id, EXCLUDED.fingerprint_visitor_id),
        visitor_id = COALESCE(ad_clicks.visitor_id, EXCLUDED.visitor_id),
        device_fingerprint = COALESCE(ad_clicks.device_fingerprint, EXCLUDED.device_fingerprint),
        session_id = COALESCE(ad_clicks.session_id, EXCLUDED.session_id)
      RETURNING id
    `, [
      trackingId, data.visitor_id, data.fingerprint_visitor_id, replaySessionId,
      data.tracking, data.tracking_referrer, data.tracking_pos,
      trackingData.banner_id || (data.utm_content || '').replace('ad_', '') || null,
      trackingData.keyword || data.utm_term, trackingData.search_phrase, data.utm_campaign,
      utmSource, data.utm_medium, data.utm_campaign, data.utm_content, data.utm_term,
      trackingData.ad_platform || detectPlatform(utmSource),
      data.referrer, data.user_agent, ipPrefix, data.device_fingerprint,
      data.landing_page, data.host, data.first_visit_id, data.device_is_mobile ?? false,
    ]);

    clickId = rows[0]?.id;
    adClicksTotal.inc({
      platform: data.platform ?? detectPlatform(utmSource) ?? 'unknown',
      utm_source: utmSource || 'direct',
      status: 'ok',
    });
  } catch (err) {
    adClicksErrorsTotal.inc({ reason: 'db_insert' });
    log.error('ad_clicks insert failed', {
      error: err instanceof Error ? err.message : String(err),
      trackingId,
      utmSource,
    });
    res.status(500).json({ success: false, error: 'click_insert_failed' });
    return;
  }

  // Async visitor_session upsert via BullMQ — silent failures больше не теряются,
  // counters+retries дают видимость.
  enqueueVisitorSessionUpdate({
    visitor_id: data.visitor_id ?? null,
    fingerprint_visitor_id: data.fingerprint_visitor_id ?? null,
    replay_session_id: replaySessionId,
    device_fingerprint: data.device_fingerprint ?? null,
    tracking: data.tracking ?? null,
    utm_source: utmSource ?? null,
    utm_medium: data.utm_medium ?? null,
    utm_campaign: data.utm_campaign ?? null,
    utm_content: data.utm_content ?? null,
    utm_term: data.utm_term ?? null,
  }).catch((err) => {
    adClicksErrorsTotal.inc({ reason: 'enqueue' });
    log.error('visitor-session enqueue failed', { error: String(err) });
  });

  log.info('Click saved', { clickId, trackingId, utmSource });

  res.json({ success: true, click_id: clickId, tracking_id: trackingId });
});

router.get('/session/:tracking_id', async (req: Request, res: Response) => {
  const trackingId = req.params['tracking_id'];

  const rows = await mpQuery<AdClickSession>(`
    SELECT id, tracking_id, visitor_id, fingerprint_visitor_id,
           utm_source, utm_medium, utm_campaign, utm_content, utm_term,
           ad_platform, landing_page, clicked_at
    FROM ad_clicks WHERE tracking_id = $1 LIMIT 1
  `, [trackingId]);

  if (rows.length === 0) { res.status(404).json({ success: false, error: 'Session not found' }); return; }

  const r = rows[0];
  res.json({
    success: true,
    data: {
      click_id: r.id, tracking_id: r.tracking_id,
      visitor_id: r.visitor_id, fingerprint_visitor_id: r.fingerprint_visitor_id,
      utm_source: r.utm_source, utm_medium: r.utm_medium,
      utm_campaign: r.utm_campaign, utm_content: r.utm_content, utm_term: r.utm_term,
      ad_platform: r.ad_platform, landing_page: r.landing_page, clicked_at: r.clicked_at,
    },
  });
});

router.get('/stats', async (_req: Request, res: Response) => {
  const stats = await mpQuery<TrackingStatsRow>(`
    SELECT COUNT(*) AS total_clicks, COUNT(DISTINCT visitor_id) AS unique_visitors,
           COUNT(DISTINCT fingerprint_visitor_id) AS unique_fingerprints,
           COUNT(DISTINCT utm_source) AS sources_count
    FROM ad_clicks WHERE clicked_at >= NOW() - INTERVAL '7 days'
  `, []);

  const sources = await mpQuery<SourceClicksRow>(`
    SELECT utm_source AS source, COUNT(*) AS clicks FROM ad_clicks
    WHERE clicked_at >= NOW() - INTERVAL '7 days'
    GROUP BY utm_source ORDER BY clicks DESC LIMIT 10
  `, []);

  res.json({ success: true, period: '7 days', stats: stats[0], top_sources: sources });
});

router.post('/qr', async (req: Request, res: Response) => {
  const { location_id, fingerprint_visitor_id, tracking_id: rawTrackingId } = req.body;
  if (!location_id) { res.status(400).json({ success: false, error: 'location_id required' }); return; }

  const location = LOCATIONS[location_id] || {};
  const trackingId = crypto.createHash('md5').update(`qr:${rawTrackingId || crypto.randomUUID().slice(0, 8)}:${location_id}`).digest('hex')
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');

  // Insert touchpoint
  const metadata = JSON.stringify({ location_id, location_name: location.name, shop_id: location.shop_id, tracking_id: trackingId });
  const tpRows = await mpQuery<TouchpointInsertResult>(`
    INSERT INTO customer_touchpoints (
      fingerprint_visitor_id, touchpoint_type, channel, source, medium,
      landing_page, metadata, occurred_at
    ) VALUES ($1, 'qr_scan', 'offline', $2, 'qr_code', $3, $4, NOW())
    RETURNING id
  `, [fingerprint_visitor_id, `qr_${location_id}`, `https://svoefoto.ru/?qr=${location_id}`, metadata]);

  // Also insert into ad_clicks for compatibility
  await mpQuery(`
    INSERT INTO ad_clicks (tracking_id, fingerprint_visitor_id, utm_source, utm_medium, utm_campaign, ad_platform, landing_page)
    VALUES ($1, $2, $3, 'qr_code', $4, 'qr_offline', $5)
    ON CONFLICT (tracking_id) DO NOTHING
  `, [trackingId, fingerprint_visitor_id, `qr_${location_id}`, location.name, `https://svoefoto.ru/?qr=${location_id}`]);

  log.info('QR scan tracked', { location_id, fingerprint: fingerprint_visitor_id?.slice(0, 10) });
  res.json({ success: true, touchpoint_id: tpRows[0]?.id, tracking_id: trackingId, location });
});

router.get('/customer-journey/:fingerprint', async (req: Request, res: Response) => {
  const fp = req.params['fingerprint'];

  const [customer, clicks, touchpoints] = await Promise.all([
    mpQuery<CustomerJourneyCustomerRow>(`
      SELECT id, telegram_user_id, telegram_username, phone_normalized AS phone,
             bitrix24_contact_id, status, total_purchases, total_revenue
      FROM unified_customers WHERE fingerprint_visitor_id = $1
    `, [fp]),
    mpQuery<CustomerJourneyClickRow>(`
      SELECT tracking_id, utm_source, utm_campaign, ad_platform, landing_page, clicked_at
      FROM ad_clicks WHERE fingerprint_visitor_id = $1 ORDER BY clicked_at DESC LIMIT 20
    `, [fp]),
    mpQuery<CustomerJourneyTouchpointRow>(`
      SELECT touchpoint_type AS type, channel, source, occurred_at, metadata
      FROM customer_touchpoints WHERE fingerprint_visitor_id = $1 ORDER BY occurred_at DESC LIMIT 20
    `, [fp]),
  ]);

  const customerData = customer[0] || null;
  let purchases: CustomerJourneyPurchaseRow[] = [];
  if (customerData) {
    purchases = await mpQuery<CustomerJourneyPurchaseRow>(`
      SELECT source_id, amount, purchased_at, items_count, attribution_model
      FROM purchases WHERE customer_id = $1 ORDER BY purchased_at DESC LIMIT 20
    `, [customerData.id]);
  }

  res.json({
    success: true, fingerprint: fp, customer: customerData,
    journey: { clicks, touchpoints, purchases },
  });
});

router.get('/health', async (_req: Request, res: Response) => {
  await mpQuery('SELECT 1', []);
  res.json({ status: 'ok', database: 'connected' });
});

export default router;
