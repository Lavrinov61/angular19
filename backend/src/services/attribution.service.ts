/**
 * Attribution Service — замена Python bridge_api.py (:5052).
 *
 * Управляет атрибуцией рекламных кликов к конверсиям и покупкам.
 * Три критических метода вызываются другими Express-роутами напрямую
 * (без HTTP overhead), а также доступны через /api/bridge/*.
 */

import { mpQuery } from '../database/mp-db.js';

// Wrapper to match the db.query() call pattern used throughout this file
const db = { query: mpQuery };
import { createLogger } from '../utils/logger.js';
import crypto from 'node:crypto';
import {
  conversionsTotal,
  conversionsSkippedTotal,
  conversionAttributionWeightsTotal,
} from './metrics.service.js';
import type {
  AdClickAttribution, AdClickForAttribution,
  UnifiedCustomerPaymentLookup, UnifiedCustomerPhoneLookup,
  UnifiedCustomerMergeLookup, UnifiedCustomerPhoneResult, UnifiedCustomerLinkResult,
  FingerprintLookup,
  PurchaseInsertResult, TouchpointInsertResult, ConversionInsertResult,
  VisitorSessionLookup,
  AttributionOverview, PlatformAttributionRow,
  FunnelMetrics, FunnelRevenueMetrics, TopSourceRow, RoiGroupRow,
} from '../types/views/tracking-views.js';

const log = createLogger('attribution');

// ────── Types ──────

interface SavePaymentParams {
  bitrix24_deal_id?: string;
  bitrix24_contact_id?: string;
  telegram_user_id?: string;
  max_user_id?: string;
  phone?: string;
  fingerprint_visitor_id?: string;
  amount: number;
  services?: string[];
  source?: string;
  source_id?: string;
}

interface SavePaymentResult {
  customer_id: number;
  purchase_id: number | null;
  touchpoint_id: number | null;
  total_revenue: number;
  total_purchases: number;
  status: string;
  attribution: {
    click_id: number | null;
    campaign_id: string | null;
    utm_source: string | null;
    ad_platform: string | null;
    model: string;
    attribution_status: string;
  };
  duplicate: boolean;
}

interface TrackOrderEventParams {
  event_type: 'order_created' | 'order_abandoned' | 'payment_failed';
  order_id?: string;
  order_source?: string;
  amount?: number;
  fingerprint_visitor_id?: string;
  phone?: string;
  services?: string[];
  metadata?: Record<string, unknown>;
}

interface RegisterConversionParams {
  phone?: string;
  email?: string;
  fingerprint_visitor_id?: string;
  posthog_distinct_id?: string;
  conversion_type?: string;
  messenger_type?: string;
  bitrix24_contact_id?: string;
  bitrix24_deal_id?: string;
  conversion_value?: number;
  attribution_model?: string;
  telegram_user_id?: string;
  max_user_id?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  order_id?: string;
}

interface CheckPhoneResult {
  exists: boolean;
  customer_id?: number;
  phone?: string;
  status?: string;
  bitrix24_contact_id?: string;
}

interface LinkFingerprintResult {
  customer_id: number;
  fingerprint_visitor_id: string;
  telegram_user_id: string;
  first_utm_source: string | null;
  first_utm_campaign: string | null;
  status: string;
  has_attribution: boolean;
}

// ────── Helpers ──────

function hashPhone(phone: string): string {
  const normalized = phone.replace(/\D/g, '');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function hashEmail(email: string): string {
  return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('8') && digits.length === 11) {
    digits = '7' + digits.slice(1);
  }
  return digits;
}

const STATUS_PRIORITY: Record<string, number> = {
  client: 3,
  lead: 2,
  visitor: 1,
};

function bestStatus(a: string, b: string): string {
  return (STATUS_PRIORITY[a] ?? 0) >= (STATUS_PRIORITY[b] ?? 0) ? a : b;
}

// ────── Core Functions ──────

