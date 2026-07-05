/**
 * Campaign Service — materialization + per-recipient send for Telegram broadcast.
 *
 * Two-layer model (see TG_BROADCAST_ARCHITECTURE_2026_05_31.md §3):
 *   marketing_campaigns  — header (1 row/campaign): content, UTM, kill-switch (status), test-gate
 *   campaign_recipients  — registry (1 row/(campaign,contact)): delivery state + outbox
 *
 * Send pipeline guarantees (load-bearing):
 *  - CAS-flip queued/failed→processing protects against double-send (Telegram has no
 *    idempotency-key; UNIQUE(campaign_id,contact_id) + this CAS are the only guards).
 *  - 429 is NEVER a recipient status — it is global backpressure: pauseBot() the token
 *    (shared with live support), leave the row 'queued' + next_attempt_at, return
 *    'rate_limited' so the worker yields WITHOUT consuming an attempt.
 *  - 403/blocked/deactivated/chat-not-found → terminal 'blocked' + suppression (so we
 *    never re-target). 5xx/network → backoff 'failed' (or terminal 'failed' after max).
 */

import db from '../../database/db.js';
import type { PoolClient } from 'pg';
import { createLogger } from '../../utils/logger.js';
import { pauseBot } from './broadcast-governor.js';
import { BCAST_UNSUB, BCAST_NOT_STUDENT, BCAST_ADDRESSES } from './broadcast-callbacks.constants.js';
import { getAccountByChannel } from '../connectors/core/account-store.js';
import { getAdapterOrThrow } from '../connectors/core/adapter-registry.js';

const log = createLogger('campaign.service');

// 429 governor pause is capped — beyond this we fail-fast and let the reconciler retry,
// rather than holding the shared bot token hostage to a hostile retry_after.
const MAX_PAUSE_MS = 30_000;
// Transactional backoff base: mirror outbound-worker's `5000·2^(n-1)`.
const BACKOFF_BASE_MS = 5_000;

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Audience segment filter (stored in marketing_campaigns.audience_filter JSONB).
 * `channel` is the REAL target channel of the segment (the marketing_campaigns.channel
 * column stays 'telegram' because its CHECK forbids vk/max/...). v1 dispatch only sends
 * telegram; preview/count work for every channel.
 */
export interface AudienceFilter {
  channel: string;
  /** primary_service_slug filter — empty/absent = any service. */
  serviceSlugs?: string[];
  /** last_seen_at within the last N days — absent/null = any recency. */
  recencyDays?: number | null;
}

/** Whitelisted channel_type enum values — guards the channel param against SQLi/garbage. */
export const ALLOWED_CHANNELS: ReadonlySet<string> = new Set([
  'telegram', 'vk', 'whatsapp', 'instagram', 'max', 'email', 'web',
]);

/** One selectable service in the segment builder (slug + label + active-contact count). */
export interface SegmentServiceOption {
  slug: string;
  label: string;
  count: number;
}

/** One selectable channel in the segment builder (channel + active-contact count). */
export interface SegmentChannelOption {
  channel: string;
  count: number;
}

/** Options payload for the audience segment builder UI. */
export interface SegmentOptions {
  services: SegmentServiceOption[];
  channels: SegmentChannelOption[];
}

/** Inline URL-button (callback buttons handled in the consent slice, not v1). */
export interface BroadcastButton {
  text: string;
  url: string;
}

/** Editorial content of a campaign, stored in marketing_campaigns.broadcast_payload (JSONB). */
export interface BroadcastPayload {
  text?: string;
  mediaUrl?: string;
  /** Optional CTA landing the personalized UTM-link points at. Defaults to svoefoto.ru. */
  landingUrl?: string;
  /** Rows of URL-buttons. Each gets the per-recipient UTM appended at send time. */
  buttons?: BroadcastButton[][];
  /**
   * Какие СЛУЖЕБНЫЕ callback-кнопки добавить. «❌ Отписаться» всегда присутствует
   * (антиспам/152-ФЗ) и здесь не хранится. Отсутствие поля → обе включены (обратная
   * совместимость: старые/живые кампании без поля = прежнее поведение, все 3 кнопки).
   */
  serviceButtons?: { addresses?: boolean; notStudent?: boolean };
}

/** Frozen per-recipient payload snapshot (column payload_snapshot). Exported for the VK layer (S5). */
export interface PayloadSnapshot {
  text: string | null;
  mediaUrl: string | null;
  buttons: BroadcastButton[][] | null;
  /** Выбор служебных callback-кнопок (NULL = обе включены, legacy). «Отписаться» всегда. */
  serviceButtons?: { addresses?: boolean; notStudent?: boolean } | null;
}

/** marketing_campaigns header row read at materialization (P0-1 anchor). */
interface CampaignHeaderRow {
  id: string;
  test_mode: boolean;
  allowed_contact_ids: string[] | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  broadcast_payload: unknown;
  audience_filter: unknown;
}

/** status → count row from a GROUP BY status aggregate. */
interface StatusCountRow {
  status: string;
  cnt: number;
}

/** Dispatchable-claim projection (id + idempotency_key) from FOR UPDATE SKIP LOCKED. */
interface DispatchClaimRow {
  id: string;
  idempotency_key: string;
}

export interface MaterializeResult {
  inserted: number;
  suppressed: number;
  skipped: number;
}

export interface DispatchableRecipient {
  id: string;
  idempotencyKey: string;
}

export type SendOutcomeStatus = 'sent' | 'failed' | 'blocked' | 'rate_limited' | 'skipped';

export interface SendOutcome {
  status: SendOutcomeStatus;
  retryAfterMs?: number;
}

export interface CampaignStats {
  byStatus: Record<string, number>;
  total: number;
  sentRate: number;
  blockRate: number;
  etaSeconds: number | null;
  /** Уникальные контакты, кликнувшие по ссылке рассылки (через ad_clicks по utm_content). */
  clicks: number;
}

/** Delivery funnel embedded in a list item — one count per recipient status. */
export interface BroadcastFunnel {
  queued: number;
  sent: number;
  failed: number;
  blocked: number;
  skipped: number;
  suppressed: number;
  total: number;
}

/** Row of the broadcast list (one campaign + its funnel) for the operator pult. */
export interface BroadcastListItem {
  id: string;
  name: string;
  status: string | null;
  test_mode: boolean;
  allowed_count: number;
  created_at: string;
  funnel: BroadcastFunnel;
  /** Audience segment filter (NULL = legacy all-telegram audience) — for showing the segment. */
  audience_filter: AudienceFilter | null;
  /** Send-channel column (telegram|vk|max) — the UI badges the row by this (P2-2). */
  channel: string | null;
}

/** One recipient row for the campaign detail table (delivery state + click flag). */
export interface BroadcastRecipientItem {
  id: string;
  contact_id: string;
  contact_name: string | null;
  status: string;
  error_code: string | null;
  error_detail: string | null;
  sent_at: string | null;
  clicked: boolean;
  clicked_at: string | null;
}

export interface BroadcastRecipientsPage {
  items: BroadcastRecipientItem[];
  total: number;
}

/** Editorial + audience input for creating a broadcast campaign (test_mode is NEVER here). */
export interface CreateBroadcastInput {
  name: string;
  payload: BroadcastPayload;
  allowedContactIds?: string[];
  utm?: { source?: string; medium?: string; campaign?: string };
  /** Audience segment filter; absent = legacy all-telegram audience. */
  audienceFilter?: AudienceFilter;
}

