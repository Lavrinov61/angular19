/**
 * Omnichannel v2 — VK User Name Cache
 *
 * Redis-backed cache for VK user names (24h TTL).
 * Fallback: VK API users.get with 3s timeout.
 * Credentials from ChannelAccount (NOT config singleton).
 */

import { fetchWithTimeout } from '../../../utils/fetch-timeout.js';
import { createLogger } from '../../../utils/logger.js';
import { createLazyRedis } from '../../redis-factory.js';

const log = createLogger('vk-user-cache');

const VK_API = 'https://api.vk.com/method';
const VK_VERSION = '5.199';
const CACHE_TTL = 86400; // 24 hours
const API_TIMEOUT = 3000; // 3s

const getRedis = createLazyRedis('vk-user-cache', {
  connectTimeout: 2000,
  enableOfflineQueue: false,
});

/**
 * Resolve VK user name by user ID using groupToken from credentials.
 * Redis-cached (24h). Falls back to "VK User {id}" on failure.
 */
export async function resolveVkUserName(userId: number, groupToken: string): Promise<string> {
  const fallback = `VK User ${userId}`;

  // 1. Check Redis cache
  const cacheKey = `vk:name:${userId}`;
  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return cached;
    } catch {
      // Redis unavailable — continue to API
    }
  }

  // 2. Fetch from VK API with short timeout
  if (!groupToken) return fallback;

  try {
    const params = new URLSearchParams({
      access_token: groupToken,
      user_ids: String(userId),
      fields: 'first_name,last_name',
      v: VK_VERSION,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);
    const response = await fetchWithTimeout(`${VK_API}/users.get?${params.toString()}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return fallback;

    const data = await response.json() as Record<string, unknown>;
    const user = (data['response'] as Array<Record<string, unknown>>)?.[0];
    if (user?.['first_name']) {
      const name = `${user['first_name']} ${user['last_name'] || ''}`.trim();
      // 3. Cache in Redis
      if (redis) {
        redis.setex(cacheKey, CACHE_TTL, name).catch(() => {});
      }
      return name;
    }
  } catch (err) {
    log.debug('VK users.get failed', { userId, error: String(err) });
  }

  return fallback;
}
