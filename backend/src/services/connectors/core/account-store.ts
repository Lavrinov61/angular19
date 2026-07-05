/**
 * Omnichannel v2 — Account Store
 *
 * CRUD operations for `channel_accounts` table with in-memory credential cache.
 * Replaces config.* singleton credential access — each adapter receives
 * ChannelAccount explicitly from this store.
 */

import db from '../../../database/db.js';
import { config } from '../../../config/index.js';
import type { ChannelType, ChannelAccount, ChannelCapabilities } from './types.js';
import { createLogger } from '../../../utils/logger.js';
import { cacheGet, cacheSet, cacheDel, getCrmRedis } from '../../../services/redis-cache.service.js';

const log = createLogger('account-store');

// --- Cache (Redis-backed for multi-node) ---

const ACCT_CACHE_PREFIX = 'acct:';
const ACCT_CACHE_TTL_SEC = 300; // 5 minutes

// --- DB row → domain ---

interface AccountRow {
  id: string;
  channel: ChannelType;
  name: string;
  is_active: boolean;
  credentials: Record<string, unknown>;
  rate_limit_max: number;
  rate_limit_duration_ms: number;
  capabilities: ChannelCapabilities;
  token_expires_at: string | null;
  token_refreshed_at: string | null;
  webhook_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function rowToAccount(row: AccountRow): ChannelAccount {
  return {
    id: row.id,
    channel: row.channel,
    name: row.name,
    isActive: row.is_active,
    credentials: resolveCredentials(row.channel, row.credentials),
    rateLimitMax: row.rate_limit_max,
    rateLimitDurationMs: row.rate_limit_duration_ms,
    capabilities: parseCapabilities(row.capabilities),
    tokenExpiresAt: row.token_expires_at ? new Date(row.token_expires_at) : null,
    tokenRefreshedAt: row.token_refreshed_at ? new Date(row.token_refreshed_at) : null,
    webhookUrl: row.webhook_url,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

const DEFAULT_CAPABILITIES: ChannelCapabilities = {
  markAsRead: false,
  sendPhoto: true,
  sendFile: true,
  sendVideo: false,
  sendAudio: false,
  sendInlineButton: false,
  replyWindow24h: false,
  forwardDetection: false,
  replyToDetection: false,
  statusUpdates: false,
  typingIndicator: false,
  deleteMessage: false,
  editMessage: false,
  twoStepUpload: false,
  challengeResponse: false,
  confirmationHandshake: false,
  maxMediaSizeBytes: 10 * 1024 * 1024,
  maxTextLength: 4096,
};

/** Parse JSONB capabilities with defaults for missing fields. */
function parseCapabilities(raw: ChannelCapabilities | Record<string, never>): ChannelCapabilities {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CAPABILITIES };
  return {
    markAsRead: typeof raw.markAsRead === 'boolean' ? raw.markAsRead : DEFAULT_CAPABILITIES.markAsRead,
    sendPhoto: typeof raw.sendPhoto === 'boolean' ? raw.sendPhoto : DEFAULT_CAPABILITIES.sendPhoto,
    sendFile: typeof raw.sendFile === 'boolean' ? raw.sendFile : DEFAULT_CAPABILITIES.sendFile,
    sendVideo: typeof raw.sendVideo === 'boolean' ? raw.sendVideo : DEFAULT_CAPABILITIES.sendVideo,
    sendAudio: typeof raw.sendAudio === 'boolean' ? raw.sendAudio : DEFAULT_CAPABILITIES.sendAudio,
    sendInlineButton: typeof raw.sendInlineButton === 'boolean' ? raw.sendInlineButton : DEFAULT_CAPABILITIES.sendInlineButton,
    replyWindow24h: typeof raw.replyWindow24h === 'boolean' ? raw.replyWindow24h : DEFAULT_CAPABILITIES.replyWindow24h,
    forwardDetection: typeof raw.forwardDetection === 'boolean' ? raw.forwardDetection : DEFAULT_CAPABILITIES.forwardDetection,
    replyToDetection: typeof raw.replyToDetection === 'boolean' ? raw.replyToDetection : DEFAULT_CAPABILITIES.replyToDetection,
    statusUpdates: typeof raw.statusUpdates === 'boolean' ? raw.statusUpdates : DEFAULT_CAPABILITIES.statusUpdates,
    typingIndicator: typeof raw.typingIndicator === 'boolean' ? raw.typingIndicator : DEFAULT_CAPABILITIES.typingIndicator,
    deleteMessage: typeof raw.deleteMessage === 'boolean' ? raw.deleteMessage : DEFAULT_CAPABILITIES.deleteMessage,
    editMessage: typeof raw.editMessage === 'boolean' ? raw.editMessage : DEFAULT_CAPABILITIES.editMessage,
    twoStepUpload: typeof raw.twoStepUpload === 'boolean' ? raw.twoStepUpload : DEFAULT_CAPABILITIES.twoStepUpload,
    challengeResponse: typeof raw.challengeResponse === 'boolean' ? raw.challengeResponse : DEFAULT_CAPABILITIES.challengeResponse,
    confirmationHandshake: typeof raw.confirmationHandshake === 'boolean' ? raw.confirmationHandshake : DEFAULT_CAPABILITIES.confirmationHandshake,
    maxMediaSizeBytes: typeof raw.maxMediaSizeBytes === 'number' ? raw.maxMediaSizeBytes : DEFAULT_CAPABILITIES.maxMediaSizeBytes,
    maxTextLength: typeof raw.maxTextLength === 'number' ? raw.maxTextLength : DEFAULT_CAPABILITIES.maxTextLength,
  };
}

// ─── Credential Resolution (.env fallback) ──────────────────────────────────

/**
 * Resolve credentials: DB credentials take priority, .env config fills gaps.
 * This ensures adapters always have credentials without manual DB seeding.
 */
function resolveCredentials(channel: ChannelType, dbCreds: Record<string, unknown>): Record<string, unknown> {
  const hasKeys = Object.keys(dbCreds).length > 0;

  const envCreds = getEnvCredentials(channel);
  if (!envCreds) return dbCreds;

  // DB credentials override .env — merge with .env as fallback
  if (hasKeys) {
    const merged: Record<string, unknown> = { ...envCreds };
    for (const [key, value] of Object.entries(dbCreds)) {
      if (value !== undefined && value !== null && value !== '') {
        merged[key] = value;
      }
    }
    return merged;
  }

  return envCreds;
}

/** Map channel type → config credentials from .env */
function getEnvCredentials(channel: ChannelType): Record<string, unknown> | null {
  switch (channel) {
    case 'telegram':
      if (!config.telegram.botToken) return null;
      return {
        botToken: config.telegram.botToken,
        botUsername: config.telegram.botUsername,
        webhookSecret: config.telegram.webhookSecret,
      };
    case 'vk':
      if (!config.vk.groupToken) return null;
      return {
        groupToken: config.vk.groupToken,
        groupId: config.vk.groupId,
        confirmationCode: config.vk.confirmationCode,
        secretKey: config.vk.secretKey,
      };
    case 'whatsapp':
      if (!config.whatsapp.accessToken) return null;
      return {
        phoneNumberId: config.whatsapp.phoneNumberId,
        accessToken: config.whatsapp.accessToken,
        verifyToken: config.whatsapp.verifyToken,
        appSecret: config.whatsapp.appSecret,
        businessAccountId: config.whatsapp.businessAccountId,
      };
    case 'instagram':
      if (!config.instagram.accessToken) return null;
      return {
        accessToken: config.instagram.accessToken,
        appSecret: config.instagram.appSecret,
        verifyToken: config.instagram.verifyToken,
        businessAccountId: config.instagram.businessAccountId,
        proxyUrl: config.instagram.proxyUrl,
      };
    case 'max':
      if (!config.maxBot.accessToken) return null;
      return {
        accessToken: config.maxBot.accessToken,
        apiUrl: config.maxBot.apiUrl,
        webhookSecret: config.maxBot.webhookSecret,
      };
    default:
      return null;
  }
}

// --- Reads ---

/** Get the active account for a channel type (cached in Redis). */
export async function getAccountByChannel(channel: ChannelType): Promise<ChannelAccount | null> {
  const key = `${ACCT_CACHE_PREFIX}channel:${channel}`;
  const cached = await cacheGet<ChannelAccount>(key);
  if (cached) return cached;

  const row = await db.queryOne<AccountRow>(
    `SELECT * FROM channel_accounts WHERE channel = $1 AND is_active = true ORDER BY created_at LIMIT 1`,
    [channel],
  );
  if (!row) return null;

  const account = rowToAccount(row);
  await cacheSet(key, account, ACCT_CACHE_TTL_SEC);
  return account;
}

/** Get account by UUID (cached in Redis). */
export async function getAccountById(id: string): Promise<ChannelAccount | null> {
  const key = `${ACCT_CACHE_PREFIX}id:${id}`;
  const cached = await cacheGet<ChannelAccount>(key);
  if (cached) return cached;

  const row = await db.queryOne<AccountRow>(
    `SELECT * FROM channel_accounts WHERE id = $1`,
    [id],
  );
  if (!row) return null;

  const account = rowToAccount(row);
  await cacheSet(key, account, ACCT_CACHE_TTL_SEC);
  return account;
}

/** Get all active accounts. */
export async function getAllActiveAccounts(): Promise<ChannelAccount[]> {
  const rows = await db.query<AccountRow>(
    `SELECT * FROM channel_accounts WHERE is_active = true ORDER BY channel, name`,
  );
  return rows.map(rowToAccount);
}

// --- Writes ---

/** Update credentials JSON for an account. Invalidates cache. */
export async function updateCredentials(
  id: string,
  credentials: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `UPDATE channel_accounts SET credentials = $2, updated_at = NOW() WHERE id = $1`,
    [id, JSON.stringify(credentials)],
  );
  invalidateCache(id);
  log.info('credentials updated', { accountId: id });
}

/** Update token expiry after a refresh (Instagram 50-day token). */
export async function updateTokenRefresh(
  id: string,
  tokenExpiresAt: Date,
): Promise<void> {
  await db.query(
    `UPDATE channel_accounts SET token_expires_at = $2, token_refreshed_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [id, tokenExpiresAt.toISOString()],
  );
  invalidateCache(id);
}

/** Update capabilities JSON. */
export async function updateCapabilities(
  id: string,
  capabilities: ChannelCapabilities,
): Promise<void> {
  await db.query(
    `UPDATE channel_accounts SET capabilities = $2, updated_at = NOW() WHERE id = $1`,
    [id, JSON.stringify(capabilities)],
  );
  invalidateCache(id);
}

/** Enable or disable an account. */
export async function setAccountActive(id: string, active: boolean): Promise<void> {
  await db.query(
    `UPDATE channel_accounts SET is_active = $2, updated_at = NOW() WHERE id = $1`,
    [id, active],
  );
  invalidateCache(id);
  log.info('account active status changed', { accountId: id, active });
}

// --- Cache management (Redis-backed) ---

function invalidateCache(id: string): void {
  // Delete by id
  cacheDel(`${ACCT_CACHE_PREFIX}id:${id}`).catch(() => {});
  // Delete all channel: keys (we don't know which channel this id belonged to, so scan)
  const redis = getCrmRedis();
  if (redis) {
    const stream = redis.scanStream({ match: `${ACCT_CACHE_PREFIX}channel:*`, count: 20 });
    stream.on('data', (keys: string[]) => {
      if (keys.length > 0) {
        redis.del(...keys).catch(() => {});
      }
    });
  }
}

/** Clear entire cache (for testing or after bulk operations). */
export function clearCache(): void {
  const redis = getCrmRedis();
  if (redis) {
    const stream = redis.scanStream({ match: `${ACCT_CACHE_PREFIX}*`, count: 100 });
    stream.on('data', (keys: string[]) => {
      if (keys.length > 0) {
        redis.del(...keys).catch(() => {});
      }
    });
  }
}