const DEFAULT_LANDING = 'https://svoefoto.ru';
// Broadcast worker limiter ceiling (5/sec) — used to estimate ETA from queued backlog.
const SEND_RATE_PER_SEC = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse the campaign's broadcast_payload JSONB — graceful on NULL/garbage. */
function parsePayload(raw: unknown): BroadcastPayload {
  if (!raw) return {};
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== 'object') return {};
  const p = obj as Record<string, unknown>;
  const out: BroadcastPayload = {};
  if (typeof p['text'] === 'string') out.text = p['text'];
  if (typeof p['mediaUrl'] === 'string') out.mediaUrl = p['mediaUrl'];
  if (typeof p['landingUrl'] === 'string') out.landingUrl = p['landingUrl'];
  if (Array.isArray(p['buttons'])) {
    const rows: BroadcastButton[][] = [];
    for (const row of p['buttons']) {
      if (!Array.isArray(row)) continue;
      const cells: BroadcastButton[] = [];
      for (const b of row) {
        if (b && typeof b === 'object'
          && typeof (b as Record<string, unknown>)['text'] === 'string'
          && typeof (b as Record<string, unknown>)['url'] === 'string') {
          cells.push({ text: String((b as Record<string, unknown>)['text']), url: String((b as Record<string, unknown>)['url']) });
        }
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length > 0) out.buttons = rows;
  }
  const sb = p['serviceButtons'];
  if (sb && typeof sb === 'object') {
    const s = sb as Record<string, unknown>;
    out.serviceButtons = {
      addresses: typeof s['addresses'] === 'boolean' ? s['addresses'] : true,
      notStudent: typeof s['notStudent'] === 'boolean' ? s['notStudent'] : true,
    };
  }
  return out;
}

// ─── Audience segmentation ────────────────────────────────────────────────────

// Recency is bounded to a sane window: <1 day or >365 days is rejected (not a segment).
const MAX_RECENCY_DAYS = 365;
// slug grammar: lowercase alnum + underscore, ≤100 chars (mirrors primary_service_slug varchar(100)).
const SLUG_RE = /^[a-z0-9_]{1,100}$/;

/**
 * Validate + normalize a raw audience filter object (from the HTTP body) into a typed
 * AudienceFilter. Throws AppError(400) on anything malformed. SECURITY: this is the single
 * trust boundary — channel must be a known enum value, serviceSlugs must match the slug
 * grammar, recencyDays a bounded integer. Everything downstream binds these as params.
 */
export function normalizeAudienceFilter(raw: unknown): AudienceFilter {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('audienceFilter must be an object');
  }
  const r = raw as Record<string, unknown>;

  const channel = typeof r['channel'] === 'string' ? r['channel'] : '';
  if (!ALLOWED_CHANNELS.has(channel)) {
    throw new Error(`audienceFilter.channel must be one of: ${[...ALLOWED_CHANNELS].join(', ')}`);
  }

  const out: AudienceFilter = { channel };

  if (r['serviceSlugs'] !== undefined && r['serviceSlugs'] !== null) {
    if (!Array.isArray(r['serviceSlugs'])) {
      throw new Error('audienceFilter.serviceSlugs must be an array of slugs');
    }
    const slugs: string[] = [];
    for (const s of r['serviceSlugs']) {
      if (typeof s !== 'string' || !SLUG_RE.test(s)) {
        throw new Error('audienceFilter.serviceSlugs contains an invalid slug');
      }
      slugs.push(s);
    }
    if (slugs.length > 0) out.serviceSlugs = slugs;
  }

  if (r['recencyDays'] !== undefined && r['recencyDays'] !== null) {
    const n = r['recencyDays'];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_RECENCY_DAYS) {
      throw new Error(`audienceFilter.recencyDays must be an integer 1..${MAX_RECENCY_DAYS}`);
    }
    out.recencyDays = n;
  }

  return out;
}

/**
 * Parse a stored audience_filter JSONB back into a typed AudienceFilter, NULL/garbage-safe.
 * Returns null for a missing/invalid filter (→ legacy all-telegram audience). Re-validates
 * with the same rules as the create path so a tampered/legacy row can never inject SQL.
 */
