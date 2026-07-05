/**
 * VK send-layer — отправка ОДНОГО получателя VK-кампании.
 *
 * Изолирован от живого TG-пути (campaign.service.sendToRecipient): своя классификация
 * кодов ошибок VK, свой governor (vk:group:*), свой adapter ('vk'). Но переиспользует
 * shared delivery-state контракт из campaign.service (CAS-lease, markFailed-бэкофф,
 * withUtm, типы) — два движка делят одну таблицу campaign_recipients и одинаковую
 * семантику ретраев.
 *
 * Гарантии (повторяют TG, см. campaign.service §8):
 *  - CAS-lease (атомарный UPDATE queued/failed → бамп next_attempt_at на CLAIM_LEASE_MS)
 *    защищает от двойной отправки конкурентными воркерами; 0 рядов → 'skipped'.
 *  - external_message_id='vk:'||message_id ставится РОВНО ОДИН РАЗ (guard IS NULL) — вместе
 *    с детерминированным random_id адаптера это двойной барьер против дубля при ретрае.
 *  - 429-аналог VK (code 6/9) — НИКОГДА не статус получателя: это глобальная backpressure
 *    группы → pauseVkGroup(token) + ряд остаётся 'queued' + next_attempt_at, попытка НЕ
 *    расходуется, воркер уступает (yield). 6 = короткая пауза, 9 (flood) = длинная (≥10с).
 *  - 14 CAPTCHA → terminal 'failed' + алерт (НЕ ретраить — нужен человек, иначе бан группы).
 *  - 901/902/936 → terminal 'blocked' + marketing_suppressions (больше не таргетим).
 *  - 5xx/сеть/прочее → бэкофф 'failed' (до max_attempts), как TG.
 */

import db from '../../../database/db.js';
import type { PoolClient } from 'pg';
import { createLogger } from '../../../utils/logger.js';
import { captureException } from '../../../utils/error-tracker.js';
import { getAccountByChannel } from '../../connectors/core/account-store.js';
import { getAdapterOrThrow } from '../../connectors/core/adapter-registry.js';
import type { VkAdapter, VkBroadcastButton } from '../../connectors/vk/vk.adapter.js';
import {
  markFailed,
  withUtm,
  CLAIM_LEASE_MS,
  type RecipientRow,
  type PayloadSnapshot,
  type SendOutcome,
} from '../campaign.service.js';
import { pauseVkGroup } from './vk-broadcast-governor.js';
import {
  VK_BCAST_UNSUB,
  VK_BCAST_NOT_STUDENT,
  VK_BCAST_ADDRESSES,
} from './vk-broadcast-callbacks.constants.js';

const log = createLogger('vk-send.service');

// Пауза группы после code 6 (too many requests/sec) — короткая, как TG 429-cap.
const VK_RATE_PAUSE_MS = 5_000;
// Пауза после code 9 (flood control) — VK строже: минимум 10с (research-vk-api-rules §В).
const VK_FLOOD_PAUSE_MS = 10_000;

/** VK error codes (research-vk-api-rules §В). */
const VK_ERR_TOO_MANY_PER_SEC = 6;   // короткая пауза + retry
const VK_ERR_FLOOD_CONTROL = 9;      // длинная пауза + retry
const VK_ERR_CAPTCHA = 14;           // STOP: terminal + alert, НЕ ретраить
const VK_ERR_USER_BLOCK = 901;       // нет разрешения от пользователя → blocked+suppress
const VK_ERR_DENY_SEND = 902;        // приватность пользователя → blocked+suppress
const VK_ERR_CONTACT_NOT_FOUND = 936; // контакт недоступен → blocked+suppress

interface CampaignUtmRow {
  id: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
}

/**
 * Клавиатура VK-рассылки: одна URL-кнопка «🌐 Подробнее на сайте» с ПЕР-ПОЛУЧАТЕЛЬСКИМ
 * UTM (utm_content=contact_id + campaign_id + utm_term=peer_id) + три callback-кнопки
 * (адреса / не студент / отписаться). 1 URL + 3 callback в пределах лимитов VK (≤6 рядов,
 * ≤5 в ряду). Callback-кнопки ВСЕГДА присутствуют — кнопка «Отписаться» обязательна
 * (анти-бан, см. бриф).
 */