export async function savePayment(params: SavePaymentParams): Promise<SavePaymentResult> {
  const {
    bitrix24_deal_id,
    bitrix24_contact_id,
    telegram_user_id,
    max_user_id,
    phone: rawPhone,
    fingerprint_visitor_id,
    amount,
    services,
    source = 'chat_detection',
    source_id,
  } = params;

  const phone = rawPhone ? normalizePhone(rawPhone) : undefined;

  // 1. Find or create unified_customer
  let customerId: number;
  let totalRevenue: number;
  let totalPurchases: number;
  let status: string;
  let customerFingerprint = fingerprint_visitor_id;

  const existing = await db.query<UnifiedCustomerPaymentLookup>(`
    SELECT id, fingerprint_visitor_id, total_revenue, total_purchases,
           first_click_id, first_utm_source, first_utm_campaign, status
    FROM unified_customers
    WHERE bitrix24_contact_id = $1
       OR (telegram_user_id = $2 AND $2 IS NOT NULL)
       OR (max_user_id = $3 AND $3 IS NOT NULL)
       OR (phone = $4 AND $4 IS NOT NULL)
       OR (fingerprint_visitor_id = $5 AND $5 IS NOT NULL)
    LIMIT 1
  `, [bitrix24_contact_id, telegram_user_id, max_user_id, phone, fingerprint_visitor_id]);

  if (existing.length > 0) {
    const c = existing[0];
    customerId = c.id;
    totalRevenue = Number(c.total_revenue || 0) + amount;
    totalPurchases = (c.total_purchases || 0) + 1;
    status = 'client';
    customerFingerprint = customerFingerprint || c.fingerprint_visitor_id || undefined;

    await db.query(`
      UPDATE unified_customers
      SET total_revenue = $1, total_purchases = $2, status = 'client',
          telegram_user_id = COALESCE(telegram_user_id, $3),
          max_user_id = COALESCE(max_user_id, $4),
          phone = COALESCE(phone, $5),
          bitrix24_contact_id = COALESCE(bitrix24_contact_id, $6),
          updated_at = NOW()
      WHERE id = $7
    `, [totalRevenue, totalPurchases, telegram_user_id, max_user_id, phone, bitrix24_contact_id, customerId]);
  } else {
    totalRevenue = amount;
    totalPurchases = 1;
    status = 'client';
    const rows = await db.query<PurchaseInsertResult>(`
      INSERT INTO unified_customers (
        bitrix24_contact_id, telegram_user_id, max_user_id, phone,
        fingerprint_visitor_id, status, total_revenue, total_purchases, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, 'client', $6, 1, NOW(), NOW())
      RETURNING id
    `, [bitrix24_contact_id, telegram_user_id, max_user_id, phone, fingerprint_visitor_id, amount]);
    customerId = rows[0].id;
  }

  // 2. Fingerprint fallback chain (for attribution)
  if (!customerFingerprint) {
    // a) customer_fingerprints table
    const fp1 = await db.query<FingerprintLookup>(
      'SELECT fingerprint_visitor_id FROM customer_fingerprints WHERE customer_id = $1 LIMIT 1',
      [customerId],
    );
    if (fp1.length > 0) customerFingerprint = fp1[0].fingerprint_visitor_id;
  }
  if (!customerFingerprint && phone) {
    // b) visitor_sessions by phone_hash
    const phoneHash = hashPhone(phone);
    const fp2 = await db.query<FingerprintLookup>(`
      SELECT fingerprint_visitor_id FROM visitor_sessions
      WHERE phone_hash = $1 AND fingerprint_visitor_id IS NOT NULL
        AND first_visit_at > NOW() - INTERVAL '7 days'
      ORDER BY first_visit_at DESC LIMIT 1
    `, [phoneHash]);
    if (fp2.length > 0) customerFingerprint = fp2[0].fingerprint_visitor_id;
  }
  if (!customerFingerprint && telegram_user_id) {
    // c) via another unified_customers by telegram_user_id
    const fp3 = await db.query<FingerprintLookup>(`
      SELECT vs.fingerprint_visitor_id FROM visitor_sessions vs
      JOIN unified_customers uc ON uc.fingerprint_visitor_id = vs.fingerprint_visitor_id
      WHERE uc.telegram_user_id = $1 AND vs.fingerprint_visitor_id IS NOT NULL
      ORDER BY vs.first_visit_at DESC LIMIT 1
    `, [telegram_user_id]);
    if (fp3.length > 0) customerFingerprint = fp3[0].fingerprint_visitor_id;
  }

  // 3. Find last ad click
  let clickId: number | null = null;
  let campaignId: string | null = null;
  let utmSource: string | null = null;
  let adPlatform: string | null = null;
  let attributionStatus = 'unknown';

  if (customerFingerprint) {
    const clicks = await db.query<AdClickAttribution>(`
      SELECT id, campaign_id, utm_source, ad_platform FROM ad_clicks
      WHERE fingerprint_visitor_id = $1 ORDER BY clicked_at DESC LIMIT 1
    `, [customerFingerprint]);

    if (clicks.length > 0) {
      clickId = clicks[0].id;
      campaignId = clicks[0].campaign_id;
      utmSource = clicks[0].utm_source;
      adPlatform = clicks[0].ad_platform;
      attributionStatus = 'attributed';
    } else {
      attributionStatus = 'site_visitor_no_ads';
    }
  } else if (telegram_user_id || max_user_id) {
    attributionStatus = 'no_site_visit';
  }

  // Fallback: get ad_platform from first_click_id
  if (!adPlatform && existing.length > 0 && existing[0].first_click_id) {
    const fc = await db.query<Pick<AdClickAttribution, 'ad_platform'>>('SELECT ad_platform FROM ad_clicks WHERE id = $1', [existing[0].first_click_id]);
    if (fc.length > 0) adPlatform = fc[0].ad_platform;
  }

  // 4. Insert purchase
  const itemsJson = services ? JSON.stringify(services) : null;
  const purchaseSourceId = source_id || `${source}_${customerId}_${Date.now()}`;

  const purchaseRows = await db.query<PurchaseInsertResult>(`
    INSERT INTO purchases (
      customer_id, fingerprint_visitor_id, source, source_id,
      amount, items, items_count,
      attributed_click_id, attributed_campaign_id, attribution_model,
      attribution_status, purchased_at, synced_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'last_touch', $10, NOW(), NOW())
    ON CONFLICT ON CONSTRAINT purchases_source_unique DO NOTHING
    RETURNING id
  `, [
    customerId, customerFingerprint, source, purchaseSourceId,
    amount, itemsJson, services?.length ?? 0,
    clickId, campaignId, attributionStatus,
  ]);

  let purchaseId: number | null = null;
  let touchpointId: number | null = null;
  let duplicate = false;

  if (purchaseRows.length > 0) {
    purchaseId = purchaseRows[0].id;

    // 5. Insert touchpoint
    const tpRows = await db.query<TouchpointInsertResult>(`
      INSERT INTO customer_touchpoints (
        customer_id, fingerprint_visitor_id, touchpoint_type, source,
        channel, purchase_id, click_id, metadata, occurred_at
      ) VALUES ($1, $2, 'purchase', $3, 'chat', $4, $5, $6, NOW())
      RETURNING id
    `, [customerId, customerFingerprint, source, purchaseId, clickId, JSON.stringify({
      amount, services, attribution_status: attributionStatus,
      bitrix24_deal_id, bitrix24_contact_id,
    })]);
    if (tpRows.length > 0) touchpointId = tpRows[0].id;

    // 6. Update conversion value
    if (customerFingerprint) {
      await db.query(`
        UPDATE conversions SET conversion_value = COALESCE(conversion_value, 0) + $1
        WHERE fingerprint_visitor_id = $2 AND conversion_value IS NULL
      `, [amount, customerFingerprint]);
    }
  } else {
    duplicate = true;
    const dup = await db.query<PurchaseInsertResult>('SELECT id FROM purchases WHERE source = $1 AND source_id = $2', [source, purchaseSourceId]);
    if (dup.length > 0) purchaseId = dup[0].id;
  }

  log.info('Payment saved', {
    customerId, purchaseId, amount, attributionStatus, duplicate,
    utmSource, adPlatform,
  });

  return {
    customer_id: customerId,
    purchase_id: purchaseId,
    touchpoint_id: touchpointId,
    total_revenue: totalRevenue,
    total_purchases: totalPurchases,
    status,
    attribution: {
      click_id: clickId,
      campaign_id: campaignId,
      utm_source: utmSource,
      ad_platform: adPlatform,
      model: 'last_touch',
      attribution_status: attributionStatus,
    },
    duplicate,
  };
}

