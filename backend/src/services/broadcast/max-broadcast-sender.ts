/**
 * MAX Broadcast Sender — per-recipient send for the MAX broadcast line.
 *
 * TODO(P2): дублёр sendToRecipient (campaign.service.ts) — синхронизировать при правке
 *   TG-классификатора ошибок/CAS-lease/backoff. Слить в channel-strategy после завершения
 *   живой TG-кампании (см. 30-architecture.md «отвергнутые/follow-up»).
 *
 * This is a deliberate copy of campaign.service.sendToRecipient (the hot TG path is NOT
 * touched while the live Telegram campaign runs). Behaviour is byte-for-byte identical
 * EXCEPT:
 *   - account = getAccountByChannel('max'), adapter = MaxAdapter, token = credentials.accessToken;
 *   - send via MaxAdapter.sendBroadcast (image + text + buttons in ONE message);
 *   - keyboard built by buildMaxBroadcastKeyboard (MAX button shape, not TG inline);
 *   - governor = MAX (pauseMax/isMaxPaused), separate Redis namespace;
 *   - 429 backoff is an EXPLICIT fixed MAX_429_BACKOFF_MS=30000 (MAX never returns retryAfter,
 *     so the TG formula Math.min((retryAfter??1)*1000,…) would degenerate to 1s);
 *   - block classification is CONSERVATIVE (only errorCode==='403' → blocked+suppression);
 *     the TG regex /blocked|deactivated|chat not found/ is NOT copied (MAX error texts differ).
 */

import db from '../../database/db.js';
import type { PoolClient } from 'pg';
import { createLogger } from '../../utils/logger.js';
import { pauseMax } from './max-broadcast-governor.js';
import { BCAST_UNSUB, BCAST_NOT_STUDENT, BCAST_ADDRESSES } from './broadcast-callbacks.constants.js';
import { getAccountByChannel } from '../connectors/core/account-store.js';
import { getAdapterOrThrow } from '../connectors/core/adapter-registry.js';
import type { MaxAdapter } from '../connectors/max/max.adapter.js';
import {
  withUtm,
  type PayloadSnapshot,
  type RecipientRow,
  type SendOutcome,
} from './campaign.service.js';

const log = createLogger('max-broadcast-sender');

/**
 * UTM parts for per-recipient link personalization. Structurally identical to the (private)
 * UtmParts in campaign.service — kept local since that type is not exported and S6 (the hot
 * TG file) is owned by another slice.
 */
interface UtmParts {
  source: string | null;
  medium: string | null;
  campaign: string | null;
}

// Transactional backoff base: mirror campaign.service (5000·2^(n-1)).
const BACKOFF_BASE_MS = 5_000;

// 429 backoff: MAX does not return retry_after — the TG formula Math.min((retryAfter??1)*1000,…)
// would degenerate to 1s and hammer the bot. Use an explicit fixed pause (P1-3/P1-5).
const MAX_429_BACKOFF_MS = 30_000;

/**
 * Lease window mirrors the MAX broadcast worker lockDuration (5 min) so a crashed worker's
 * row is reclaimable by the reconciler after the lease expires, never stuck. Same constant
 * as campaign.service.CLAIM_LEASE_MS / TG worker lockDuration.
 */
const CLAIM_LEASE_MS = 5 * 60 * 1000;

/** MAX inline-keyboard button shape (passed to MaxAdapter.sendBroadcast). */
type MaxButton =
  | { type: 'link'; text: string; url: string }
  | { type: 'callback'; text: string; payload: string };

/**
 * Build the MAX inline keyboard: payload URL-buttons (with per-recipient UTM, incl.
 * utm_term=external_chat_id) followed by fixed callback rows — «📍 Наши адреса»,
 * «🙋 Я не студент» + «❌ Отписаться». The callback rows are ALWAYS present, even when
 * the campaign has no URL-buttons. Mirrors campaign.service.buildInlineKeyboard but uses
 * the MAX `{type:'link'|'callback'}` shape instead of TG `{url|callback_data}`.
 */
function buildMaxBroadcastKeyboard(
  snapshot: PayloadSnapshot | null,
  utm: UtmParts,
  contactId: string,
  campaignId: string,
  externalChatId: string | null,
): MaxButton[][] {
  const rows: MaxButton[][] = [];
  if (snapshot?.buttons && snapshot.buttons.length > 0) {
    for (const row of snapshot.buttons) {
      rows.push(
        row.map((b) => ({
          type: 'link' as const,
          text: b.text,
          url: withUtm(b.url, utm, contactId, campaignId, externalChatId),
        })),
      );
    }
  }
  // Служебные callback-кнопки. NULL serviceButtons → обе включены (legacy). «❌ Отписаться» —
  // всегда (антиспам/152-ФЗ), флагами не управляется.
  const sb = snapshot?.serviceButtons;
  if (sb?.addresses ?? true) {
    rows.push([{ type: 'callback', text: '📍 Наши адреса', payload: BCAST_ADDRESSES }]);
  }
  const lastRow: MaxButton[] = [];
  if (sb?.notStudent ?? true) {
    lastRow.push({ type: 'callback', text: '🙋 Я не студент', payload: BCAST_NOT_STUDENT });
  }
  lastRow.push({ type: 'callback', text: '❌ Отписаться', payload: BCAST_UNSUB });
  rows.push(lastRow);
  return rows;
}