function buildVkKeyboard(
  snapshot: PayloadSnapshot | null,
  utm: { source: string | null; medium: string | null; campaign: string | null },
  contactId: string,
  campaignId: string,
  peerId: string,
  landingUrl: string,
): VkBroadcastButton[][] {
  const rows: VkBroadcastButton[][] = [];

  // URL-кнопки кампании (если заданы) — каждой добавляем пер-получательский UTM.
  if (snapshot?.buttons && snapshot.buttons.length > 0) {
    for (const row of snapshot.buttons) {
      rows.push(row.map((b) => ({ text: b.text, url: withUtm(b.url, utm, contactId, campaignId, peerId) })));
    }
  } else {
    // Нет кастомных кнопок → одна дефолтная ссылка на лендинг с пер-получательским UTM.
    rows.push([{ text: '🌐 Подробнее на сайте', url: withUtm(landingUrl, utm, contactId, campaignId, peerId) }]);
  }

  // Три фиксированные callback-кнопки (как у TG).
  rows.push([{ text: '📍 Наши адреса', callback_data: VK_BCAST_ADDRESSES }]);
  rows.push([
    { text: '🙋 Я не студент', callback_data: VK_BCAST_NOT_STUDENT },
    { text: '❌ Отписаться', callback_data: VK_BCAST_UNSUB },
  ]);
  return rows;
}

/**
 * Отправить одного VK-получателя. Возвращает SendOutcome (как TG sendToRecipient), чтобы
 * воркер одинаково уступал на rate_limited.
 */