export async function trackOrderEvent(params: TrackOrderEventParams): Promise<{ touchpoint_id: number | null; customer_id: number | null }> {
  const {
    event_type,
    order_id,
    order_source = 'unknown',
    amount = 0,
    fingerprint_visitor_id,
    phone: rawPhone,
    services,
    metadata,
  } = params;

  const phone = rawPhone ? normalizePhone(rawPhone) : undefined;

  // Find customer
  let customerId: number | null = null;

  if (fingerprint_visitor_id) {
    const rows = await db.query<Pick<UnifiedCustomerPaymentLookup, 'id'>>('SELECT id FROM unified_customers WHERE fingerprint_visitor_id = $1 LIMIT 1', [fingerprint_visitor_id]);
    if (rows.length > 0) customerId = rows[0].id;
  }
  if (!customerId && phone) {
    const rows = await db.query<Pick<UnifiedCustomerPaymentLookup, 'id'>>('SELECT id FROM unified_customers WHERE phone = $1 LIMIT 1', [phone]);
    if (rows.length > 0) customerId = rows[0].id;
  }

  // Insert touchpoint
  const tpMeta = JSON.stringify({ order_id, amount, order_source, services, ...metadata });
  const tpRows = await db.query<TouchpointInsertResult>(`
    INSERT INTO customer_touchpoints (
      customer_id, fingerprint_visitor_id, touchpoint_type,
      source, channel, metadata, occurred_at
    ) VALUES ($1, $2, $3, $4, 'online', $5, NOW())
    RETURNING id
  `, [customerId, fingerprint_visitor_id, event_type, order_source, tpMeta]);

  const touchpointId = tpRows.length > 0 ? tpRows[0].id : null;

  log.info('Order event tracked', { event_type, order_id, customerId, touchpointId });

  return { touchpoint_id: touchpointId, customer_id: customerId };
}