function parseAudienceFilter(raw: unknown): AudienceFilter | null {
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

/** Param-bound WHERE fragment for a segment + its params (placeholders start at startIdx). */
interface AudienceWhere {
  /** SQL fragment beginning with the channel-keyed LATERAL join + WHERE predicate. */
  joinAndWhere: string;
  params: unknown[];
}

/**
 * Build the SINGLE audience predicate shared by previewAudience (COUNT) and
 * materializeRecipients (live INSERT). Both must produce the same set, so the SQL lives
 * here once. Returns a fragment that assumes `contacts c` is already in FROM, exposes the
 * chosen chat row as `conv.external_chat_id`, and filters: has a chat on the channel —
 * i.e. ever started the bot (external_chat_id IS NOT NULL; CRM status is irrelevant for
 * deliverability, a "closed" thread still means the user can be messaged) ∧ not suppressed ∧
 * contact not deleted ∧ service∈slugs ∧ last_seen within recency.
 *
 * SECURITY: every value is a placeholder ($N). channel → ::channel_type cast (enum rejects
 * garbage), serviceSlugs → =ANY($::text[]), recencyDays → bound as a string param then cast
 * to interval. NO value is ever concatenated into the SQL text.
 *
 * OPT-IN (channel-conditional): VK's anti-spam policy requires an explicit marketing opt-in —
 * for channel='vk' an EXISTS(channel_users …) predicate restricts the audience to the chosen
 * LATERAL-peer who opted in and never opted out (matched STRICTLY on conv.external_chat_id, the
 * one peer this segment will message, P1-3). For every OTHER channel (telegram legacy included)
 * this fragment is EMPTY — the Telegram SQL is byte-for-byte unchanged (pressing /start is the
 * accepted audience). The cu.channel literal is also bound (`= $channelIdx::channel_type`) so no
 * value is concatenated.
 */
function buildAudienceWhere(filter: AudienceFilter, startIdx: number): AudienceWhere {
  const params: unknown[] = [];
  let idx = startIdx;

  const channelIdx = idx++;
  params.push(filter.channel);

  // serviceSlugs: a NULL param means "any service"; ANY($::text[]) when present.
  const slugsIdx = idx++;
  params.push(filter.serviceSlugs && filter.serviceSlugs.length > 0 ? filter.serviceSlugs : null);

  // recencyDays: NULL = any; otherwise bind the day count as text, cast to interval in SQL.
  const recencyIdx = idx++;
  params.push(
    filter.recencyDays !== undefined && filter.recencyDays !== null
      ? String(filter.recencyDays)
      : null,
  );

  // VK-only opt-in gate: non-empty ONLY for channel='vk' (TG fragment stays empty so its SQL is
  // unchanged). The peer is the chosen LATERAL conv.external_chat_id (NOT "any dialog of the
  // contact"), so a contact opted in on one peer does not leak a different peer (P1-3).
  // NB: channel_users.channel is VARCHAR (not the channel_type enum). The same $N param is used
  // as $N::channel_type for conversations.channel, so Postgres infers $N AS channel_type — here we
  // cast it back to text (`= $N::text`) to compare against the varchar column (else "varchar =
  // channel_type" raises). external_user_id (varchar) = conv.external_chat_id (varchar) is fine.
  const optInFragment = filter.channel === 'vk'
    ? `
         AND EXISTS (
           SELECT 1 FROM channel_users cu
           WHERE cu.channel = $${channelIdx}::text
             AND cu.external_user_id = conv.external_chat_id
             AND cu.opted_in = true
             AND cu.opted_out_at IS NULL
         )`
    : '';

  const joinAndWhere = `
       JOIN LATERAL (
         SELECT external_chat_id
         FROM conversations
         WHERE contact_id = c.id
           AND channel = $${channelIdx}::channel_type
           AND external_chat_id IS NOT NULL
         ORDER BY last_message_at DESC NULLS LAST
         LIMIT 1
       ) conv ON true
       LEFT JOIN marketing_suppressions s ON s.contact_id = c.id
       WHERE c.deleted_at IS NULL
         AND s.contact_id IS NULL
         AND ($${slugsIdx}::text[] IS NULL OR c.primary_service_slug = ANY($${slugsIdx}::text[]))
         AND ($${recencyIdx}::text IS NULL
              OR c.last_seen_at >= now() - ($${recencyIdx}::text || ' days')::interval)${optInFragment}`;

  return { joinAndWhere, params };
}

/**
 * Count the distinct contacts that match an audience segment. Uses buildAudienceWhere so the
 * number shown in the dialog is the exact number materializeRecipients will fan out to.
 */
export async function previewAudience(filter: AudienceFilter): Promise<{ count: number }> {
  const { joinAndWhere, params } = buildAudienceWhere(filter, 1);
  const row = await db.queryOne<{ cnt: number }>(
    `SELECT count(DISTINCT c.id)::int AS cnt
     FROM contacts c
     ${joinAndWhere}`,
    params,
  );
  return { count: row?.cnt ?? 0 };
}

interface SegmentServiceRow {
  slug: string;
  label: string | null;
  cnt: number;
}

interface SegmentChannelRow {
  channel: string;
  cnt: number;
}

/**
 * Options for the segment builder: per-channel active-contact counts (same predicate as
 * previewAudience, so the channel counts match what a no-filter preview would show) and
 * the selectable services (slug+label+count) for the given channel. `not_determined`/`none`
 * slugs and NULLs are excluded from the service list (not meaningful targeting criteria).
 */
export async function getSegmentOptions(channel: string): Promise<SegmentOptions> {
  const ch = ALLOWED_CHANNELS.has(channel) ? channel : 'telegram';

  // Per-channel counts via the SAME active-dialog predicate (one active dialog on the channel).
  const channelRows = await db.query<SegmentChannelRow>(
    `SELECT chs.channel::text AS channel, count(DISTINCT c.id)::int AS cnt
     FROM contacts c
     CROSS JOIN (
       SELECT unnest($1::channel_type[]) AS channel
     ) chs
     JOIN LATERAL (
       SELECT 1
       FROM conversations
       WHERE contact_id = c.id
         AND channel = chs.channel
         AND external_chat_id IS NOT NULL
       LIMIT 1
     ) conv ON true
     LEFT JOIN marketing_suppressions s ON s.contact_id = c.id
     WHERE c.deleted_at IS NULL AND s.contact_id IS NULL
     GROUP BY chs.channel
     ORDER BY cnt DESC`,
    [[...ALLOWED_CHANNELS]],
  );

  // Selectable services for the chosen channel (active dialog on that channel).
  const serviceRows = await db.query<SegmentServiceRow>(
    `SELECT c.primary_service_slug AS slug,
            min(c.primary_service_label) AS label,
            count(DISTINCT c.id)::int AS cnt
     FROM contacts c
     JOIN LATERAL (
       SELECT 1
       FROM conversations
       WHERE contact_id = c.id
         AND channel = $1::channel_type
         AND external_chat_id IS NOT NULL
       LIMIT 1
     ) conv ON true
     LEFT JOIN marketing_suppressions s ON s.contact_id = c.id
     WHERE c.deleted_at IS NULL
       AND s.contact_id IS NULL
       AND c.primary_service_slug IS NOT NULL
       AND c.primary_service_slug NOT IN ('not_determined', 'none')
     GROUP BY c.primary_service_slug
     ORDER BY cnt DESC`,
    [ch],
  );

  return {
    channels: channelRows.map((r) => ({ channel: r.channel, count: r.cnt })),
    services: serviceRows.map((r) => ({ slug: r.slug, label: r.label ?? r.slug, count: r.cnt })),
  };
}

interface UtmParts {
  source: string | null;
  medium: string | null;
  campaign: string | null;
}

/**
 * Append UTM params + per-recipient attribution to a URL.
 * Attribution: `utm_content=<contact_id>` (analytics resolves clicks per-contact, see
 * ANALYTICS_TRACKING_ARCHITECTURE) + `campaign_id` for cross-DB join.
 */
export function withUtm(
  baseUrl: string,
  utm: UtmParts,
  contactId: string,
  campaignId: string,
  telegramId?: string | null,
): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return baseUrl;
  }
  if (utm.source) url.searchParams.set('utm_source', utm.source);
  if (utm.medium) url.searchParams.set('utm_medium', utm.medium);
  if (utm.campaign) url.searchParams.set('utm_campaign', utm.campaign);
  url.searchParams.set('utm_content', contactId);     // internal contact id — canonical attribution
  url.searchParams.set('campaign_id', campaignId);
  if (telegramId) url.searchParams.set('utm_term', telegramId); // raw telegram id — direct in click record
  return url.toString();
}

/**
 * Campaign-level (non-personalized) landing URL with campaign UTMs only.
 * The per-recipient `utm_content=<contact_id>` + `campaign_id` are appended in SQL at
 * materialization (so each recipient row gets its own attribution without N round-trips).
 */
export function buildCampaignBaseUrl(payload: BroadcastPayload, utm: UtmParts): string {
  const base = payload.landingUrl || DEFAULT_LANDING;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return base;
  }
  if (utm.source) url.searchParams.set('utm_source', utm.source);
  if (utm.medium) url.searchParams.set('utm_medium', utm.medium);
  if (utm.campaign) url.searchParams.set('utm_campaign', utm.campaign);
  return url.toString();
}

// ─── Materialization (P0-1: header explicitly in FROM, one transaction) ────────

/**
 * Fan out a campaign's audience into campaign_recipients in ONE transaction.
 *
 * Audience = ¬suppressed ∧ has-open-telegram-chat (i.e. the contact started the bot and has
 * not opted out), intersected with the test-gate `(NOT mc.test_mode OR c.id = ANY(...))`.
 * The test-gate lives in DATA (not a code flag) so flavrinov-only is auditable; flipping
 * test_mode=false is the single explicit "send to everyone" step.
 *
 * NB: a separate marketing opt-in is intentionally NOT required — pressing the bot's /start
 * is treated as the audience (owner's accepted business decision). The opt-OUT path remains
 * (unsubscribe button / 403-block → marketing_suppressions) and IS honoured here.
 *
 * Contacts excluded for a *reportable* reason (in suppression / no chat) are recorded as
 * status='suppressed'/'skipped' with a skip_reason — never a silent drop, so the funnel
 * reflects the full audience.
 */
