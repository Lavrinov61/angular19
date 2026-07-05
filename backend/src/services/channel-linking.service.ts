/**
 * Channel Linking Service — привязка мессенджер-каналов к личному кабинету.
 *
 * Поддерживаемые методы привязки:
 * - deep_link: Telegram deep link (t.me/bot?start=LINK_xxx)
 * - oauth: VK ID OAuth (users.vk_id → channel_users)
 * - phone_match: WhatsApp по совпадению телефона
 * - auto: автоматическая через contacts.user_id
 * - admin: ручная привязка оператором
 */

import crypto from 'crypto';
import db from '../database/db.js';
import { createResilientRedis, isRedisReady } from './redis-factory.js';
import { createLogger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import { findOrCreateContact, linkContactToUser, normalizePhone } from './contact.service.js';
import type ChannelUsers from '../types/generated/public/ChannelUsers.js';

const log = createLogger('channel-linking');

// ─── Redis для link tokens (TTL 10 мин) ─────────────────────

const redis = createResilientRedis('channel-link', { keyPrefix: 'chlink:', lazyConnect: true });
redis.connect().catch((err: unknown) => {
  log.warn('Redis connect failed for channel-link, falling back to in-memory', {
    error: err instanceof Error ? err.message : String(err),
  });
});

const LINK_TOKEN_TTL_SEC = 600; // 10 минут
const LINK_TOKEN_PREFIX = 'link:';

type LinkMethod = 'auto' | 'deep_link' | 'oauth' | 'phone_match' | 'admin';

const SUPPORTED_CHANNELS = ['telegram', 'vk', 'whatsapp', 'max'] as const;
type SupportedChannel = typeof SUPPORTED_CHANNELS[number];

interface LinkTokenPayload {
  userId: string;
  channel: SupportedChannel;
  phone: string;
  contactId: string;
}

interface AccountLinkIdentity {
  userId: string;
  phone: string;
  phoneLast10: string;
  contactId: string;
  displayName: string | null;
}

interface UserLinkIdentityRow {
  id: string;
  phone: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

interface LinkTokenRecord {
  userId?: unknown;
  channel?: unknown;
  phone?: unknown;
  contactId?: unknown;
}

interface VkIdentityRow {
  vk_id: string | null;
}

interface TelegramIdentityRow {
  telegram_id: string | null;
}

interface UserIdRow {
  user_id: string;
}

/** Результат привязки для API ответа */
export interface LinkedChannel {
  id: string;
  channel: string;
  display_name: string | null;
  username: string | null;
  verified_at: string | null;
  linked_by: string | null;
  external_user_id: string;
}

function isLinkTokenRecord(value: unknown): value is LinkTokenRecord {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isSupportedChannel(value: string | null): value is SupportedChannel {
  return value !== null && (SUPPORTED_CHANNELS as readonly string[]).includes(value);
}

function parseLinkTokenPayload(raw: string): LinkTokenPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isLinkTokenRecord(parsed)) return null;

    const userId = readString(parsed.userId);
    const channel = readString(parsed.channel);
    const phone = readString(parsed.phone);
    const contactId = readString(parsed.contactId);

    if (!userId || !phone || !contactId) return null;
    if (!isSupportedChannel(channel)) return null;

    return { userId, channel, phone, contactId };
  } catch {
    return null;
  }
}

function buildDisplayName(user: UserLinkIdentityRow): string | null {
  const first = user.first_name?.trim() ?? '';
  const last = user.last_name?.trim() ?? '';
  if (first || last) return `${first} ${last}`.trim();
  return user.display_name?.trim() || user.email;
}