export async function registerConversion(params: RegisterConversionParams): Promise<{
  conversion_id: number;
  visitor_session_id: string | null;
  attribution: { model: string; total_touches: number };
  utm_for_bitrix24: Record<string, string | null>;
}> {
  const {
    phone: rawPhone,
    email,
    fingerprint_visitor_id,
    posthog_distinct_id,
    conversion_type = 'messenger_contact',
    messenger_type,
    bitrix24_contact_id,
    bitrix24_deal_id,
    conversion_value,
    attribution_model = 'default',
    telegram_user_id,
    max_user_id,
    utm_source: overrideUtmSource,
    utm_medium: overrideUtmMedium,
    utm_campaign: overrideUtmCampaign,
    utm_content: overrideUtmContent,
    utm_term: overrideUtmTerm,
    order_id,
  } = params;

  const phone = rawPhone ? normalizePhone(rawPhone) : undefined;
  const phoneHash = phone ? hashPhone(phone) : null;
  const emailHash = email ? hashEmail(email) : null;

  if (!phone && !fingerprint_visitor_id && !order_id) {
    conversionsSkippedTotal.inc({ reason: 'no_identifier' });
    log.info('conversion skipped: no_identifier', { conversion_type, messenger_type });
    return {
      conversion_id: 0,
      visitor_session_id: null,
      attribution: { model: attribution_model, total_touches: 0 },
      utm_for_bitrix24: {
        utm_source: null, utm_medium: null, utm_campaign: null,
        utm_content: null, utm_term: null,
      },
    };
  }

  try {

  if (order_id) {
    const existing = await db.query<ConversionInsertResult>(
      `SELECT id FROM conversions WHERE conversion_type = $1 AND order_id = $2 LIMIT 1`,
      [conversion_type, order_id],
    );
    if (existing.length > 0) {
      conversionsSkippedTotal.inc({ reason: 'already_attributed' });
      log.info('conversion skipped: already_attributed', { order_id, conversion_type, conversionId: existing[0].id });
      return {
        conversion_id: existing[0].id,
        visitor_session_id: null,
        attribution: { model: attribution_model, total_touches: 0 },
        utm_for_bitrix24: {
          utm_source: null, utm_medium: null, utm_campaign: null,
          utm_content: null, utm_term: null,
        },
      };
    }
  }

  // 1. Resolve visitor session
  let sessionId: string | null = null;

  if (fingerprint_visitor_id || phoneHash) {
    const sessions = await db.query<Pick<VisitorSessionLookup, 'id'>>(`
      SELECT id FROM visitor_sessions
      WHERE fingerprint_visitor_id = $1
         OR ($2 IS NOT NULL AND phone_hash = $2)
      LIMIT 1
    `, [fingerprint_visitor_id, phoneHash]);

    if (sessions.length > 0) {
      sessionId = sessions[0].id;
      // Update session with conversion
      await db.query(`
        UPDATE visitor_sessions SET
          phone_hash = COALESCE(phone_hash, $1),
          email_hash = COALESCE(email_hash, $2),
          converted_at = COALESCE(converted_at, NOW()),
          updated_at = NOW()
        WHERE id = $3
      `, [phoneHash, emailHash, sessionId]);
    } else if (fingerprint_visitor_id) {
      // Create new session
      const newSession = await db.query<Pick<VisitorSessionLookup, 'id'>>(`
        INSERT INTO visitor_sessions (
          fingerprint_visitor_id, posthog_distinct_id,
          phone_hash, email_hash, converted_at
        ) VALUES ($1, $2, $3, $4, NOW())
        RETURNING id
      `, [fingerprint_visitor_id, posthog_distinct_id, phoneHash, emailHash]);
      if (newSession.length > 0) sessionId = newSession[0].id;
    }
  }

  // 2. Get all clicks for attribution
  let clicks: AdClickForAttribution[] = [];

  if (fingerprint_visitor_id) {
    clicks = await db.query(`
      SELECT id, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
             ad_platform, clicked_at
      FROM ad_clicks WHERE fingerprint_visitor_id = $1 ORDER BY clicked_at ASC
    `, [fingerprint_visitor_id]);
  }

  // 3. Simple last-touch attribution (replaces complex Python engine)
  let primaryUtmSource: string | null = null;
  let primaryUtmMedium: string | null = null;
  let primaryUtmCampaign: string | null = null;
  let primaryUtmContent: string | null = null;
  let primaryUtmTerm: string | null = null;

  if (clicks.length > 0) {
    const lastClick = clicks[clicks.length - 1];
    primaryUtmSource = lastClick.utm_source;
    primaryUtmMedium = lastClick.utm_medium;
    primaryUtmCampaign = lastClick.utm_campaign;
    primaryUtmContent = lastClick.utm_content;
    primaryUtmTerm = lastClick.utm_term;
  } else if (overrideUtmSource || overrideUtmCampaign) {
    primaryUtmSource = overrideUtmSource ?? null;
    primaryUtmMedium = overrideUtmMedium ?? null;
    primaryUtmCampaign = overrideUtmCampaign ?? null;
    primaryUtmContent = overrideUtmContent ?? null;
    primaryUtmTerm = overrideUtmTerm ?? null;
  } else if (messenger_type) {
    primaryUtmSource = messenger_type;
    primaryUtmMedium = 'messenger';
  }

  // 4. Insert conversion
  const conversionRows = await db.query<ConversionInsertResult>(`
    INSERT INTO conversions (
      visitor_session_id, fingerprint_visitor_id, posthog_distinct_id,
      bitrix24_contact_id, bitrix24_deal_id,
      conversion_type, messenger_type,
      attribution_data,
      primary_utm_source, primary_utm_medium, primary_utm_campaign,
      primary_utm_content, primary_utm_term,
      attribution_model, conversion_value, confidence, order_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    RETURNING id
  `, [
    sessionId, fingerprint_visitor_id, posthog_distinct_id,
    bitrix24_contact_id, bitrix24_deal_id,
    conversion_type, messenger_type,
    JSON.stringify({ touches: clicks.length, model: attribution_model }),
    primaryUtmSource, primaryUtmMedium, primaryUtmCampaign,
    primaryUtmContent, primaryUtmTerm,
    attribution_model, conversion_value, clicks.length > 0 ? 0.9 : 0.3,
    order_id ?? null,
  ]);

  const conversionId = conversionRows[0].id;
  conversionsTotal.inc({ type: conversion_type, channel: messenger_type ?? 'web' });

  // 5. Insert attribution weights
  for (let i = 0; i < clicks.length; i++) {
    const click = clicks[i];
    const weight = clicks.length === 1 ? 1.0 : (i === clicks.length - 1 ? 0.5 : 0.5 / (clicks.length - 1));
    const timeDiff = (Date.now() - new Date(click.clicked_at).getTime()) / 86400000;
    const position = i === 0 ? 'first' : i === clicks.length - 1 ? 'last' : 'middle';
    await db.query(`
      INSERT INTO click_attribution_weights (conversion_id, click_id, weight, touch_position, time_to_conversion)
      VALUES ($1, $2, $3, $4, $5)
    `, [conversionId, click.id, weight, position, timeDiff]);
    conversionAttributionWeightsTotal.inc({ position });
  }

  // 6. Upsert unified_customer
  if (fingerprint_visitor_id && clicks.length > 0) {
    const firstClick = clicks[0];
    const lastClick = clicks[clicks.length - 1];
    await db.query(`
      INSERT INTO unified_customers (
        fingerprint_visitor_id,
        first_click_id, first_utm_source, first_utm_campaign,
        last_click_id, last_utm_source, last_utm_campaign,
        status, first_visit_at, last_visit_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'lead', NOW(), NOW())
      ON CONFLICT (fingerprint_visitor_id) DO UPDATE SET
        first_click_id = COALESCE(unified_customers.first_click_id, EXCLUDED.first_click_id),
        first_utm_source = COALESCE(unified_customers.first_utm_source, EXCLUDED.first_utm_source),
        first_utm_campaign = COALESCE(unified_customers.first_utm_campaign, EXCLUDED.first_utm_campaign),
        last_click_id = EXCLUDED.last_click_id,
        last_utm_source = EXCLUDED.last_utm_source,
        last_utm_campaign = EXCLUDED.last_utm_campaign,
        last_visit_at = NOW(), updated_at = NOW()
      RETURNING id
    `, [fingerprint_visitor_id, firstClick.id, firstClick.utm_source, firstClick.utm_campaign,
      lastClick.id, lastClick.utm_source, lastClick.utm_campaign]);
  }

  // 7. Update messenger-specific field
  if (telegram_user_id && fingerprint_visitor_id) {
    await db.query('UPDATE unified_customers SET telegram_user_id = $1 WHERE fingerprint_visitor_id = $2 AND telegram_user_id IS NULL',
      [telegram_user_id, fingerprint_visitor_id]);
  }
  if (max_user_id && fingerprint_visitor_id) {
    await db.query('UPDATE unified_customers SET max_user_id = $1 WHERE fingerprint_visitor_id = $2 AND max_user_id IS NULL',
      [max_user_id, fingerprint_visitor_id]);
  }

  log.info('Conversion registered', { conversionId, conversion_type, touches: clicks.length, primaryUtmSource });

  return {
    conversion_id: conversionId,
    visitor_session_id: sessionId,
    attribution: { model: attribution_model, total_touches: clicks.length },
    utm_for_bitrix24: {
      utm_source: primaryUtmSource,
      utm_medium: primaryUtmMedium,
      utm_campaign: primaryUtmCampaign,
      utm_content: primaryUtmContent,
      utm_term: primaryUtmTerm,
    },
  };
  } catch (err) {
    conversionsSkippedTotal.inc({ reason: 'exception' });
    log.error('registerConversion failed', { error: String(err), conversion_type, order_id });
    throw err;
  }
}