export async function materializeRecipients(campaignId: string): Promise<MaterializeResult> {
  return db.transaction(async (client: PoolClient) => {
    // Load the header (P0-1: campaign is the anchor row, never a dangling alias).
    const headerRes = await client.query(
      `SELECT id, test_mode, allowed_contact_ids,
              utm_source, utm_medium, utm_campaign, broadcast_payload, audience_filter
       FROM marketing_campaigns
       WHERE id = $1`,
      [campaignId],
    );
    if (headerRes.rows.length === 0) {
      throw new Error(`Campaign ${campaignId} not found`);
    }
    const header = headerRes.rows[0] as CampaignHeaderRow;

    const payload = parsePayload(header.broadcast_payload);
    const utm: UtmParts = {
      source: header.utm_source,
      medium: header.utm_medium,
      campaign: header.utm_campaign,
    };
    const snapshot: PayloadSnapshot = {
      text: payload.text ?? null,
      mediaUrl: payload.mediaUrl ?? null,
      buttons: payload.buttons ?? null,
      serviceButtons: payload.serviceButtons ?? null,
    };

    // Segment filter (NULL = legacy all-telegram). The channel + service/recency predicates
    // below are bound from this so live materialization fans out to EXACTLY the set
    // previewAudience counted (the inviolable preview↔materialize invariant). The chat
    // channel is the segment's channel; absent filter → 'telegram' (legacy behaviour).
    const filter = parseAudienceFilter(header.audience_filter);
    const channel = filter?.channel ?? 'telegram';
    const serviceSlugs = filter?.serviceSlugs && filter.serviceSlugs.length > 0 ? filter.serviceSlugs : null;
    const recencyDays = filter?.recencyDays !== undefined && filter?.recencyDays !== null
      ? String(filter.recencyDays)
      : null;
    const isVk = channel === 'vk';

    // VK-only opt-in gate (anti-spam) + per-peer dedup (P0-1). Both fragments are EMPTY for
    // every other channel, so the Telegram materialization SQL is byte-for-byte unchanged.
    //  - vkOptIn: identical predicate to buildAudienceWhere — only peers opted in (and not
    //    opted out) on the chosen LATERAL peer. previewAudience↔materialize stay in lockstep.
    //  - DISTINCT ON (conv.external_chat_id): one VK peer can belong to N contacts (peer 308721408
    //    = 3 contacts) → without this a single human gets 2-3 messages (a ban signal). DISTINCT ON
    //    collapses to one queued row per peer with a DETERMINISTIC pick (lowest contact_id), so it
    //    is stable across re-materialization and never trips the uq_recipient_vk_peer backstop.
    // channel_users.channel is VARCHAR; $4 is inferred channel_type (used as $4::channel_type for
    // conversations) → cast back to text here ($4::text) to compare against the varchar column.
    const vkOptIn = isVk
      ? `
         AND EXISTS (
           SELECT 1 FROM channel_users cu
           WHERE cu.channel = $4::text
             AND cu.external_user_id = conv.external_chat_id
             AND cu.opted_in = true
             AND cu.opted_out_at IS NULL
         )`
      : '';
    const vkDistinct = isVk ? 'DISTINCT ON (conv.external_chat_id)' : '';
    // DISTINCT ON requires its key to lead ORDER BY; the secondary c.id makes the pick deterministic.
    const vkOrderBy = isVk ? 'ORDER BY conv.external_chat_id, c.id' : '';

    // ── Pass 1: INSERT the dispatchable audience (not suppressed, has open chat on channel).
    // P0-1: marketing_campaigns mc is in FROM; everything keyed off mc.id=$1.
    // Per-recipient personalized_url is built in SQL via the (utm + contact_id) params;
    // payload_snapshot is the same for every recipient (frozen content) → bind once.
    // $4 channel / $5 serviceSlugs / $6 recencyDays — the SAME predicate as previewAudience.
    const insertRes = await client.query(
      `INSERT INTO campaign_recipients
         (campaign_id, contact_id, channel, external_chat_id, kind, idempotency_key,
          status, personalized_url, payload_snapshot, max_attempts)
       SELECT ${vkDistinct}
              mc.id,
              c.id,
              $4::channel_type::text,
              conv.external_chat_id,
              'marketing',
              'camp:' || mc.id || ':' || c.id,
              'queued',
              -- personalized landing URL: base + utm + utm_content=contact_id + campaign_id + utm_term=telegram_id
              $3 || (CASE WHEN position('?' in $3) > 0 THEN '&' ELSE '?' END)
                  || 'utm_content=' || c.id::text || '&campaign_id=' || mc.id::text
                  || '&utm_term=' || conv.external_chat_id,
              $2::jsonb,
              3
       FROM marketing_campaigns mc
       JOIN contacts c ON c.deleted_at IS NULL
       JOIN LATERAL (
         SELECT external_chat_id
         FROM conversations
         WHERE contact_id = c.id
           AND channel = $4::channel_type
           AND external_chat_id IS NOT NULL
         ORDER BY last_message_at DESC NULLS LAST
         LIMIT 1
       ) conv ON true
       LEFT JOIN marketing_suppressions s ON s.contact_id = c.id
       WHERE mc.id = $1
         AND s.contact_id IS NULL
         AND (NOT mc.test_mode OR c.id = ANY(mc.allowed_contact_ids))
         AND ($5::text[] IS NULL OR c.primary_service_slug = ANY($5::text[]))
         AND ($6::text IS NULL OR c.last_seen_at >= now() - ($6::text || ' days')::interval)${vkOptIn}
       ${vkOrderBy}
       ON CONFLICT (campaign_id, contact_id) DO NOTHING`,
      [
        campaignId,
        JSON.stringify(snapshot),
        // $3: campaign base URL with campaign UTMs; SQL appends per-recipient
        // utm_content + campaign_id so each row carries its own attribution.
        buildCampaignBaseUrl(payload, utm),
        channel,
        serviceSlugs,
        recencyDays,
      ],
    );
    const inserted = insertRes.rowCount ?? 0;

    // ── Pass 2: record reportable exclusions so the funnel is honest (not silent drops).
    // Only contacts inside the test-gate are considered (so test_mode never reveals more
    // than flavrinov). 'suppressed' = in suppression list (opted out / blocked); 'skipped' = no chat.
    // ON CONFLICT DO NOTHING: never overwrite a successfully inserted dispatchable row.
    // Pass-2 mirrors pass-1's channel + segment (service/recency) so it only reports
    // exclusions WITHIN the segment — a contact outside the service/recency filter is not
    // "suppressed/skipped", it is simply not part of this segment. Service/recency predicates
    // are identical to pass-1, so pass-2 never inflates the funnel beyond the segment.
    //
    // VK-only: a contact who HAS a chat and is NOT suppressed but never opted in (or opted out)
    // is a reportable exclusion too → 'skipped' / 'not_opted_in'. `vkNotOptedIn` is a SQL
    // predicate that is FALSE for every other channel, so the Telegram pass-2 set is unchanged
    // (no opt-in concept on TG). It mirrors pass-1's EXISTS, so a VK contact is EITHER inserted
    // (opted in) OR recorded skipped(not_opted_in) — never silently dropped.
    const vkNotOptedIn = isVk
      ? `(conv.external_chat_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM channel_users cu
            WHERE cu.channel = $3::text
              AND cu.external_user_id = conv.external_chat_id
              AND cu.opted_in = true
              AND cu.opted_out_at IS NULL
          ))`
      : 'false';
    // VK pass-2 peer-collision guard. Two exclusion rows on one peer (N not-opted-in contacts on
    // a peer, OR a peer already inserted opted-in in pass-1) would trip uq_recipient_vk_peer
    // (campaign_id, external_chat_id) WHERE channel='vk', which the (campaign_id,contact_id)
    // conflict target does NOT cover → an aborted transaction. A bare `ON CONFLICT DO NOTHING`
    // (no target) absorbs BOTH the contact-pair index AND the peer index: the first exclusion row
    // for a peer wins, the rest are silently dropped (reporting-only — the funnel never inflates).
    // We do NOT DISTINCT ON here: no_chat rows carry a NULL peer (COALESCE'd to '') and DISTINCT ON
    // a NULL key would collapse every no_chat contact into one — the bare conflict clause is the
    // correct, NULL-safe dedup. For non-VK the original targeted clause is kept verbatim, so the
    // Telegram pass-2 statement is byte-for-byte unchanged.
    const exclConflict = isVk ? 'ON CONFLICT DO NOTHING' : 'ON CONFLICT (campaign_id, contact_id) DO NOTHING';
    const exclRes = await client.query(
      `INSERT INTO campaign_recipients
         (campaign_id, contact_id, channel, external_chat_id, kind, idempotency_key,
          status, skip_reason, payload_snapshot, max_attempts)
       SELECT mc.id,
              c.id,
              $3::channel_type::text,
              COALESCE(conv.external_chat_id, ''),
              'marketing',
              'camp:' || mc.id || ':' || c.id,
              CASE WHEN conv.external_chat_id IS NULL THEN 'skipped'
                   WHEN s.contact_id IS NOT NULL THEN 'suppressed'
                   ELSE 'skipped' END,
              CASE WHEN conv.external_chat_id IS NULL THEN 'no_chat'
                   WHEN s.contact_id IS NOT NULL THEN 'suppressed'
                   ELSE 'not_opted_in' END,
              $2::jsonb,
              3
       FROM marketing_campaigns mc
       JOIN contacts c ON c.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT external_chat_id
         FROM conversations
         WHERE contact_id = c.id
           AND channel = $3::channel_type
           AND external_chat_id IS NOT NULL
         ORDER BY last_message_at DESC NULLS LAST
         LIMIT 1
       ) conv ON true
       LEFT JOIN marketing_suppressions s ON s.contact_id = c.id
       WHERE mc.id = $1
         AND (NOT mc.test_mode OR c.id = ANY(mc.allowed_contact_ids))
         AND ($4::text[] IS NULL OR c.primary_service_slug = ANY($4::text[]))
         AND ($5::text IS NULL OR c.last_seen_at >= now() - ($5::text || ' days')::interval)
         AND (
           conv.external_chat_id IS NULL
           OR s.contact_id IS NOT NULL
           OR ${vkNotOptedIn}
         )
       ${exclConflict}`,
      [campaignId, JSON.stringify(snapshot), channel, serviceSlugs, recencyDays],
    );

    // Split the exclusion count into suppressed vs skipped by re-counting the rows we just
    // wrote (cheap: same campaign, terminal exclusion statuses).
    const breakdownRes = await client.query(
      `SELECT status, count(*)::int AS cnt
       FROM campaign_recipients
       WHERE campaign_id = $1 AND status IN ('suppressed','skipped')
       GROUP BY status`,
      [campaignId],
    );
    let suppressed = 0;
    let skipped = 0;
    for (const r of breakdownRes.rows as StatusCountRow[]) {
      if (r.status === 'suppressed') suppressed = r.cnt;
      else if (r.status === 'skipped') skipped = r.cnt;
    }

    log.info('campaign materialized', {
      campaignId,
      inserted,
      suppressed,
      skipped,
      excludedInserted: exclRes.rowCount ?? 0,
      testMode: header.test_mode,
    });

    return { inserted, suppressed, skipped };
  });
}

