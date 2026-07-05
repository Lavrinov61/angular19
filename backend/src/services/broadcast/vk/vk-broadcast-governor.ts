/**
 * VK Broadcast Governor — пауза рассылки на уровне ГРУППЫ (group token).
 *
 * VK rate-limit считается на сообщество (group token), а не на отдельного пользователя:
 * code 6 (too many requests/sec) и code 9 (flood control) — это глобальный сигнал, что
 * группа шлёт слишком быстро. По аналогии с TG-governor (broadcast-governor.ts) при таком
 * сигнале мы паузим ВСЮ VK-рассылку, а не помечаем получателя — иначе сожжём rate-домен
 * группы и рискуем баном сообщества.
 *
 * Ключ: `vk:group:<sha256(groupToken)[:16]>:paused_until` = epoch-ms снятия паузы (PX).
 * Хешируем именно ТОКЕН группы (не groupId — P2-3), чтобы секрет никогда не попал в
 * `redis-cli KEYS`/`MONITOR`/RDB; токен и есть rate-домен. Отдельный от TG ключ-префикс
 * `vk:group:` гарантирует, что 429-шторм VK не паузит Telegram и наоборот.
 *
 * Redis: переиспользуем фабрику кодовой базы (createResilientRedis) — один клиент на
 * процесс, lazyConnect, авто-reconnect, обработчик ошибок не роняет процесс. Fail-open:
 * при недоступности Redis пауза = 0 (рассылка не блокируется намертво из-за инфраструктуры).
 */

import { createHash } from 'node:crypto';
import { createResilientRedis } from '../../redis-factory.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('vk-broadcast-governor');

/** Общий клиент для чтения/записи паузы (один на процесс, lazy). */
let governorRedis: ReturnType<typeof createResilientRedis> | null = null;

function getGovernorRedis(): ReturnType<typeof createResilientRedis> {
  if (!governorRedis) {
    governorRedis = createResilientRedis('vk-broadcast-governor');
  }
  return governorRedis;
}

function pauseKey(groupToken: string): string {
  // Хешируем токен, чтобы секрет сообщества не светился в KEYS/MONITOR/RDB.
  // 16 hex (64 бита) — без коллизий для горстки групп.
  const tokenHash = createHash('sha256').update(groupToken).digest('hex').slice(0, 16);
  return `vk:group:${tokenHash}:paused_until`;
}

/**
 * Остаток паузы в мс для group token. 0, если не на паузе (или при сбое Redis —
 * fail-open, чтобы простой Redis никогда не блокировал отправку насмерть).
 */
export async function getVkGroupPauseMs(groupToken: string): Promise<number> {
  if (!groupToken) return 0;
  try {
    const raw = await getGovernorRedis().get(pauseKey(groupToken));
    if (!raw) return 0;
    const until = Number(raw);
    if (!Number.isFinite(until)) return 0;
    const remaining = until - Date.now();
    return remaining > 0 ? remaining : 0;
  } catch (err) {
    log.warn('getVkGroupPauseMs failed — treating as not paused', {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

/** True, если group token сейчас на паузе (активна backpressure после 6/9). */
export async function isVkGroupPaused(groupToken: string): Promise<boolean> {
  return (await getVkGroupPauseMs(groupToken)) > 0;
}

/**
 * Пауза group token на `ms` (глобальная backpressure после code 6/9).
 * Хранит абсолютный epoch-ms снятия; PX → ключ самовыдыхается.
 */
export async function pauseVkGroup(groupToken: string, ms: number): Promise<void> {
  if (!groupToken || ms <= 0) return;
  const until = Date.now() + ms;
  try {
    await getGovernorRedis().set(pauseKey(groupToken), String(until), 'PX', ms);
    log.warn('vk group paused (flood backpressure)', { ms, until });
  } catch (err) {
    log.error('pauseVkGroup failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
