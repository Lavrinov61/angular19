/**
 * Broadcast Campaign Routes — dispatch + funnel stats for Telegram broadcast campaigns.
 *
 * Mounted at /api/admin/campaigns (distinct namespace from the CRM marketing
 * campaigns.routes.ts at /api/campaigns — this owns the messenger send-engine).
 *
 * Protected at mount time (app.ts): authenticateToken + ipAllowlistAuditOnly +
 * requirePermission('settings:manage') — mirror of broadcast.routes.ts.
 *
 * POST /:id/dispatch — (optionally set broadcast_payload), activate, materialize audience.
 * GET  /:id/stats    — delivery funnel (GROUP BY status) + rates + ETA.
 */

import { Router, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import db from '../database/db.js';
import { logAudit } from '../services/audit.service.js';
import { createLogger } from '../utils/logger.js';
import {
  materializeRecipients,
  getCampaignStats,
  listBroadcastCampaigns,
  createBroadcastCampaign,
  getCampaignForEdit,
  updateBroadcastCampaign,
  getCampaignRecipients,
  setCampaignLive,
  previewAudience,
  getSegmentOptions,
  normalizeAudienceFilter,
  ALLOWED_CHANNELS,
  type CreateBroadcastInput,
  type BroadcastPayload,
  type AudienceFilter,
} from '../services/broadcast/campaign.service.js';

const router = Router();
const log = createLogger('broadcast-campaigns.routes');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Hard ceiling on a non-test (live) audience: a single launch cannot fan out beyond
// this many recipients without an explicit re-design. Guards against an accidental
// mass-send to the entire contact base (the live audience is materialized server-side).
const MAX_RECIPIENTS = 5000;

/** Body of POST /:id/dispatch — optional editorial content for the campaign. */
interface DispatchBody {
  payload?: unknown;
}

/** Body of POST / (create broadcast campaign). */
interface CreateBody {
  name?: unknown;
  payload?: unknown;
  allowedContactIds?: unknown;
  utm?: unknown;
  audienceFilter?: unknown;
}

/** Body of POST /audience-preview (segment filter only — count is computed server-side). */
interface AudiencePreviewBody {
  channel?: unknown;
  serviceSlugs?: unknown;
  recencyDays?: unknown;
}

/**
 * Derive a uniqueness-friendly utm_campaign slug from a campaign name (MAX auto-fallback).
 * lowercase → non-alphanumeric (lat/cyr) runs to '_' → trim edge '_' → cap ~40 chars.
 * Mirrors the manual slug an operator would otherwise type; prefixed 'max_' by the caller.
 */
function slugForUtmCampaign(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9а-я0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
}

/**
 * Coerce a raw audience-filter object into a validated AudienceFilter, mapping the service's
 * validation errors to a 400. The service's normalizeAudienceFilter is the single trust
 * boundary (enum channel, slug grammar, bounded recencyDays) — we never bind raw body values.
 */
function parseAudienceFilterOr400(raw: unknown): AudienceFilter {
  try {
    return normalizeAudienceFilter(raw);
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'некорректный фильтр аудитории';
    throw new AppError(400, detail);
  }
}

/**
 * Re-parse a STORED audience_filter (JSONB from the row) into a validated AudienceFilter,
 * NULL/garbage-safe. Returns null for a missing/invalid filter (→ legacy all-telegram).
 * Used by the dispatch guards; never throws (a tampered legacy row degrades to NULL).
 */
function parseAudienceFilterForGuard(raw: unknown): AudienceFilter | null {
  if (raw === null || raw === undefined) return null;
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  try {
    return normalizeAudienceFilter(obj);
  } catch {
    return null;
  }
}

/** Resolve the real target channel of a stored audience_filter (default 'telegram' when absent). */
function readAudienceChannel(raw: unknown): string {
  return parseAudienceFilterForGuard(raw)?.channel ?? 'telegram';
}

/** Loosely-typed UTM object from the request body (string fields validated below). */
interface RawUtm {
  source?: unknown;
  medium?: unknown;
  campaign?: unknown;
}

/** Status + channel + test_mode + materialize-projection for the launch CAS. */
interface CampaignGuardRow {
  id: string;
  channel: string | null;
  status: string | null;
  test_mode: boolean;
  audience_filter: unknown;
}

/** RETURNING projection of the launch CAS (only present when the flip succeeded). */
interface LaunchCasRow {
  id: string;
}

/** count(*) projection of the would-be live audience (pre-launch cap check). */
interface AudienceCountRow {
  cnt: number;
}

/** Raw editorial payload fields from the request body, before normalization. */
interface RawPayload {
  text?: unknown;
  mediaUrl?: unknown;
  landingUrl?: unknown;
  buttons?: unknown;
  serviceButtons?: unknown;
}

/** Raw URL-button cell from the request body. */
interface RawButton {
  text?: unknown;
  url?: unknown;
}

/**
 * Normalize the editorial object into a typed BroadcastPayload (mirrors the service's
 * parsePayload field selection). Drops unknown keys and malformed buttons; never throws —
 * a non-object payload is rejected by the caller before this runs.
 */
function normalizeBroadcastPayload(raw: object): BroadcastPayload {
  const p: RawPayload = raw;
  const out: BroadcastPayload = {};
  if (typeof p.text === 'string') out.text = p.text;
  if (typeof p.mediaUrl === 'string') out.mediaUrl = p.mediaUrl;
  if (typeof p.landingUrl === 'string') out.landingUrl = p.landingUrl;
  if (Array.isArray(p.buttons)) {
    const rows: Array<Array<{ text: string; url: string }>> = [];
    for (const row of p.buttons) {
      if (!Array.isArray(row)) continue;
      const cells: Array<{ text: string; url: string }> = [];
      for (const cell of row) {
        if (cell && typeof cell === 'object') {
          const b: RawButton = cell;
          if (typeof b.text === 'string' && typeof b.url === 'string') {
            cells.push({ text: b.text, url: b.url });
          }
        }
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length > 0) out.buttons = rows;
  }
  // Служебные кнопки-переключатели (addresses/notStudent). «Отписаться» всегда — не хранится.
  if (p.serviceButtons && typeof p.serviceButtons === 'object') {
    const s = p.serviceButtons as Record<string, unknown>;
    out.serviceButtons = {
      addresses: typeof s['addresses'] === 'boolean' ? s['addresses'] : true,
      notStudent: typeof s['notStudent'] === 'boolean' ? s['notStudent'] : true,
    };
  }
  return out;
}

/**
 * Parse + validate the create body into the typed service input.
 * test_mode is intentionally NOT read here — it is hard-forced server-side.
 */
function parseCreateBody(body: CreateBody): CreateBroadcastInput {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    throw new AppError(400, 'Не указано название кампании');
  }

  if (body.payload === undefined || body.payload === null || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
    throw new AppError(400, 'payload должен быть JSON-объектом {text?, mediaUrl?, landingUrl?, buttons?}');
  }
  // Normalize the editorial object at the HTTP boundary into a typed BroadcastPayload
  // (the same shape parsePayload re-derives at materialization time). Unknown extra keys
  // are dropped; this both documents the contract and avoids storing junk.
  const payload = normalizeBroadcastPayload(body.payload);

  let allowedContactIds: string[] | undefined;
  if (body.allowedContactIds !== undefined) {
    if (!Array.isArray(body.allowedContactIds)) {
      throw new AppError(400, 'allowedContactIds должен быть массивом UUID');
    }
    const ids: string[] = [];
    for (const raw of body.allowedContactIds) {
      if (typeof raw !== 'string' || !UUID_RE.test(raw)) {
        throw new AppError(400, 'allowedContactIds содержит некорректный UUID');
      }
      ids.push(raw);
    }
    allowedContactIds = ids;
  }

  let utm: CreateBroadcastInput['utm'];
  if (body.utm !== undefined) {
    if (body.utm === null || typeof body.utm !== 'object' || Array.isArray(body.utm)) {
      throw new AppError(400, 'utm должен быть объектом {source?, medium?, campaign?}');
    }
    const u: RawUtm = body.utm;
    utm = {
      source: typeof u.source === 'string' ? u.source : undefined,
      medium: typeof u.medium === 'string' ? u.medium : undefined,
      campaign: typeof u.campaign === 'string' ? u.campaign : undefined,
    };
  }

  // Optional audience segment. Absent/null → legacy all-telegram audience at materialization.
  let audienceFilter: AudienceFilter | undefined;
  if (body.audienceFilter !== undefined && body.audienceFilter !== null) {
    audienceFilter = parseAudienceFilterOr400(body.audienceFilter);
  }

  return { name, payload, allowedContactIds, utm, audienceFilter };
}

/**
 * GET / — list messenger broadcast campaigns + delivery funnel (newest first).
 * Only channel IN (telegram, max) campaigns (CRM flyer/email/sms never surface here).
 */
router.get('/', async (_req: AuthRequest, res: Response): Promise<void> => {
  const data = await listBroadcastCampaigns();
  res.json({ success: true, data });
});

/**
 * POST / — create a broadcast campaign (draft).
 *
 * test_mode is FORCED true server-side (createBroadcastCampaign) — it can never be set
 * from the body. The only path to a live (everyone) audience is POST /:id/go-live.
 *
 * INVARIANT (P1-1): the channel COLUMN is DERIVED from audience_filter.channel here, never
 * accepted as a separate body field — the column == audience_filter.channel for messenger
 * campaigns. v1 supports telegram|vk|max; any other segment channel is rejected at create.
 */
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const input = parseCreateBody((req.body ?? {}) as CreateBody);

  // Derive the persisted channel from the segment filter (single source of truth).
  // Absent/null filter → legacy telegram. Only telegram|vk|max can be created in v1.
  const segmentChannel = input.audienceFilter?.channel ?? 'telegram';
  if (segmentChannel !== 'telegram' && segmentChannel !== 'vk' && segmentChannel !== 'max') {
    throw new AppError(400, `Канал «${segmentChannel}» пока не поддерживается для рассылки. Доступны: Telegram, ВКонтакте, MAX.`);
  }
  const channel: 'telegram' | 'vk' | 'max' = segmentChannel;

  // utm attribution (MAX only): clicks are joined on (utm_source='max', utm_campaign), so MAX
  // MUST carry a non-empty utm_campaign or every click/«Интересовались» stat is 0 and the dup-
  // guard below is dead. The UI sends only utm.source='max' (no campaign field), so:
  //  - force utm_source='max' (default it when absent);
  //  - keep an operator-supplied utm_campaign as-is (dup → 400);
  //  - else auto-derive 'max_<slug(name)>' so attribution always has a discriminator.
  // The dup-guard then runs on the FINAL value (manual OR auto) — a collision → 400.
  if (channel === 'max') {
    const utm = { ...(input.utm ?? {}) };
    if (!utm.source) utm.source = 'max';
    if (!utm.campaign) {
      const slug = slugForUtmCampaign(input.name);
      utm.campaign = `max_${slug}`;
    }
    const clash = await db.queryOne<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM marketing_campaigns WHERE channel = 'max' AND utm_campaign = $1`,
      [utm.campaign],
    );
    if ((clash?.cnt ?? 0) > 0) {
      throw new AppError(400, 'utm_campaign занят другой кампанией MAX — задайте вручную уникальный.');
    }
    input.utm = utm;
  }

  const { id } = await createBroadcastCampaign(input, req.user?.id ?? null, channel);

  logAudit({
    userId: req.user?.id || undefined,
    userName: req.user?.display_name || req.user?.email || 'unknown',
    action: 'broadcast_campaign_create',
    entityType: 'marketing_campaign',
    entityId: id,
    details: {
      name: input.name,
      channel,
      allowedCount: input.allowedContactIds?.length ?? 0,
      testMode: true,
      audienceChannel: input.audienceFilter?.channel ?? null,
      audienceServices: input.audienceFilter?.serviceSlugs ?? null,
      audienceRecencyDays: input.audienceFilter?.recencyDays ?? null,
    },
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  log.info('broadcast campaign created', { campaignId: id, channel });
  res.json({ success: true, data: { id } });
});

/**
 * GET /:id — editable snapshot of a messenger campaign (for the edit composer):
 * name, channel, payload (text/media/buttons), segment, utm, test contacts.
 * Registered after the literal GET routes (/, /segments/options); '/:id' is single-segment
 * so it never shadows the two-segment /:id/recipients · /:id/stats handlers.
 */
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const data = await getCampaignForEdit(req.params['id'] ?? '');
  if (!data) {
    throw new AppError(404, 'Кампания не найдена');
  }
  res.json({ success: true, data });
});

/**
 * PATCH /:id — update a DRAFT campaign's content/segment. The service guards status='draft'
 * (active/sent campaigns are immutable → 409). Same channel invariant (P1-1: column derived
 * from audience_filter, never a body field) and MAX utm-attribution rules as create; the
 * MAX utm_campaign dup-guard EXCLUDES self so re-saving an unchanged campaign never 400s.
 */
router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = req.params['id'] ?? '';
  const input = parseCreateBody((req.body ?? {}) as CreateBody);

  const segmentChannel = input.audienceFilter?.channel ?? 'telegram';
  if (segmentChannel !== 'telegram' && segmentChannel !== 'vk' && segmentChannel !== 'max') {
    throw new AppError(400, `Канал «${segmentChannel}» пока не поддерживается для рассылки. Доступны: Telegram, ВКонтакте, MAX.`);
  }
  const channel: 'telegram' | 'vk' | 'max' = segmentChannel;

  if (channel === 'max') {
    const utm = { ...(input.utm ?? {}) };
    if (!utm.source) utm.source = 'max';
    if (!utm.campaign) utm.campaign = `max_${slugForUtmCampaign(input.name)}`;
    const clash = await db.queryOne<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM marketing_campaigns
       WHERE channel = 'max' AND utm_campaign = $1 AND id <> $2`,
      [utm.campaign, id],
    );
    if ((clash?.cnt ?? 0) > 0) {
      throw new AppError(400, 'utm_campaign занят другой кампанией MAX — задайте вручную уникальный.');
    }
    input.utm = utm;
  }

  const updated = await updateBroadcastCampaign(id, input, channel);
  if (!updated) {
    throw new AppError(409, 'Редактировать можно только черновик. Активные и отправленные кампании не изменяются.');
  }

  logAudit({
    userId: req.user?.id || undefined,
    userName: req.user?.display_name || req.user?.email || 'unknown',
    action: 'broadcast_campaign_update',
    entityType: 'marketing_campaign',
    entityId: id,
    details: { name: input.name, channel },
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  log.info('broadcast campaign updated', { campaignId: id, channel });
  res.json({ success: true, data: { id } });
});

