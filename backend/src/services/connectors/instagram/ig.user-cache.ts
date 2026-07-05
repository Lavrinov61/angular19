/**
 * Omnichannel v2 — Instagram User Name Cache
 *
 * Redis-backed cache for Instagram user names (24h TTL).
 * Fallback: Instagram Graph API user profile with 3s timeout.
 * Credentials from ChannelAccount (NOT config singleton).
 */

import { fetchWithTimeout } from '../../../utils/fetch-timeout.js';
import { createLogger } from '../../../utils/logger.js';
import { createLazyRedis } from '../../redis-factory.js';

const log = createLogger('ig-user-cache');

const IG_API = 'https://graph.instagram.com/v21.0';
const CACHE_TTL = 86400; // 24 hours
const API_TIMEOUT = 3000; // 3s

const getRedis = createLazyRedis('ig-user-cache', {
  connectTimeout: 2000,
  enableOfflineQueue: false,
});

interface IgUserProfile {
  name: string;
  username?: string;
}

/**
 * Resolve Instagram user name by IGSID using page access token.
 * Redis-cached (24h). Falls back to "IG:{id}" on failure.
 */
export async function resolveIgUserName(
  userId: string,
  accessToken: string,
): Promise<IgUserProfile> {
  const fallback: IgUserProfile = { name: `IG:${userId}` };

  // 1. Check Redis cache
  const cacheKey = `ig:name:${userId}`;
  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as Record<string, unknown>;
        return {
          name: String(parsed['name'] ?? fallback.name),
          username: parsed['username'] ? String(parsed['username']) : undefined,
        };
      }
    } catch {
      // Redis unavailable — continue to API
    }
  }

  // 2. Fetch from Instagram Graph API with short timeout
  if (!accessToken) return fallback;

  try {
    const response = await fetchWithTimeout(
      `${IG_API}/${userId}?fields=name,username&access_token=${encodeURIComponent(accessToken)}`,
      { timeout: API_TIMEOUT },
    );

    if (!response.ok) return fallback;

    const data = await response.json() as Record<string, unknown>;
    const name = data['name'] ? String(data['name']) : undefined;
    const username = data['username'] ? String(data['username']) : undefined;

    if (name || username) {
      const profile: IgUserProfile = {
        name: name || `@${username}`,
        username,
      };

      // 3. Cache in Redis
      if (redis) {
        redis.setex(cacheKey, CACHE_TTL, JSON.stringify(profile)).catch(() => {});
      }

      return profile;
    }
  } catch (err: unknown) {
    log.debug('IG user profile fetch failed', { userId, error: String(err) });
  }

  return fallback;
}