async function getAccountLinkIdentity(userId: string): Promise<AccountLinkIdentity> {
  const user = await db.queryOne<UserLinkIdentityRow>(
    `SELECT id, phone, display_name, first_name, last_name, email
     FROM users
     WHERE id = $1`,
    [userId],
  );

  if (!user) {
    throw new AppError(404, 'Пользователь не найден', 'user_not_found');
  }

  const phone = user.phone ? normalizePhone(user.phone) : null;
  if (!phone) {
    throw new AppError(
      409,
      'Укажите номер телефона в аккаунте перед привязкой мессенджеров',
      'phone_required',
    );
  }

  const contact = await findOrCreateContact({
    phone,
    email: user.email,
    displayName: buildDisplayName(user),
    source: 'account',
  });

  if (contact.user_id && contact.user_id !== userId) {
    throw new AppError(
      409,
      'Этот номер телефона уже связан с другим аккаунтом',
      'phone_conflict',
    );
  }

  await linkContactToUser(contact.id, userId);

  return {
    userId,
    phone,
    phoneLast10: phone.slice(-10),
    contactId: contact.id,
    displayName: buildDisplayName(user),
  };
}

async function linkChannelByPhone(
  identity: AccountLinkIdentity,
  channel: SupportedChannel,
): Promise<LinkedChannel | null> {
  return db.queryOne<LinkedChannel>(
    `UPDATE channel_users cu
     SET user_id = $1,
         verified_at = NOW(),
         linked_by = 'phone_match',
         phone = $2,
         contact_id = $3
     WHERE cu.channel = $4
       AND (cu.user_id IS NULL OR cu.user_id = $1)
       AND (
         cu.contact_id = $3
         OR RIGHT(regexp_replace(COALESCE(cu.phone, ''), '\\D', '', 'g'), 10) = $5
         OR EXISTS (
           SELECT 1
           FROM contacts c
           WHERE c.id = cu.contact_id
             AND c.deleted_at IS NULL
             AND RIGHT(regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g'), 10) = $5
         )
       )
     RETURNING cu.id, cu.channel, cu.display_name, cu.username, cu.verified_at, cu.linked_by, cu.external_user_id`,
    [identity.userId, identity.phone, identity.contactId, channel, identity.phoneLast10],
  );
}

async function linkChannelByExternalUserId(
  identity: AccountLinkIdentity,
  channel: SupportedChannel,
  externalUserId: string,
  linkedBy: LinkMethod,
): Promise<LinkedChannel | null> {
  return db.queryOne<LinkedChannel>(
    `INSERT INTO channel_users (
       channel, external_user_id, display_name, phone, contact_id, user_id, verified_at, linked_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
     ON CONFLICT (channel, external_user_id) DO UPDATE SET
       display_name = COALESCE(channel_users.display_name, EXCLUDED.display_name),
       phone = EXCLUDED.phone,
       contact_id = EXCLUDED.contact_id,
       user_id = EXCLUDED.user_id,
       verified_at = NOW(),
       linked_by = EXCLUDED.linked_by
     WHERE channel_users.user_id IS NULL OR channel_users.user_id = EXCLUDED.user_id
     RETURNING id, channel, display_name, username, verified_at, linked_by, external_user_id`,
    [channel, externalUserId, identity.displayName, identity.phone, identity.contactId, identity.userId, linkedBy],
  );
}

// ─── Публичные методы ────────────────────────────────────────

/**
 * Получить все привязанные каналы пользователя.
 */
export async function getLinkedChannels(userId: string): Promise<LinkedChannel[]> {
  return db.query<LinkedChannel>(
    `SELECT id, channel, display_name, username, verified_at, linked_by, external_user_id
     FROM channel_users
     WHERE user_id = $1
     ORDER BY channel`,
    [userId],
  );
}

/**
 * Сгенерировать одноразовый токен для deep link привязки.
 * Сохраняется в Redis с TTL 10 мин.
 */
export async function generateLinkToken(
  userId: string,
  channel: SupportedChannel,
): Promise<string> {
  // Проверить что у пользователя ещё нет привязки к этому каналу
  const existing = await db.queryOne<ChannelUsers>(
    'SELECT id FROM channel_users WHERE user_id = $1 AND channel = $2',
    [userId, channel],
  );
  if (existing) {
    throw new AppError(409, `Канал ${channel} уже привязан`, 'channel_already_linked');
  }

  const identity = await getAccountLinkIdentity(userId);

  const token = crypto.randomBytes(24).toString('hex');
  const payload: LinkTokenPayload = {
    userId,
    channel,
    phone: identity.phone,
    contactId: identity.contactId,
  };

  if (isRedisReady(redis)) {
    await redis.set(
      `${LINK_TOKEN_PREFIX}${token}`,
      JSON.stringify(payload),
      'EX',
      LINK_TOKEN_TTL_SEC,
    );
  } else {
    throw new AppError(503, 'Сервис привязки временно недоступен', 'link_token_unavailable');
  }

  return token;
}