/**
 * Send one MAX recipient. Double-send protection is a DB-level CAS lease (identical to
 * campaign.service.sendToRecipient): a single atomic UPDATE takes the row only if it is
 * dispatchable (status queued/failed AND not already leased), pushing `next_attempt_at`
 * into the future as an in-flight lease. A concurrent worker on the same row gets 0 rows
 * → 'skipped' (no send).
 */
export async function sendToRecipientMax(recipientId: string): Promise<SendOutcome> {
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
  const caption = snapshot?.text ?? '';
  const keyboard = buildMaxBroadcastKeyboard(snapshot, utm, row.contact_id, campaignId, row.external_chat_id);

  if (!mediaUrl) {
    // v1 broadcast is a photo+caption; without media we cannot send via sendBroadcast.
    // Treat as a permanent content error for this recipient (not retryable).
    await markFailed(recipientId, row, 'no_media', 'broadcast payload has no mediaUrl', true);
    log.error('recipient has no mediaUrl — marking failed', { recipientId, campaignId });
    return { status: 'failed' };
  }

  // Resolve the MAX bot account + adapter.
  const account = await getAccountByChannel('max');
  if (!account) {
    await markFailed(recipientId, row, 'no_account', 'no active max channel account', false);
    log.error('no active max account for broadcast', { recipientId });
    return { status: 'failed' };
  }
  const accessToken = typeof account.credentials?.['accessToken'] === 'string'
    ? (account.credentials['accessToken'] as string)
    : '';
  const adapter = getAdapterOrThrow('max') as MaxAdapter;

  // Send: photo + caption + inline buttons (per-recipient UTM already baked in) in ONE message.
  const result = await adapter.sendBroadcast(
    account,
    row.external_chat_id,
    mediaUrl,
    caption,
    keyboard,
  );

  // ── Success ──────────────────────────────────────────────────────────────
  if (result.success) {
    // Guard `external_message_id IS NULL`: stamp 'sent' only ONCE. A stalled-job reclaim
    // of a slow media upload could run this twice; the guard means the second write is a
    // no-op rather than overwriting/duplicating the delivery record.
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
    // MAX does not return retry_after → explicit fixed pause (P1-3/P1-5), NOT the TG formula.
    const retryAfterMs = MAX_429_BACKOFF_MS;
    // Pause the MAX token (separate namespace; does NOT touch the live TG governor).
    if (accessToken) await pauseMax(accessToken, retryAfterMs);
    // Leave the row 'queued', schedule its retry; attempt is NOT consumed.
    await db.query(
      `UPDATE campaign_recipients
       SET status = 'queued', next_attempt_at = now() + ($2::int || ' milliseconds')::interval,
           error_code = '429', error_detail = $3, updated_at = now()
       WHERE id = $1`,
      [recipientId, retryAfterMs, errorMessage.slice(0, 500)],
    );
    log.warn('recipient rate-limited (429) — max token paused, row left queued', {
      recipientId, campaignId, retryAfterMs,
    });
    return { status: 'rate_limited', retryAfterMs };
  }

  // ── 403 → terminal 'blocked' + suppress ─────────────────────────────────────
  // CONSERVATIVE classifier (P1-6): MAX error texts differ from Telegram, so we do NOT copy
  // the TG regex /blocked|deactivated|chat not found/ blindly. Only an explicit 403 is treated
  // as a hard block. TODO(S8): collect real MAX error codes/texts for a blocked chat on the
  // live smoke and widen this classifier if needed.
  if (errorCode === '403') {
    await db.transaction(async (client: PoolClient) => {
      await client.query(
        `UPDATE campaign_recipients
         SET status = 'blocked', failed_at = now(), error_code = $2, error_detail = $3, updated_at = now()
         WHERE id = $1`,
        [recipientId, errorCode, errorMessage.slice(0, 500)],
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
  // retry. 403 is already handled above; everything else in 400-499 fails permanently here.
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
 *
 * Byte-for-byte copy of campaign.service.markFailed (private there); kept local to avoid
 * touching the hot TG file.
 */
async function markFailed(
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
