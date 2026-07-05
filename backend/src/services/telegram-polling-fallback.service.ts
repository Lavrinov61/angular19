/**
 * Telegram polling fallback.
 *
 * Telegram normally pushes updates to /api/webhooks/telegram. If Telegram
 * reports fresh webhook timeouts with pending updates, the scheduler leader
 * temporarily deletes the webhook and drains getUpdates through the same
 * handleWebhook() pipeline. In TELEGRAM_POLLING_MODE=always it keeps polling
 * permanently and never restores the webhook.
 */

import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { fetchWithTimeout } from '../utils/fetch-timeout.js';
import { getAccountByChannel } from './connectors/core/account-store.js';
import { getAdapterOrThrow } from './connectors/core/adapter-registry.js';
import type { ChannelAccount } from './connectors/core/types.js';
import { handleWebhook } from './connectors/pipeline/webhook-receiver.js';

const log = createLogger('telegram-polling-fallback');

const ALLOWED_UPDATES = ['message', 'edited_message', 'callback_query', 'my_chat_member'] as const;
const DEFAULT_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_ERROR_WINDOW_MS = 10 * 60_000;
const DEFAULT_MIN_FALLBACK_MS = 10 * 60_000;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const DEFAULT_LONG_POLL_TIMEOUT_SEC = 25;
const DEFAULT_PENDING_THRESHOLD = 5;
const RESTORE_EMPTY_POLLS = 2;

interface JsonObject {
  [key: string]: unknown;
}

interface TelegramWebhookInfo {
  url: string;
  pendingUpdateCount: number;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
}

interface TelegramUpdate extends JsonObject {
  update_id: number;
}

interface TelegramCredentials {
  botToken: string;
  webhookSecret?: string;
}

class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: number | null,
    readonly description: string,
  ) {
    super(`Telegram ${method} failed${code ? ` (${code})` : ''}: ${description}`);
    this.name = 'TelegramApiError';
  }
}

interface FallbackActivation {
  activate: boolean;
  reason: string;
}

type TelegramPollingMode = 'auto' | 'always';

let watchdogInterval: ReturnType<typeof setInterval> | null = null;
let initialWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogInFlight = false;
let fallbackActive = false;
let permanentPolling = false;
let pollLoopRunning = false;
let stopping = false;
let fallbackUntil = 0;
let emptyPolls = 0;
let nextOffset: number | null = null;

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const checkIntervalMs = readPositiveInt(process.env['TELEGRAM_POLLING_FALLBACK_CHECK_MS'], DEFAULT_CHECK_INTERVAL_MS);
const errorWindowMs = readPositiveInt(process.env['TELEGRAM_POLLING_FALLBACK_ERROR_WINDOW_MS'], DEFAULT_ERROR_WINDOW_MS);
const minFallbackMs = readPositiveInt(process.env['TELEGRAM_POLLING_FALLBACK_MIN_MS'], DEFAULT_MIN_FALLBACK_MS);
const retryDelayMs = readPositiveInt(process.env['TELEGRAM_POLLING_FALLBACK_RETRY_MS'], DEFAULT_RETRY_DELAY_MS);
const longPollTimeoutSec = readPositiveInt(
  process.env['TELEGRAM_POLLING_FALLBACK_LONG_POLL_TIMEOUT_SEC'],
  DEFAULT_LONG_POLL_TIMEOUT_SEC,
);
const pendingThreshold = readPositiveInt(
  process.env['TELEGRAM_POLLING_FALLBACK_PENDING_THRESHOLD'],
  DEFAULT_PENDING_THRESHOLD,
);

function isDisabled(): boolean {
  return process.env['TELEGRAM_POLLING_FALLBACK'] === 'false';
}