/**
 * Верифицировать link token и привязать channel_user к ЛК.
 * Вызывается из callback бота.
 */
export async function verifyLinkToken(
  token: string,
  externalUserId: string,
  channel: SupportedChannel,
): Promise<{ success: boolean; channelUserId?: string }> {
  if (!isRedisReady(redis)) {
    throw new AppError(503, 'Сервис привязки временно недоступен', 'link_token_unavailable');
  }

  const key = `${LINK_TOKEN_PREFIX}${token}`;
  const raw = await redis.get(key);
  if (!raw) {
    return { success: false };
  }

  const payload = parseLinkTokenPayload(raw);
  if (!payload || payload.channel !== channel) {
    return { success: false };
  }

  // Удалить токен (одноразовый)
  await redis.del(key);

  const identity = await getAccountLinkIdentity(payload.userId);
  if (identity.phone !== payload.phone || identity.contactId !== payload.contactId) {
    return { success: false };
  }

  const linked = await linkChannelByExternalUserId(
    identity,
    channel,
    externalUserId,
    'deep_link',
  );

  return linked ? { success: true, channelUserId: linked.id } : { success: false };
}

/**
 * Автопривязка VK через OAuth (users.vk_id → channel_users.external_user_id).
 */
export async function linkVk(userId: string): Promise<LinkedChannel | null> {
  const identity = await getAccountLinkIdentity(userId);
  const byPhone = await linkChannelByPhone(identity, 'vk');
  if (byPhone) return byPhone;

  const user = await db.queryOne<VkIdentityRow>(
    'SELECT vk_id FROM users WHERE id = $1',
    [userId],
  );

  if (!user?.vk_id) {
    return null;
  }

  return linkChannelByExternalUserId(identity, 'vk', user.vk_id, 'oauth');
}

/**
 * Привязка Telegram через users.telegram_id.
 */
export async function linkTelegram(userId: string): Promise<LinkedChannel | null> {
  const identity = await getAccountLinkIdentity(userId);
  const byPhone = await linkChannelByPhone(identity, 'telegram');
  if (byPhone) return byPhone;

  const user = await db.queryOne<TelegramIdentityRow>(
    'SELECT telegram_id FROM users WHERE id = $1',
    [userId],
  );

  if (!user?.telegram_id) {
    return null;
  }

  return linkChannelByExternalUserId(identity, 'telegram', user.telegram_id, 'auto');
}

/**
 * Привязка WhatsApp по совпадению телефона.
 * Ищет channel_users.phone или contacts.phone → channel_users через contact_id.
 */
export async function linkWhatsapp(userId: string): Promise<LinkedChannel | null> {
  const identity = await getAccountLinkIdentity(userId);
  return linkChannelByPhone(identity, 'whatsapp');
}

/**
 * Отвязать канал от пользователя.
 */
export async function unlinkChannel(
  userId: string,
  channel: string,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE channel_users
     SET user_id = NULL, verified_at = NULL, linked_by = NULL
     WHERE user_id = $1 AND channel = $2
     RETURNING id`,
    [userId, channel],
  );

  return result.length > 0;
}

/**
 * Найти user_id по каналу и external_user_id.
 * Используется для lookup при входящих сообщениях.
 */
export async function findUserByChannel(
  channel: string,
  externalUserId: string,
): Promise<string | null> {
  const row = await db.queryOne<UserIdRow>(
    'SELECT user_id FROM channel_users WHERE channel = $1 AND external_user_id = $2 AND user_id IS NOT NULL',
    [channel, externalUserId],
  );

  return row?.user_id ?? null;
}