// ────── Secondary endpoints ──────

export async function checkPhone(telegramUserId: string): Promise<CheckPhoneResult> {
  const rows = await db.query<UnifiedCustomerPhoneLookup>(`
    SELECT id, phone, status, bitrix24_contact_id FROM unified_customers WHERE telegram_user_id = $1
  `, [telegramUserId]);

  if (rows.length === 0) return { exists: false };

  return {
    exists: true,
    customer_id: rows[0].id,
    phone: rows[0].phone ?? undefined,
    status: rows[0].status,
    bitrix24_contact_id: rows[0].bitrix24_contact_id ?? undefined,
  };
}

export async function linkFingerprint(fingerprintVisitorId: string, telegramUserId: string): Promise<LinkFingerprintResult> {
  // Find last ad click for fingerprint
  const clicks = await db.query<Pick<AdClickAttribution, 'id' | 'utm_source'> & { utm_campaign: string | null; utm_content: string | null }>(`
    SELECT id, utm_source, utm_campaign, utm_content FROM ad_clicks
    WHERE fingerprint_visitor_id = $1 ORDER BY clicked_at DESC LIMIT 1
  `, [fingerprintVisitorId]);

  const click = clicks.length > 0 ? clicks[0] : null;

  const rows = await db.query<UnifiedCustomerLinkResult>(`
    INSERT INTO unified_customers (
      fingerprint_visitor_id, telegram_user_id,
      first_click_id, first_utm_source, first_utm_campaign,
      last_click_id, last_utm_source, last_utm_campaign,
      status, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $3, $4, $5, 'lead', NOW(), NOW())
    ON CONFLICT (telegram_user_id) DO UPDATE SET
      fingerprint_visitor_id = COALESCE(unified_customers.fingerprint_visitor_id, EXCLUDED.fingerprint_visitor_id),
      first_click_id = COALESCE(unified_customers.first_click_id, EXCLUDED.first_click_id),
      first_utm_source = COALESCE(unified_customers.first_utm_source, EXCLUDED.first_utm_source),
      first_utm_campaign = COALESCE(unified_customers.first_utm_campaign, EXCLUDED.first_utm_campaign),
      last_click_id = EXCLUDED.last_click_id,
      last_utm_source = EXCLUDED.last_utm_source,
      last_utm_campaign = EXCLUDED.last_utm_campaign,
      status = CASE WHEN unified_customers.status = 'visitor' THEN 'lead' ELSE unified_customers.status END,
      updated_at = NOW()
    RETURNING id, fingerprint_visitor_id, telegram_user_id, first_utm_source, first_utm_campaign, status
  `, [fingerprintVisitorId, telegramUserId, click?.id ?? null, click?.utm_source ?? null, click?.utm_campaign ?? null]);

  const r = rows[0];
  return {
    customer_id: r.id,
    fingerprint_visitor_id: r.fingerprint_visitor_id,
    telegram_user_id: r.telegram_user_id,
    first_utm_source: r.first_utm_source,
    first_utm_campaign: r.first_utm_campaign,
    status: r.status,
    has_attribution: click !== null,
  };
}