/**
 * GET /segments/options?channel=telegram — selectable services + per-channel counts for the
 * audience segment builder. Registered BEFORE /:id/... so 'segments' is never matched as a
 * UUID. Channel query param is optional (defaults to telegram inside the service).
 */
router.get('/segments/options', async (req: AuthRequest, res: Response): Promise<void> => {
  const rawChannel = req.query['channel'];
  const channel = typeof rawChannel === 'string' && ALLOWED_CHANNELS.has(rawChannel)
    ? rawChannel
    : 'telegram';
  const data = await getSegmentOptions(channel);
  res.json({ success: true, data });
});

/**
 * POST /audience-preview — live recipient count for a segment, BEFORE creating/launching.
 * Body {channel, serviceSlugs?, recencyDays?}. Uses the SAME predicate as materializeRecipients
 * (buildAudienceWhere), so the number shown is exactly what a live dispatch would fan out to.
 * Registered BEFORE /:id/... so 'audience-preview' is never matched as a UUID.
 */
router.post('/audience-preview', async (req: AuthRequest, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as AudiencePreviewBody;
  const filter = parseAudienceFilterOr400(body);
  const { count } = await previewAudience(filter);
  res.json({ success: true, data: { count } });
});

/**
 * GET /:id/recipients?limit=100&offset=0 — paginated recipients + per-recipient click flag.
 */