// ─── Dispatcher claim (FOR UPDATE SKIP LOCKED) ─────────────────────────────────

/**
 * Claim a batch of dispatchable recipients (queued or retryable-failed, due now).
 * FOR UPDATE SKIP LOCKED makes concurrent dispatchers (split worker + monolith leader)
 * safe without a leader-lock. The transaction is short-lived: it only marks intent by
 * returning ids; the actual CAS-flip happens per-recipient in sendToRecipient.
 */
export async function claimDispatchableRecipients(
  campaignId: string,
  limit: number,
): Promise<DispatchableRecipient[]> {
  return db.transaction(async (client: PoolClient) => {
    const res = await client.query(
      `SELECT id, idempotency_key
       FROM campaign_recipients
       WHERE campaign_id = $1
         AND status IN ('queued','failed')
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())
       ORDER BY next_attempt_at NULLS FIRST
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [campaignId, limit],
    );
    return (res.rows as DispatchClaimRow[]).map((r) => ({
      id: r.id,
      idempotencyKey: r.idempotency_key,
    }));
  });
}

// ─── Per-recipient send ────────────────────────────────────────────────────────

// Exported for the VK send-layer (S5): its sendToVkRecipient reuses the SAME CAS-claim
// projection + markFailed backoff so the two engines share one delivery-state contract.
export interface RecipientRow {
  id: string;
  contact_id: string;
  external_chat_id: string;
  personalized_url: string | null;
  payload_snapshot: PayloadSnapshot | null;
  attempts: number;
  max_attempts: number;
}

type KbButton = { text: string; url?: string; callback_data?: string };

/**
 * Build the inline keyboard: payload URL-buttons (with per-recipient UTM, incl. utm_term=telegram_id)
 * followed by fixed callback rows — «📍 Наши адреса» (bot replies with studio addresses from DB) and
 * «🙋 Я не студент» (lead → operator) + «❌ Отписаться» (opt-out).
 * The callback rows are ALWAYS present, even when the campaign has no URL-buttons.
 */
function buildInlineKeyboard(
  snapshot: PayloadSnapshot | null,
  utm: UtmParts,
  contactId: string,
  campaignId: string,
  telegramId: string | null,
): Array<Array<KbButton>> {
  const rows: Array<Array<KbButton>> = [];
  if (snapshot?.buttons && snapshot.buttons.length > 0) {
    for (const row of snapshot.buttons) {
      rows.push(row.map((b) => ({ text: b.text, url: withUtm(b.url, utm, contactId, campaignId, telegramId) })));
    }
  }
  // Служебные callback-кнопки. NULL serviceButtons → обе включены (legacy = прежнее поведение).
  // «❌ Отписаться» присутствует ВСЕГДА (антиспам/152-ФЗ), не управляется флагами.
  const sb = snapshot?.serviceButtons;
  if (sb?.addresses ?? true) {
    rows.push([{ text: '📍 Наши адреса', callback_data: BCAST_ADDRESSES }]);
  }
  const lastRow: KbButton[] = [];
  if (sb?.notStudent ?? true) {
    lastRow.push({ text: '🙋 Я не студент', callback_data: BCAST_NOT_STUDENT });
  }
  lastRow.push({ text: '❌ Отписаться', callback_data: BCAST_UNSUB });
  rows.push(lastRow);
  return rows;
}

/**
 * Send one recipient. Double-send protection is a DB-level CAS lease: a single atomic
 * UPDATE takes the row only if it is dispatchable (status queued/failed AND not already
 * leased), pushing `next_attempt_at` into the future as an in-flight lease. A concurrent
 * worker on the same row gets 0 rows → 'skipped' (no send). Terminal statuses (sent/blocked)
 * never match the guard either. The status CHECK has no 'processing', so we lease via
 * `next_attempt_at` rather than a transient status — the outcome handlers below overwrite it.
 *
 * Lease window mirrors the broadcast worker lockDuration (5 min) so a crashed worker's row
 * is reclaimable by the reconciler after the lease expires, never stuck.
 * Exported so the VK send-layer (S5) leases with the same window (one delivery contract).
 */
export const CLAIM_LEASE_MS = 5 * 60 * 1000;

export async function sendToRecipient(recipientId: string): Promise<SendOutcome> {
  // CAS lease: atomically take ownership of a dispatchable row. Bump attempts is NOT done
  // here (429 must not consume attempts); only the failure handler bumps. 0 rows → another
  // worker owns/finished it OR the lease is still active → do NOT send.
  const claim = await db.query<RecipientRow>(
    `UPDATE campaign_recipients
     SET next_attempt_at = now() + ($2::int || ' milliseconds')::interval, updated_at = now()
     WHERE id = $1
       AND status IN ('queued','failed')
       AND (next_attempt_at IS NULL OR next_attempt_at <= now())
     RETURNING id, contact_id, external_chat_id, personalized_url, payload_snapshot,
               attempts, max_attempts`,
    [recipientId, CLAIM_LEASE_MS],
  );
  if (claim.length === 0) {
    log.debug('recipient not claimable (already handled) — skipping send', { recipientId });
    return { status: 'skipped' };
  }
  const row = claim[0];

  // Resolve campaign UTM for per-recipient link personalization at send-time.
  const campRes = await db.queryOne<{
    id: string;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
  }>(
    `SELECT mc.id, mc.utm_source, mc.utm_medium, mc.utm_campaign
     FROM campaign_recipients cr
     JOIN marketing_campaigns mc ON mc.id = cr.campaign_id
     WHERE cr.id = $1`,
    [recipientId],
  );
  const campaignId = campRes?.id ?? '';
  const utm: UtmParts = {
    source: campRes?.utm_source ?? null,
    medium: campRes?.utm_medium ?? null,
    campaign: campRes?.utm_campaign ?? null,
  };

  const snapshot = row.payload_snapshot;
  const mediaUrl = snapshot?.mediaUrl ?? null;
  const caption = snapshot?.text ?? undefined;
  const inlineKeyboard = buildInlineKeyboard(snapshot, utm, row.contact_id, campaignId, row.external_chat_id);

  if (!mediaUrl) {
    // v1 broadcast is a photo+caption; without media we cannot send via sendMedia.
    // Treat as a permanent content error for this recipient (not retryable).
    await markFailed(recipientId, row, 'no_media', 'broadcast payload has no mediaUrl', true);
    log.error('recipient has no mediaUrl — marking failed', { recipientId, campaignId });
    return { status: 'failed' };
  }

  // Resolve the shared bot account + adapter.
  const account = await getAccountByChannel('telegram');
  if (!account) {
    await markFailed(recipientId, row, 'no_account', 'no active telegram channel account', false);
    log.error('no active telegram account for broadcast', { recipientId });
    return { status: 'failed' };
  }
  const botToken = typeof account.credentials?.['botToken'] === 'string'
    ? (account.credentials['botToken'] as string)
    : '';
  const adapter = getAdapterOrThrow('telegram');

  // Send: photo + caption + inline URL-buttons (per-recipient UTM already baked in).
  const result = await adapter.sendMedia(
    account,
    row.external_chat_id,
    mediaUrl,
    'image',
    caption,
    undefined,
    undefined,
    inlineKeyboard,
  );

  // ── Success ──────────────────────────────────────────────────────────────
  if (result.success) {
    // Guard `external_message_id IS NULL`: stamp 'sent' only ONCE. A stalled-job reclaim
    // of a slow media upload could run this twice; the guard means the second write is a
    // no-op rather than overwriting/duplicating the delivery record. Residual at-least-once
    // is accepted — Telegram has no idempotency-key, so the bot send itself can still repeat
    // in that narrow window; this guard minimizes (not eliminates) it. Explicit team decision.
    await db.query(
      `UPDATE campaign_recipients
       SET status = 'sent', sent_at = now(), external_message_id = $2,
           error_code = NULL, error_detail = NULL, updated_at = now()
       WHERE id = $1 AND external_message_id IS NULL`,
      [recipientId, result.externalMessageId ?? null],
    );
    log.info('recipient sent', { recipientId, campaignId, externalMessageId: result.externalMessageId });
    return { status: 'sent' };
  }

  const errorCode = result.errorCode ?? '';
  const errorMessage = result.errorMessage ?? '';

  // ── 429: global backpressure (NEVER a recipient status) ────────────────────
  if (errorCode === '429') {
    const retryAfterMs = Math.min(((result.retryAfter ?? 1) * 1000), MAX_PAUSE_MS);
    // Pause the shared token so live support yields too (P0-4).
    if (botToken) await pauseBot(botToken, retryAfterMs);
    // Leave the row 'queued', schedule its retry; attempt is NOT consumed.
    await db.query(
      `UPDATE campaign_recipients
       SET status = 'queued', next_attempt_at = now() + ($2::int || ' milliseconds')::interval,
           error_code = '429', error_detail = $3, updated_at = now()
       WHERE id = $1`,
      [recipientId, retryAfterMs, errorMessage.slice(0, 500)],
    );
    log.warn('recipient rate-limited (429) — token paused, row left queued', {
      recipientId, campaignId, retryAfterMs,
    });
    return { status: 'rate_limited', retryAfterMs };
  }

  // ── 403 / blocked / deactivated / chat not found → terminal 'blocked' + suppress ──
  if (errorCode === '403' || /blocked|deactivated|chat not found/i.test(errorMessage)) {
    await db.transaction(async (client: PoolClient) => {
      await client.query(
        `UPDATE campaign_recipients
         SET status = 'blocked', failed_at = now(), error_code = $2, error_detail = $3, updated_at = now()
         WHERE id = $1`,
        [recipientId, errorCode || '403', errorMessage.slice(0, 500)],
      );
      await client.query(
        `INSERT INTO marketing_suppressions (contact_id, external_chat_id, reason)
         VALUES ($1, $2, 'hard_bounce')
         ON CONFLICT (contact_id) WHERE contact_id IS NOT NULL DO NOTHING`,
        [row.contact_id, row.external_chat_id || null],
      );
    });
    log.warn('recipient blocked (403) — suppressed', { recipientId, campaignId, errorCode });
    return { status: 'blocked' };
  }

  // ── Other 4xx (400/401/404/…) → TERMINAL, no retry ─────────────────────────
  // A non-429 client error (bad request, unauthorized token, etc.) will NOT succeed on
  // retry — retrying burns the shared token's rate-domain (3 attempts × ~959 recipients on
  // a dead token = a 429 storm that freezes live support). 403/blocked/deactivated/chat-not-
  // found are already handled above; everything else in 400-499 fails permanently here.
  const codeNum = Number(errorCode);
  if (Number.isInteger(codeNum) && codeNum >= 400 && codeNum < 500 && codeNum !== 429) {
    await markFailed(recipientId, row, errorCode, errorMessage, true);
    log.warn('recipient send failed (terminal 4xx — not retried)', {
      recipientId, campaignId, errorCode,
    });
    return { status: 'failed' };
  }

  // ── 5xx / network / other → retryable backoff, terminal 'failed' after max ──
  await markFailed(recipientId, row, errorCode || 'send_error', errorMessage, false);
  log.warn('recipient send failed (retryable)', {
    recipientId, campaignId, errorCode, attempts: row.attempts + 1, max: row.max_attempts,
  });
  return { status: 'failed' };
}

/**
 * Persist a failed send. Bumps attempts; if attempts < max and not permanent, schedules a
 * backoff retry (stays 'failed' but with next_attempt_at so the reconciler re-claims it).
 * Permanent failures (no media/account) get next_attempt_at=NULL → never retried.
 */
// Exported for the VK send-layer (S5): identical backoff/exhaustion contract so a VK 5xx/network
// failure schedules the same retry curve the TG engine uses. Body unchanged (channel-agnostic).
export async function markFailed(
  recipientId: string,
  row: RecipientRow,
  code: string,
  detail: string,
  permanent: boolean,
): Promise<void> {
  const nextAttempts = row.attempts + 1;
  const exhausted = permanent || nextAttempts >= row.max_attempts;
  if (exhausted) {
    await db.query(
      `UPDATE campaign_recipients
       SET status = 'failed', attempts = $2, failed_at = now(), next_attempt_at = NULL,
           error_code = $3, error_detail = $4, updated_at = now()
       WHERE id = $1`,
      [recipientId, nextAttempts, code, detail.slice(0, 500)],
    );
    return;
  }
  const backoffMs = BACKOFF_BASE_MS * Math.pow(2, nextAttempts - 1);
  await db.query(
    `UPDATE campaign_recipients
     SET status = 'failed', attempts = $2,
         next_attempt_at = now() + ($3::int || ' milliseconds')::interval,
         error_code = $4, error_detail = $5, updated_at = now()
     WHERE id = $1`,
    [recipientId, nextAttempts, backoffMs, code, detail.slice(0, 500)],
  );
}

// ─── Stats funnel ───────────────────────────────────────────────────────────

/**
 * Delivery funnel for a campaign: GROUP BY status (queued/sent/failed/blocked/skipped/
 * suppressed) + sent/block rates + ETA. This is what broadcast_log cannot express (it is
 * an aggregate, not a per-recipient registry).
 */
export async function getCampaignStats(campaignId: string): Promise<CampaignStats> {
  const rows = await db.query<{ status: string; cnt: number }>(
    `SELECT status, count(*)::int AS cnt
     FROM campaign_recipients
     WHERE campaign_id = $1
     GROUP BY status`,
    [campaignId],
  );

  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    byStatus[r.status] = r.cnt;
    total += r.cnt;
  }

  const sent = byStatus['sent'] ?? 0;
  const blocked = byStatus['blocked'] ?? 0;
  const queuedRemaining = byStatus['queued'] ?? 0;

  const sentRate = total > 0 ? sent / total : 0;
  const blockRate = total > 0 ? blocked / total : 0;
  const etaSeconds = queuedRemaining > 0 ? Math.ceil(queuedRemaining / SEND_RATE_PER_SEC) : null;

  // «Интересовались» — уникальные контакты этой кампании, кликнувшие по ссылке (свой трекинг
  // ad_clicks по utm_content=contact_id, scoped к utm_campaign кампании). Левый матч на FDW —
  // если кликов нет / FDW недоступен, clicks=0 (read-only KPI, не влияет на доставку).
  const clkRow = await db.queryOne<{ clicks: number }>(
    `SELECT count(DISTINCT cr.contact_id)::int AS clicks
     FROM campaign_recipients cr
     JOIN marketing_campaigns mc ON mc.id = cr.campaign_id
     JOIN mp_fdw.ad_clicks ac
       ON ac.utm_content = cr.contact_id::text
      AND ac.utm_campaign = mc.utm_campaign
     WHERE cr.campaign_id = $1
       AND mc.utm_campaign IS NOT NULL`,
    [campaignId],
  );
  const clicks = clkRow?.clicks ?? 0;

  return { byStatus, total, sentRate, blockRate, etaSeconds, clicks };
}

// ─── Read-side: list / create / recipients / go-live (operator pult) ───────────
// These are ADDITIVE read/write helpers for the UI. They do NOT touch the send
// pipeline above (materialize/claim/send/governor). The CRM list at /api/campaigns
// is unaffected: listBroadcastCampaigns filters channel IN (telegram, max) so it
// never surfaces flyer/email/sms CRM campaigns, and createBroadcastCampaign INSERTs
// directly (NOT via CRM createCampaign) with test_mode hard-forced true.

/** Normalize a pg timestamp (Date or string) to ISO-8601, NULL-safe. */
function toIso(v: Date | string | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString() : v;
}

interface ListItemRow {
  id: string;
  name: string;
  status: string | null;
  test_mode: boolean;
  allowed_count: number;
  created_at: Date | string;
  audience_filter: unknown;
  channel: string | null;
  queued: number;
  sent: number;
  failed: number;
  blocked: number;
  skipped: number;
  suppressed: number;
  total: number;
}

/** RETURNING id from the create INSERT. */
interface InsertedIdRow {
  id: string;
}

/** count(*) projection for recipients pagination total. */
interface RecipientCountRow {
  total: number;
}

/** RETURNING id, test_mode from the go-live UPDATE. */
interface GoLiveRow {
  id: string;
  test_mode: boolean;
}

/**
 * List telegram broadcast campaigns + their delivery funnel, newest first.
 * The funnel is computed in one LEFT JOIN LATERAL aggregate (count FILTER per status)
 * so the list endpoint is a single round-trip. channel='telegram' is the hard filter
 * that keeps CRM campaigns (flyer/email/sms/...) out of this view (R3).
 */
export async function listBroadcastCampaigns(): Promise<BroadcastListItem[]> {
  const rows = await db.query<ListItemRow>(
    `SELECT
       mc.id, mc.name, mc.status, mc.test_mode,
       COALESCE(array_length(mc.allowed_contact_ids, 1), 0) AS allowed_count,
       mc.created_at,
       mc.audience_filter,
       mc.channel::text            AS channel,
       COALESCE(agg.queued, 0)     AS queued,
       COALESCE(agg.sent, 0)       AS sent,
       COALESCE(agg.failed, 0)     AS failed,
       COALESCE(agg.blocked, 0)    AS blocked,
       COALESCE(agg.skipped, 0)    AS skipped,
       COALESCE(agg.suppressed, 0) AS suppressed,
       COALESCE(agg.total, 0)      AS total
     FROM marketing_campaigns mc
     LEFT JOIN LATERAL (
       SELECT
         count(*)::int                                       AS total,
         count(*) FILTER (WHERE status = 'queued')::int      AS queued,
         count(*) FILTER (WHERE status = 'sent')::int        AS sent,
         count(*) FILTER (WHERE status = 'failed')::int      AS failed,
         count(*) FILTER (WHERE status = 'blocked')::int     AS blocked,
         count(*) FILTER (WHERE status = 'skipped')::int     AS skipped,
         count(*) FILTER (WHERE status = 'suppressed')::int  AS suppressed
       FROM campaign_recipients cr
       WHERE cr.campaign_id = mc.id
     ) agg ON true
     WHERE mc.channel = ANY(ARRAY['telegram', 'vk', 'max'])
     ORDER BY mc.created_at DESC`,
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    test_mode: r.test_mode,
    allowed_count: r.allowed_count,
    created_at: toIso(r.created_at) ?? '',
    audience_filter: parseAudienceFilter(r.audience_filter),
    channel: r.channel,
    funnel: {
      queued: r.queued,
      sent: r.sent,
      failed: r.failed,
      blocked: r.blocked,
      skipped: r.skipped,
      suppressed: r.suppressed,
      total: r.total,
    },
  }));
}

/**
 * Create a messenger broadcast campaign (draft, test-mode-only).
 *
 * SECURITY (R1): `test_mode = true` is HARD-FORCED here — it can never come from
 * the request body. campaign_type='messenger', status='draft' are likewise
 * server-set. The only path to test_mode=false is setCampaignLive (the explicit,
 * separately-audited go-live step).
 *
 * `channel` (default 'telegram') is derived BY THE CALLER from audience_filter.channel
 * (invariant P1-1: the column == audience_filter.channel for messenger campaigns), never
 * accepted as a separate body field. The TG path keeps its byte-for-byte behaviour because
 * the default is 'telegram'. The dispatcher discriminates on this column.
 *
 * allowedContactIds must be validated UUIDs by the caller (router); this function
 * binds them as a uuid[] param (parameterized — no string interpolation, R2).
 */
export async function createBroadcastCampaign(
  input: CreateBroadcastInput,
  userId: string | null,
  channel: 'telegram' | 'vk' | 'max' = 'telegram',
): Promise<{ id: string }> {
  const allowed = input.allowedContactIds && input.allowedContactIds.length > 0
    ? input.allowedContactIds
    : null;

  // The real target channel is mirrored into the channel COLUMN (CHECK allows telegram|max)
  // so the per-channel dispatcher selects by column. NULL filter → legacy all-telegram audience.
  const audienceFilter = input.audienceFilter ? JSON.stringify(input.audienceFilter) : null;

  const row = await db.queryOne<InsertedIdRow>(
    `INSERT INTO marketing_campaigns
       (name, channel, campaign_type, status, test_mode,
        allowed_contact_ids, broadcast_payload, audience_filter,
        utm_source, utm_medium, utm_campaign, created_by)
     VALUES ($1, $9, 'messenger', 'draft', true,
             $2::uuid[], $3::jsonb, $8::jsonb,
             $4, $5, $6, $7)
     RETURNING id`,
    [
      input.name,
      allowed,
      JSON.stringify(input.payload ?? {}),
      input.utm?.source ?? null,
      input.utm?.medium ?? null,
      input.utm?.campaign ?? null,
      userId,
      audienceFilter,
      channel,
    ],
  );
  if (!row) {
    throw new Error('Failed to create broadcast campaign');
  }
  log.info('broadcast campaign created', {
    campaignId: row.id, testMode: true, allowedCount: allowed?.length ?? 0, createdBy: userId,
  });
  return { id: row.id };
}

/** Editable snapshot of a messenger campaign — for loading into the edit composer. */
export interface CampaignEditData {
  id: string;
  name: string;
  status: string | null;
  channel: string | null;
  test_mode: boolean;
  allowed_contact_ids: string[] | null;
  audience_filter: AudienceFilter | null;
  broadcast_payload: BroadcastPayload | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
}

/** Load a messenger campaign's editable fields (any status). Null if not a messenger campaign. */
export async function getCampaignForEdit(campaignId: string): Promise<CampaignEditData | null> {
  const row = await db.queryOne<CampaignEditData>(
    `SELECT id, name, status, channel, test_mode, allowed_contact_ids,
            audience_filter, broadcast_payload, utm_source, utm_medium, utm_campaign
     FROM marketing_campaigns
     WHERE id = $1 AND channel = ANY(ARRAY['telegram','vk','max'])`,
    [campaignId],
  );
  return row ?? null;
}

/**
 * Update a DRAFT campaign's editorial fields. Guard `status='draft'` — active/sent campaigns
 * are immutable (content never changes mid-flight). Returns null if not found OR not a draft.
 * Mirrors createBroadcastCampaign's column serialization; test_mode/status are NOT changed.
 */
export async function updateBroadcastCampaign(
  campaignId: string,
  input: CreateBroadcastInput,
  channel: 'telegram' | 'vk' | 'max' = 'telegram',
): Promise<{ id: string } | null> {
  const allowed = input.allowedContactIds && input.allowedContactIds.length > 0
    ? input.allowedContactIds
    : null;
  const audienceFilter = input.audienceFilter ? JSON.stringify(input.audienceFilter) : null;
  const row = await db.queryOne<InsertedIdRow>(
    `UPDATE marketing_campaigns
     SET name = $2, channel = $9, broadcast_payload = $3::jsonb, audience_filter = $8::jsonb,
         utm_source = $4, utm_medium = $5, utm_campaign = $6,
         allowed_contact_ids = $7::uuid[], updated_at = now()
     WHERE id = $1 AND status = 'draft'
     RETURNING id`,
    [
      campaignId,
      input.name,
      JSON.stringify(input.payload ?? {}),
      input.utm?.source ?? null,
      input.utm?.medium ?? null,
      input.utm?.campaign ?? null,
      allowed,
      audienceFilter,
      channel,
    ],
  );
  if (row) {
    log.info('broadcast campaign updated (draft)', { campaignId, channel });
    return { id: row.id };
  }
  return null;
}

interface RecipientItemRow {
  id: string;
  contact_id: string;
  contact_name: string | null;
  status: string;
  error_code: string | null;
  error_detail: string | null;
  sent_at: Date | string | null;
  clicked: boolean;
  clicked_at: Date | string | null;
}

interface CampaignUtmRow {
  utm_campaign: string | null;
}

/**
 * Paginated recipients for a campaign + per-recipient click flag.
 *
 * Click attribution: cross-DB via FDW mp_fdw.ad_clicks joined on
 * utm_content = contact_id::text (each recipient's personalized URL carries
 * utm_content=<contact_id>, see ANALYTICS_TRACKING_ARCHITECTURE).
 *
 * P2-scope: the click MUST also belong to THIS campaign, otherwise a contact who clicked
 * ANY past broadcast (utm_content=contact_id is reused across campaigns) would show clicked
 * here. The tracker stores the campaign discriminator in ad_clicks.utm_campaign (verified:
 * ad_clicks.campaign_id holds the utm_campaign SLUG, e.g. 'student3', NOT our UUID — so we
 * scope on utm_campaign, not campaign_id). We pass the campaign's own utm_campaign as a
 * bound param; if the campaign has no utm_campaign, no click can be scoped to it → clicked
 * is always false (safe: attribution is impossible without the discriminator).
 *
 * A contact may have many click rows, so clicks are pre-aggregated in a LATERAL subquery
 * (max clicked_at) — exactly one output row per recipient (no fan-out).
 */
export async function getCampaignRecipients(
  campaignId: string,
  opts: { limit: number; offset: number; clickedOnly?: boolean },
): Promise<BroadcastRecipientsPage> {
  const clickedOnly = opts.clickedOnly === true;

  // Campaign's own utm_campaign — the discriminator we scope clicks to (NULL → no click match).
  const utmRow = await db.queryOne<CampaignUtmRow>(
    `SELECT utm_campaign FROM marketing_campaigns WHERE id = $1`,
    [campaignId],
  );
  const utmCampaign = utmRow?.utm_campaign ?? null;

  // total honours the active view: full audience, or only contacts who clicked the link.
  const totalRow = clickedOnly
    ? await db.queryOne<RecipientCountRow>(
        `SELECT count(*)::int AS total
         FROM campaign_recipients cr
         WHERE cr.campaign_id = $1
           AND $2::text IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM mp_fdw.ad_clicks ac
             WHERE ac.utm_content = cr.contact_id::text
               AND ac.utm_campaign = $2
           )`,
        [campaignId, utmCampaign],
      )
    : await db.queryOne<RecipientCountRow>(
        `SELECT count(*)::int AS total FROM campaign_recipients WHERE campaign_id = $1`,
        [campaignId],
      );
  const total = totalRow?.total ?? 0;

  // clickedOnly → keep only rows with a click and surface most-recent clickers first;
  // otherwise newest-created first. Both orders carry cr.id DESC as a unique tie-breaker so
  // pagination is STABLE — without it, the whole audience shares one bulk-INSERT created_at
  // and rows reshuffle across pages (a contact appearing on every page).
  const clickFilter = clickedOnly ? 'AND clk.clicked_at IS NOT NULL' : '';
  const orderBy = clickedOnly
    ? 'ORDER BY clk.clicked_at DESC NULLS LAST, cr.id DESC'
    : 'ORDER BY cr.created_at DESC, cr.id DESC';

  const rows = await db.query<RecipientItemRow>(
    `SELECT
       cr.id,
       cr.contact_id,
       c.display_name AS contact_name,
       cr.status,
       cr.error_code,
       cr.error_detail,
       cr.sent_at,
       (clk.clicked_at IS NOT NULL) AS clicked,
       clk.clicked_at
     FROM campaign_recipients cr
     LEFT JOIN contacts c ON c.id = cr.contact_id
     LEFT JOIN LATERAL (
       SELECT max(ac.clicked_at) AS clicked_at
       FROM mp_fdw.ad_clicks ac
       WHERE ac.utm_content = cr.contact_id::text
         AND ac.utm_campaign = $4
     ) clk ON true
     WHERE cr.campaign_id = $1
       ${clickFilter}
     ${orderBy}
     LIMIT $2 OFFSET $3`,
    [campaignId, opts.limit, opts.offset, utmCampaign],
  );

  const items: BroadcastRecipientItem[] = rows.map((r) => ({
    id: r.id,
    contact_id: r.contact_id,
    contact_name: r.contact_name,
    status: r.status,
    error_code: r.error_code,
    error_detail: r.error_detail,
    sent_at: toIso(r.sent_at),
    clicked: r.clicked === true,
    clicked_at: toIso(r.clicked_at),
  }));

  return { items, total };
}

/**
 * Flip a campaign to test_mode=false — the SINGLE explicit "send to everyone" step.
 * Guarded to channel IN (telegram, max) so it can never touch a CRM campaign. Returns
 * the post-flip test_mode so the caller can confirm the transition. The test_mode gate
 * is NOT weakened — this audited step is still the only path out of test mode.
 */
export async function setCampaignLive(campaignId: string): Promise<{ id: string; test_mode: boolean }> {
  const row = await db.queryOne<GoLiveRow>(
    `UPDATE marketing_campaigns
     SET test_mode = false, updated_at = now()
     WHERE id = $1 AND channel = ANY(ARRAY['telegram', 'vk', 'max'])
     RETURNING id, test_mode`,
    [campaignId],
  );
  if (!row) {
    throw new Error(`Broadcast campaign ${campaignId} not found`);
  }
  log.warn('broadcast campaign promoted to LIVE (test_mode=false)', { campaignId });
  return { id: row.id, test_mode: row.test_mode };
}