export async function savePhoneFromMessenger(
  messengerUserId: string,
  messengerField: 'telegram_user_id' | 'max_user_id',
  rawPhone: string,
  bitrix24ContactId?: string,
): Promise<{
  customer_id: number; phone: string; status: string;
  bitrix24_contact_id: string | null; total_revenue: number;
  touchpoint_id: number | null; merged_customers: number;
}> {
  const phone = normalizePhone(rawPhone);
  const channel = messengerField === 'telegram_user_id' ? 'telegram' : 'max';

  // Find by phone (no messenger id)
  const phoneCustomer = await db.query<UnifiedCustomerMergeLookup>(`
    SELECT id, telegram_user_id, max_user_id, fingerprint_visitor_id,
           total_revenue, total_purchases, status
    FROM unified_customers WHERE phone = $1 AND ${messengerField} IS NULL LIMIT 1
  `, [phone]);

  // Find by messenger id
  const messengerCustomer = await db.query<Pick<UnifiedCustomerMergeLookup, 'id' | 'fingerprint_visitor_id' | 'total_revenue' | 'total_purchases' | 'status'> & { phone: string | null }>(`
    SELECT id, phone, fingerprint_visitor_id, total_revenue, total_purchases, status
    FROM unified_customers WHERE ${messengerField} = $1 LIMIT 1
  `, [messengerUserId]);

  let customerId: number;
  let customerPhone: string;
  let customerStatus: string;
  let customerBitrix: string | null = null;
  let customerRevenue: number;
  let mergedCustomers = 0;

  if (phoneCustomer.length > 0 && messengerCustomer.length > 0) {
    // Merge: determine target
    const pc = phoneCustomer[0];
    const mc = messengerCustomer[0];

    // If phone customer has telegram_user_id and we're adding max, merge INTO phone customer
    const mergeIntoPhone = messengerField === 'max_user_id' && pc.telegram_user_id;
    const targetId = mergeIntoPhone ? pc.id : mc.id;
    const deleteId = mergeIntoPhone ? mc.id : pc.id;

    const mergedRevenue = Number(pc.total_revenue || 0) + Number(mc.total_revenue || 0);
    const mergedPurchases = (pc.total_purchases || 0) + (mc.total_purchases || 0);
    const mergedStatus = bestStatus(pc.status, mc.status);
    const mergedFingerprint = mc.fingerprint_visitor_id || pc.fingerprint_visitor_id;

    const updated = await db.query<UnifiedCustomerPhoneResult>(`
      UPDATE unified_customers
      SET phone = $1, ${messengerField} = COALESCE(${messengerField}, $2),
          fingerprint_visitor_id = COALESCE(fingerprint_visitor_id, $3),
          total_revenue = $4, total_purchases = $5, status = $6,
          bitrix24_contact_id = COALESCE(bitrix24_contact_id, $7), updated_at = NOW()
      WHERE id = $8
      RETURNING id, phone, status, bitrix24_contact_id, total_revenue
    `, [phone, messengerUserId, mergedFingerprint, mergedRevenue, mergedPurchases, mergedStatus,
      bitrix24ContactId, targetId]);

    // Transfer purchases and delete duplicate
    await db.query('UPDATE purchases SET customer_id = $1 WHERE customer_id = $2', [targetId, deleteId]);
    await db.query('DELETE FROM unified_customers WHERE id = $1', [deleteId]);

    const u = updated[0];
    customerId = u.id;
    customerPhone = u.phone;
    customerStatus = u.status;
    customerBitrix = u.bitrix24_contact_id;
    customerRevenue = Number(u.total_revenue || 0);
    mergedCustomers = 1;
  } else if (messengerCustomer.length > 0) {
    // Update existing messenger customer with phone
    const updated = await db.query<UnifiedCustomerPhoneResult>(`
      UPDATE unified_customers SET phone = $1, bitrix24_contact_id = COALESCE(bitrix24_contact_id, $2), updated_at = NOW()
      WHERE id = $3 RETURNING id, phone, status, bitrix24_contact_id, total_revenue
    `, [phone, bitrix24ContactId, messengerCustomer[0].id]);

    const u = updated[0];
    customerId = u.id;
    customerPhone = u.phone;
    customerStatus = u.status;
    customerBitrix = u.bitrix24_contact_id;
    customerRevenue = Number(u.total_revenue || 0);
  } else {
    // Create new
    const created = await db.query<UnifiedCustomerPhoneResult>(`
      INSERT INTO unified_customers (${messengerField}, phone, bitrix24_contact_id, status, updated_at)
      VALUES ($1, $2, $3, 'lead', NOW())
      RETURNING id, phone, status, bitrix24_contact_id, total_revenue
    `, [messengerUserId, phone, bitrix24ContactId]);

    const c = created[0];
    customerId = c.id;
    customerPhone = c.phone;
    customerStatus = c.status;
    customerBitrix = c.bitrix24_contact_id;
    customerRevenue = Number(c.total_revenue || 0);
  }

  // Insert touchpoint
  const tpRows = await db.query<TouchpointInsertResult>(`
    INSERT INTO customer_touchpoints (
      customer_id, touchpoint_type, channel, source, metadata, occurred_at
    ) VALUES ($1, 'phone_shared', $2, $3, $4, NOW())
    RETURNING id
  `, [customerId, channel, `${channel}_bot`, JSON.stringify({ phone, merged: mergedCustomers > 0 })]);

  return {
    customer_id: customerId,
    phone: customerPhone,
    status: customerStatus,
    bitrix24_contact_id: customerBitrix,
    total_revenue: customerRevenue,
    touchpoint_id: tpRows.length > 0 ? tpRows[0].id : null,
    merged_customers: mergedCustomers,
  };
}