function readPollingMode(): TelegramPollingMode {
  const mode = (
    process.env['TELEGRAM_POLLING_MODE']
    || process.env['TELEGRAM_POLLING_FALLBACK_MODE']
    || 'auto'
  ).trim().toLowerCase();
  return mode === 'always' || mode === 'polling' || mode === 'permanent' || mode === 'force'
    ? 'always'
    : 'auto';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function creds(account: ChannelAccount): TelegramCredentials {
  const source = account.credentials;
  return {
    botToken: stringValue(source['botToken']) ?? '',
    webhookSecret: stringValue(source['webhookSecret']) ?? undefined,
  };
}

function apiUrl(botToken: string, method: string): string {
  return `${config.telegram.apiUrl}/bot${botToken}/${method}`;
}

async function telegramRequest(
  botToken: string,
  method: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<JsonObject> {
  const response = await fetchWithTimeout(apiUrl(botToken, method), options);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Telegram ${method} returned non-JSON HTTP ${response.status}`);
  }

  if (!isRecord(payload)) {
    throw new Error(`Telegram ${method} returned unexpected payload`);
  }

  if (payload['ok'] !== true) {
    const code = numberValue(payload['error_code']);
    const description = stringValue(payload['description']) ?? `HTTP ${response.status}`;
    throw new TelegramApiError(method, code, description);
  }

  return payload;
}

function isWebhookActiveConflict(error: unknown): error is TelegramApiError {
  return error instanceof TelegramApiError
    && error.code === 409
    && /webhook is active/i.test(error.description);
}

async function telegramPost(
  botToken: string,
  method: string,
  payload: JsonObject,
  timeout = 15_000,
): Promise<JsonObject> {
  return telegramRequest(botToken, method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    timeout,
  });
}

async function getWebhookInfo(botToken: string): Promise<TelegramWebhookInfo> {
  const payload = await telegramRequest(botToken, 'getWebhookInfo', {
    method: 'GET',
    timeout: 10_000,
  });
  const result = isRecord(payload['result']) ? payload['result'] : {};
  const lastErrorDate = numberValue(result['last_error_date']);
  return {
    url: stringValue(result['url']) ?? '',
    pendingUpdateCount: numberValue(result['pending_update_count']) ?? 0,
    lastErrorAt: lastErrorDate ? new Date(lastErrorDate * 1000) : null,
    lastErrorMessage: stringValue(result['last_error_message']),
  };
}

async function deleteWebhook(botToken: string): Promise<void> {
  await telegramPost(botToken, 'deleteWebhook', { drop_pending_updates: false });
}

async function getUpdates(botToken: string): Promise<TelegramUpdate[]> {
  const params = new URLSearchParams({
    timeout: String(longPollTimeoutSec),
    allowed_updates: JSON.stringify(ALLOWED_UPDATES),
  });
  if (nextOffset !== null) {
    params.set('offset', String(nextOffset));
  }

  const payload = await telegramRequest(botToken, `getUpdates?${params.toString()}`, {
    method: 'GET',
    timeout: longPollTimeoutSec * 1000 + 10_000,
  });
  const result = payload['result'];
  if (!Array.isArray(result)) return [];
  return result.filter((item): item is TelegramUpdate => isRecord(item) && numberValue(item['update_id']) !== null);
}

function shouldActivateFallback(info: TelegramWebhookInfo, now = Date.now()): FallbackActivation {
  const lastErrorMs = info.lastErrorAt?.getTime() ?? 0;
  const errorIsRecent = lastErrorMs > now - errorWindowMs;
  const timeoutLikeError = /(timed?\s*out|timeout|connection\s+timed\s+out|connection\s+reset|connect\s+failed)/i
    .test(info.lastErrorMessage ?? '');

  if (info.pendingUpdateCount > 0 && errorIsRecent && timeoutLikeError) {
    return { activate: true, reason: 'pending_updates_after_recent_timeout' };
  }

  if (info.pendingUpdateCount >= pendingThreshold) {
    return { activate: true, reason: 'pending_update_threshold' };
  }

  return { activate: false, reason: 'healthy' };
}

async function restoreWebhook(account: ChannelAccount, reason: string): Promise<boolean> {
  const { botToken } = creds(account);
  if (!botToken) return false;

  const adapter = getAdapterOrThrow('telegram');
  if (!adapter.ensureWebhook) {
    log.error('Telegram adapter has no ensureWebhook');
    return false;
  }

  try {
    await adapter.ensureWebhook(account, process.env['BASE_URL'] || 'https://svoefoto.ru');
    const info = await getWebhookInfo(botToken);
    if (!info.url) {
      log.warn('Telegram webhook restore did not set URL', { reason });
      return false;
    }
    log.info('Telegram webhook restored', { reason, pendingUpdateCount: info.pendingUpdateCount });
    return true;
  } catch (err) {
    log.warn('Telegram webhook restore failed', { reason, error: String(err) });
    return false;
  }
}

async function activateFallback(account: ChannelAccount, info: TelegramWebhookInfo, reason: string): Promise<void> {
  const { botToken } = creds(account);
  if (!botToken) return;

  await deleteWebhook(botToken);

  fallbackActive = true;
  fallbackUntil = Date.now() + minFallbackMs;
  emptyPolls = 0;

  log.warn('Telegram polling fallback activated', {
    reason,
    pendingUpdateCount: info.pendingUpdateCount,
    lastErrorAt: info.lastErrorAt?.toISOString() ?? null,
    durationMs: minFallbackMs,
  });

  startPollingLoop();
}

async function processUpdate(account: ChannelAccount, update: TelegramUpdate): Promise<void> {
  const { webhookSecret } = creds(account);
  if (!webhookSecret) {
    log.error('Telegram polling fallback cannot process update without webhook secret');
    return;
  }

  const result = await handleWebhook('telegram', {
    body: update,
    headers: {
      'x-telegram-bot-api-secret-token': webhookSecret,
      'x-telegram-polling-fallback': '1',
    },
    ip: '127.0.0.1',
  });

  if (result.status < 200 || result.status >= 300) {
    log.warn('Telegram polled update returned non-2xx from webhook pipeline', {
      updateId: update.update_id,
      status: result.status,
    });
  }
}

async function pollingLoop(): Promise<void> {
  try {
    while (fallbackActive && !stopping) {
      const account = await getAccountByChannel('telegram');
      if (!account) {
        log.warn('Telegram polling fallback has no active account');
        await sleep(retryDelayMs);
        continue;
      }

      const { botToken } = creds(account);
      if (!botToken) {
        log.warn('Telegram polling fallback has no bot token');
        await sleep(retryDelayMs);
        continue;
      }

      try {
        const updates = await getUpdates(botToken);
        if (updates.length === 0) {
          emptyPolls += 1;
          if (!permanentPolling && Date.now() >= fallbackUntil && emptyPolls >= RESTORE_EMPTY_POLLS) {
            const restored = await restoreWebhook(account, 'fallback_window_elapsed');
            if (restored) {
              fallbackActive = false;
              break;
            }
          }
          continue;
        }

        emptyPolls = 0;
        updates.sort((a, b) => a.update_id - b.update_id);
        for (const update of updates) {
          await processUpdate(account, update);
          nextOffset = update.update_id + 1;
        }
      } catch (err) {
        if (isWebhookActiveConflict(err)) {
          log.warn('Telegram polling fallback found active webhook; deleting again to continue draining updates');
          try {
            await deleteWebhook(botToken);
            emptyPolls = 0;
          } catch (deleteErr) {
            log.warn('Telegram polling fallback deleteWebhook after conflict failed', { error: String(deleteErr) });
          }
          await sleep(retryDelayMs);
          continue;
        }
        log.warn('Telegram polling fallback cycle failed', { error: String(err) });
        await sleep(retryDelayMs);
      }
    }
  } finally {
    if (!stopping && fallbackActive && !permanentPolling) {
      const account = await getAccountByChannel('telegram');
      if (account) {
        const restored = await restoreWebhook(account, 'polling_loop_exit');
        fallbackActive = !restored;
      }
    } else if (!stopping && fallbackActive && permanentPolling) {
      log.warn('Telegram permanent polling loop exited; restart will be scheduled');
    }
  }
}

function startPollingLoop(): void {
  if (pollLoopRunning) return;
  pollLoopRunning = true;
  pollingLoop()
    .catch(err => log.error('Telegram polling fallback loop crashed', { error: String(err) }))
    .finally(() => {
      pollLoopRunning = false;
      if (!stopping && fallbackActive) {
        setTimeout(() => {
          if (!stopping && fallbackActive && !pollLoopRunning) {
            startPollingLoop();
          }
        }, retryDelayMs);
      }
    });
}

async function runWatchdog(): Promise<void> {
  if (watchdogInFlight || fallbackActive || stopping) return;
  watchdogInFlight = true;
  try {
    const account = await getAccountByChannel('telegram');
    if (!account) return;
    const { botToken } = creds(account);
    if (!botToken) return;

    const info = await getWebhookInfo(botToken);
    if (!info.url) {
      await restoreWebhook(account, 'webhook_missing');
      return;
    }

    const decision = shouldActivateFallback(info);
    if (decision.activate) {
      await activateFallback(account, info, decision.reason);
    }
  } catch (err) {
    log.warn('Telegram polling fallback watchdog failed', { error: String(err) });
  } finally {
    watchdogInFlight = false;
  }
}

export function startTelegramPollingFallback(): void {
  if (isDisabled()) {
    log.info('Telegram polling fallback disabled by TELEGRAM_POLLING_FALLBACK=false');
    return;
  }
  if (!config.telegram.enabled) {
    log.info('Telegram polling fallback skipped: Telegram disabled');
    return;
  }
  if (watchdogInterval || initialWatchdogTimer || pollLoopRunning || fallbackActive) {
    log.warn('Telegram polling fallback already running');
    return;
  }

  stopping = false;
  nextOffset = null;
  const pollingMode = readPollingMode();
  if (pollingMode === 'always') {
    permanentPolling = true;
    fallbackActive = true;
    fallbackUntil = Number.MAX_SAFE_INTEGER;
    emptyPolls = 0;
    log.warn('Telegram permanent polling started', {
      longPollTimeoutSec,
      retryDelayMs,
    });
    startPollingLoop();
    return;
  }

  permanentPolling = false;
  log.info('Telegram polling fallback watchdog started', {
    checkIntervalMs,
    minFallbackMs,
    errorWindowMs,
    pendingThreshold,
  });

  initialWatchdogTimer = setTimeout(() => {
    initialWatchdogTimer = null;
    runWatchdog().catch(err => log.warn('Telegram initial fallback watchdog failed', { error: String(err) }));
  }, 15_000);
  watchdogInterval = setInterval(() => {
    runWatchdog().catch(err => log.warn('Telegram fallback watchdog failed', { error: String(err) }));
  }, checkIntervalMs);
}

export async function stopTelegramPollingFallback(): Promise<void> {
  stopping = true;
  if (initialWatchdogTimer) {
    clearTimeout(initialWatchdogTimer);
    initialWatchdogTimer = null;
  }
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }

  if (fallbackActive && !permanentPolling) {
    const account = await getAccountByChannel('telegram');
    if (account) {
      await restoreWebhook(account, 'service_stop');
    }
  }

  fallbackActive = false;
  permanentPolling = false;
  emptyPolls = 0;
  nextOffset = null;
  log.info('Telegram polling fallback watchdog stopped');
}