router.get('/:id/recipients', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = req.params['id'];
  if (!id || !UUID_RE.test(id)) {
    throw new AppError(400, 'Некорректный id кампании');
  }

  const rawLimit = Number(req.query['limit']);
  const rawOffset = Number(req.query['offset']);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100;
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  // ?clicked=true → вид «Интересовались»: только контакты, кликнувшие по ссылке рассылки.
  const clickedOnly = req.query['clicked'] === 'true';

  const data = await getCampaignRecipients(id, { limit, offset, clickedOnly });
  res.json({ success: true, data });
});

/**
 * POST /:id/go-live — flip a campaign to test_mode=false (send-to-everyone).
 *
 * The SINGLE path out of test mode. Explicit, audited, and gated behind a danger
 * confirmation in the UI. Does NOT dispatch — the operator still presses dispatch after.
 */
router.post('/:id/go-live', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = req.params['id'];
  if (!id || !UUID_RE.test(id)) {
    throw new AppError(400, 'Некорректный id кампании');
  }

  const result = await setCampaignLive(id);

  logAudit({
    userId: req.user?.id || undefined,
    userName: req.user?.display_name || req.user?.email || 'unknown',
    action: 'broadcast_campaign_go_live',
    entityType: 'marketing_campaign',
    entityId: id,
    details: { testMode: false },
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  log.warn('broadcast campaign promoted to LIVE via go-live', { campaignId: id });
  res.json({ success: true, data: result });
});

/**
 * POST /:id/dispatch — launch a broadcast campaign.
 *
 * Optional body.payload (JSON: {text?, mediaUrl?, landingUrl?, buttons?}) is stored on
 * marketing_campaigns.broadcast_payload BEFORE materialization, so the operator/test can
 * set the editorial content at dispatch time. Then status='active' (the kill-switch the
 * dispatcher reads) and the audience is materialized in one transaction (the flavrinov-only
 * test-gate lives in DATA: test_mode + allowed_contact_ids).
 */
router.post('/:id/dispatch', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = req.params['id'];
  if (!id || !UUID_RE.test(id)) {
    throw new AppError(400, 'Некорректный id кампании');
  }

  const { payload } = req.body as DispatchBody;

  // Guard: the campaign must exist and be a supported messenger broadcast (telegram|vk|max).
  const campaign = await db.queryOne<CampaignGuardRow>(
    `SELECT id, channel, status, test_mode, audience_filter FROM marketing_campaigns WHERE id = $1`,
    [id],
  );
  if (!campaign) {
    throw new AppError(404, 'Кампания не найдена');
  }
  if (campaign.channel !== 'telegram' && campaign.channel !== 'vk' && campaign.channel !== 'max') {
    throw new AppError(400, 'Рассылка поддерживается только для каналов Telegram, ВКонтакте и MAX');
  }

  // Channel-guard: the persisted column is the dispatch channel; the segment filter MUST
  // agree (invariant P1-1, enforced at create). A mismatch means a tampered/legacy row →
  // refuse so we never push a segment through the wrong adapter. NULL filter → legacy telegram.
  const segmentChannel = readAudienceChannel(campaign.audience_filter);
  if (segmentChannel !== campaign.channel) {
    throw new AppError(400, `Канал сегмента «${segmentChannel}» не совпадает с каналом кампании «${campaign.channel}».`);
  }

  // Optional content update — persist before materializing the snapshot.
  if (payload !== undefined) {
    if (payload === null || typeof payload !== 'object') {
      throw new AppError(400, 'payload должен быть JSON-объектом {text?, mediaUrl?, landingUrl?, buttons?}');
    }
    await db.query(
      `UPDATE marketing_campaigns SET broadcast_payload = $2::jsonb, updated_at = now() WHERE id = $1`,
      [id, JSON.stringify(payload)],
    );
  }

  // Live-audience cap (MAX_RECIPIENTS): for a non-test campaign, project the would-be
  // audience size BEFORE materializing and refuse an oversized fan-out. With a segment filter
  // the projection uses previewAudience (the SAME predicate materializeRecipients applies),
  // so the cap counts exactly what would be sent. Without a filter it mirrors the legacy
  // all-telegram pass-1 predicate. For test_mode the gate is flavrinov-only → cap irrelevant.
  if (!campaign.test_mode) {
    let cnt: number;
    const filter = parseAudienceFilterForGuard(campaign.audience_filter);
    if (filter) {
      cnt = (await previewAudience(filter)).count;
    } else {
      const audience = await db.queryOne<AudienceCountRow>(
        `SELECT count(*)::int AS cnt
         FROM contacts c
         JOIN LATERAL (
           SELECT 1
           FROM conversations
           WHERE contact_id = c.id
             AND channel = 'telegram'
             AND external_chat_id IS NOT NULL
             AND status <> 'closed'
           LIMIT 1
         ) conv ON true
         LEFT JOIN marketing_suppressions s ON s.contact_id = c.id
         WHERE c.deleted_at IS NULL
           AND s.contact_id IS NULL`,
      );
      cnt = audience?.cnt ?? 0;
    }
    if (cnt > MAX_RECIPIENTS) {
      throw new AppError(
        400,
        `Аудитория ${cnt} получателей превышает лимит ${MAX_RECIPIENTS} за один запуск. Сузьте охват или обратитесь к администратору.`,
      );
    }
  }

  // Launch CAS: atomically flip status draft|paused → active. A second click while the
  // campaign is already active matches 0 rows → 409 (no re-materialize, no double launch).
  // 'active' is the kill-switch the dispatcher reads.
  const launched = await db.queryOne<LaunchCasRow>(
    `UPDATE marketing_campaigns
     SET status = 'active', updated_at = now()
     WHERE id = $1 AND status IN ('draft', 'paused')
     RETURNING id`,
    [id],
  );
  if (!launched) {
    throw new AppError(409, 'Кампания уже запущена (или находится в неподходящем статусе)');
  }

  const counts = await materializeRecipients(id);

  logAudit({
    userId: req.user?.id || undefined,
    userName: req.user?.display_name || req.user?.email || 'unknown',
    action: 'broadcast_campaign_dispatch',
    entityType: 'marketing_campaign',
    entityId: id,
    details: {
      inserted: counts.inserted,
      suppressed: counts.suppressed,
      skipped: counts.skipped,
      payloadSet: payload !== undefined,
    },
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  log.info('broadcast campaign dispatched', { campaignId: id, ...counts });

  res.json({ success: true, campaignId: id, ...counts });
});

/**
 * GET /:id/stats — delivery funnel + rates + ETA for a campaign.
 */
router.get('/:id/stats', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = req.params['id'];
  if (!id || !UUID_RE.test(id)) {
    throw new AppError(400, 'Некорректный id кампании');
  }

  const stats = await getCampaignStats(id);
  res.json({ success: true, stats });
});

export default router;