// ────── Analytics endpoints ──────

export async function getAttributionStats(days: number): Promise<{ overview: AttributionOverview; by_platform: PlatformAttributionRow[] }> {
  const [overview] = await Promise.all([
    db.query<AttributionOverview>(`
      SELECT
        COUNT(*) AS total_purchases,
        COUNT(*) FILTER (WHERE attribution_status = 'attributed') AS attributed_purchases,
        COALESCE(SUM(amount), 0) AS total_revenue,
        COALESCE(SUM(amount) FILTER (WHERE attribution_status = 'attributed'), 0) AS attributed_revenue
      FROM purchases WHERE purchased_at >= NOW() - INTERVAL '1 day' * $1
    `, [days]),
  ]);

  const byPlatform = await db.query<PlatformAttributionRow>(`
    SELECT ac.ad_platform, COUNT(DISTINCT p.id) AS purchases, COALESCE(SUM(p.amount), 0) AS revenue
    FROM purchases p JOIN ad_clicks ac ON ac.id = p.attributed_click_id
    WHERE p.purchased_at >= NOW() - INTERVAL '1 day' * $1 AND p.attribution_status = 'attributed'
    GROUP BY ac.ad_platform ORDER BY revenue DESC
  `, [days]);

  return {
    overview: overview[0] ?? { total_purchases: 0, attributed_purchases: 0, total_revenue: 0, attributed_revenue: 0 },
    by_platform: byPlatform,
  };
}