export async function sendToVkRecipient(recipientId: string): Promise<SendOutcome> {
  // CAS-lease: атомарно берём dispatchable-ряд. Бамп attempts здесь НЕ делаем (6/9 не должны
  // жечь попытки). 0 рядов → другой воркер владеет/закончил ИЛИ лиз активен → НЕ шлём.
  const claim = await db.query<RecipientRow>(
    `UPDATE campaign_recipients
     SET next_attempt_at = now() + ($2::int || ' milliseconds')::interval, updated_at = now()
     WHERE id = $1
       AND channel = 'vk'
       AND status IN ('queued','failed')
       AND (next_attempt_at IS NULL OR next_attempt_at <= now())
     RETURNING id, contact_id, external_chat_id, personalized_url, payload_snapshot,
               attempts, max_attempts`,
    [recipientId, CLAIM_LEASE_MS],
  );
  if (claim.length === 0) {
    log.debug('vk recipient not claimable (already handled) — skipping', { recipientId });
    return { status: 'skipped' };
  }
  const row = claim[0];

  // UTM кампании для пер-получательской персонализации ссылок в момент отправки.
  const camp = await db.queryOne<CampaignUtmRow>(
    `SELECT mc.id, mc.utm_source, mc.utm_medium, mc.utm_campaign
     FROM campaign_recipients cr
     JOIN marketing_campaigns mc ON mc.id = cr.campaign_id
     WHERE cr.id = $1`,
    [recipientId],
  );
  const campaignId = camp?.id ?? '';
  const utm = {
    source: camp?.utm_source ?? null,
    medium: camp?.utm_medium ?? null,
    campaign: camp?.utm_campaign ?? null,
  };

  const snapshot = row.payload_snapshot;
  const mediaUrl = snapshot?.mediaUrl ?? null;
  const caption = snapshot?.text ?? undefined;

  if (!mediaUrl) {
    // v1 VK-рассылка — фото+подпись; без media отправить нечем → terminal (не ретраить).
    await markFailed(recipientId, row, 'no_media', 'vk broadcast payload has no mediaUrl', true);
    log.error('vk recipient has no mediaUrl — marking failed', { recipientId, campaignId });
    return { status: 'failed' };
  }

  // Лендинг для дефолтной кнопки — из персонализированного URL (он уже несёт UTM кампании),
  // иначе пер-получательский UTM добавит withUtm поверх базы.
  const landingUrl = row.personalized_url || 'https://svoefoto.ru';
  const keyboard = buildVkKeyboard(snapshot, utm, row.contact_id, campaignId, row.external_chat_id, landingUrl);

  // VK-аккаунт + адаптер.
  const account = await getAccountByChannel('vk');
  if (!account) {
    await markFailed(recipientId, row, 'no_account', 'no active vk channel account', false);
    log.error('no active vk account for broadcast', { recipientId });
    return { status: 'failed' };
  }
  const groupToken = typeof account.credentials?.['groupToken'] === 'string'
    ? (account.credentials['groupToken'] as string)
    : '';
  // sendMediaWithKeyboard — VK-специфика, её нет в базовом ChannelAdapter. Registry для
  // 'vk' всегда регистрирует VkAdapter (adapter-registry.ts), поэтому сужаем тип к VkAdapter.
  const adapter: VkAdapter = getAdapterOrThrow('vk') as VkAdapter;

  // Отправка: фото + подпись + keyboard. idempotencyKey = ряд получателя → детерминированный
  // random_id (VK дедуплицирует ретрай того же сообщения).
  const result = await adapter.sendMediaWithKeyboard(
    account,
    row.external_chat_id,
    mediaUrl,
    caption,
    keyboard,
    row.id,
  );

  // ── Успех ────────────────────────────────────────────────────────────────
  if (result.success) {
    // Guard external_message_id IS NULL: ставим 'sent' и метку ровно один раз.
    // Адаптер уже возвращает externalMessageId с префиксом 'vk:' (vk.adapter.ts:989) — НЕ префиксим повторно.
    const externalMessageId = result.externalMessageId ?? null;
    await db.query(
      `UPDATE campaign_recipients
       SET status = 'sent', sent_at = now(), external_message_id = $2,
           error_code = NULL, error_detail = NULL, updated_at = now()
       WHERE id = $1 AND external_message_id IS NULL`,
      [recipientId, externalMessageId],
    );
    log.info('vk recipient sent', { recipientId, campaignId, externalMessageId });
    return { status: 'sent' };
  }

  const errorCode = result.errorCode ?? '';
  const errorMessage = result.errorMessage ?? '';
  const codeNum = Number(errorCode);

  // ── code 6 / 9: глобальная backpressure группы (НИКОГДА не статус получателя) ─
  if (codeNum === VK_ERR_TOO_MANY_PER_SEC || codeNum === VK_ERR_FLOOD_CONTROL) {
    const pauseMs = codeNum === VK_ERR_FLOOD_CONTROL ? VK_FLOOD_PAUSE_MS : VK_RATE_PAUSE_MS;
    if (groupToken) await pauseVkGroup(groupToken, pauseMs);
    // Ряд остаётся 'queued', планируем ретрай; попытка НЕ расходуется.
    await db.query(
      `UPDATE campaign_recipients
       SET status = 'queued', next_attempt_at = now() + ($2::int || ' milliseconds')::interval,
           error_code = $3, error_detail = $4, updated_at = now()
       WHERE id = $1`,
      [recipientId, pauseMs, String(codeNum), errorMessage.slice(0, 500)],
    );
    log.warn('vk recipient rate-limited — group paused, row left queued', {
      recipientId, campaignId, code: codeNum, pauseMs,
    });
    return { status: 'rate_limited', retryAfterMs: pauseMs };
  }

  // ── code 14 CAPTCHA: STOP. Terminal + алерт; НЕ ретраить (нужен человек) ─────
  if (codeNum === VK_ERR_CAPTCHA) {
    await markFailed(recipientId, row, '14', errorMessage || 'captcha needed', true);
    captureException(new Error(`VK broadcast CAPTCHA (code 14) — campaign ${campaignId} needs manual intervention`), {
      tags: { worker: 'vk-broadcast', vkError: '14' },
      extra: { recipientId, campaignId },
      level: 'error',
    });
    log.error('vk recipient CAPTCHA (code 14) — STOP, terminal failed + alert', { recipientId, campaignId });
    return { status: 'failed' };
  }

  // ── code 901/902/936: получатель недоступен → terminal 'blocked' + suppress ──
  if (codeNum === VK_ERR_USER_BLOCK || codeNum === VK_ERR_DENY_SEND || codeNum === VK_ERR_CONTACT_NOT_FOUND) {
    await db.transaction(async (client: PoolClient) => {
      await client.query(
        `UPDATE campaign_recipients
         SET status = 'blocked', failed_at = now(), error_code = $2, error_detail = $3, updated_at = now()
         WHERE id = $1`,
        [recipientId, String(codeNum), errorMessage.slice(0, 500)],
      );
      await client.query(
        `INSERT INTO marketing_suppressions (contact_id, external_chat_id, reason)
         VALUES ($1, $2, 'hard_bounce')
         ON CONFLICT (contact_id) WHERE contact_id IS NOT NULL DO NOTHING`,
        [row.contact_id, row.external_chat_id || null],
      );
      // Гасим opt-in в channel_users — пользователь отозвал разрешение/закрыл приватность.
      await client.query(
        `UPDATE channel_users
         SET opted_in = false, opted_out_at = COALESCE(opted_out_at, now())
         WHERE channel = 'vk' AND external_user_id = $1`,
        [row.external_chat_id],
      );
    });
    log.warn('vk recipient blocked — suppressed', { recipientId, campaignId, code: codeNum });
    return { status: 'blocked' };
  }

  // ── Прочие 4xx HTTP (не VK-бизнес-код) → terminal, no retry ─────────────────
  if (Number.isInteger(codeNum) && codeNum >= 400 && codeNum < 500) {
    await markFailed(recipientId, row, errorCode, errorMessage, true);
    log.warn('vk recipient send failed (terminal 4xx — not retried)', { recipientId, campaignId, errorCode });
    return { status: 'failed' };
  }

  // ── 5xx / сеть / прочее → ретраибельный бэкофф, terminal 'failed' после max ──
  await markFailed(recipientId, row, errorCode || 'send_error', errorMessage, false);
  log.warn('vk recipient send failed (retryable)', {
    recipientId, campaignId, errorCode, attempts: row.attempts + 1, max: row.max_attempts,
  });
  return { status: 'failed' };
}