export async function getDashboardMetrics(days: number): Promise<{ funnel: { clicks: number; conversions: number; purchases: number; revenue: number }; top_sources: TopSourceRow[] }> {
  const [clicksRow, conversionsRow, purchasesRow] = await Promise.all([
    db.query<FunnelMetrics>('SELECT COUNT(*) AS total FROM ad_clicks WHERE clicked_at >= NOW() - INTERVAL \'1 day\' * $1', [days]),
    db.query<FunnelMetrics>('SELECT COUNT(*) AS total FROM conversions WHERE created_at >= NOW() - INTERVAL \'1 day\' * $1', [days]),
    db.query<FunnelRevenueMetrics>('SELECT COUNT(*) AS total, COALESCE(SUM(amount), 0) AS revenue FROM purchases WHERE purchased_at >= NOW() - INTERVAL \'1 day\' * $1', [days]),
  ]);

  const topSources = await db.query<TopSourceRow>(`
    SELECT utm_source, COUNT(*) AS clicks FROM ad_clicks
    WHERE clicked_at >= NOW() - INTERVAL '1 day' * $1 AND utm_source IS NOT NULL
    GROUP BY utm_source ORDER BY clicks DESC LIMIT 10
  `, [days]);

  return {
    funnel: {
      clicks: Number(clicksRow[0]?.total ?? 0),
      conversions: Number(conversionsRow[0]?.total ?? 0),
      purchases: Number(purchasesRow[0]?.total ?? 0),
      revenue: Number(purchasesRow[0]?.revenue ?? 0),
    },
    top_sources: topSources,
  };
}

export async function getRoiReport(days: number, groupBy: string): Promise<RoiGroupRow[]> {
  const groupCol = groupBy === 'campaign' ? 'ac.utm_campaign'
    : groupBy === 'source' ? 'ac.utm_source' : 'ac.ad_platform';

  return db.query(`
    SELECT ${groupCol} AS group_name,
      COUNT(DISTINCT p.id) AS purchases,
      COALESCE(SUM(p.amount), 0) AS revenue,
      COALESCE(SUM(acm.cost), 0) AS cost
    FROM purchases p
    LEFT JOIN ad_clicks ac ON ac.id = p.attributed_click_id
    LEFT JOIN ad_campaign_metrics acm ON acm.campaign_id = ac.campaign_id
      AND acm.date >= (NOW() - INTERVAL '1 day' * $1)::date
    WHERE p.purchased_at >= NOW() - INTERVAL '1 day' * $1
      AND p.attribution_status = 'attributed'
    GROUP BY ${groupCol}
    ORDER BY revenue DESC
  `, [days]);
}
