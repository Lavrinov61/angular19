/**
 * Shared Circuit Breaker (Phase 3A.2) — Redis-backed for multi-node
 *
 * Паттерн: CLOSED → OPEN (после threshold подряд ошибок) → HALF_OPEN (после cooldown) → CLOSED
 * State is synced to Redis so all ALB instances share the same circuit state.
 * In-memory fields act as hot cache; Redis is source of truth.
 */

import { getCrmRedis } from '../services/redis-cache.service.js';
import { getRequestId } from '../middleware/request-context.js';
import {
  circuitBreakerTripsTotal,
  circuitBreakerRecoveredTotal,
  circuitBreakerFallbackRequestsTotal,
  circuitBreakerCallDurationSeconds,
} from '../services/metrics.service.js';

import { createLogger } from './logger.js';

const logger = createLogger('circuit-breaker');

const REDIS_PREFIX = 'cb:';

export class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failures = 0;
  private openedAt = 0;
  private lastSuccessAt: number = 0;
  private lastFailureAt: number = 0;
  private lastErrorMessage: string = '';
  private onStateChange?: (name: string, state: string) => void;

  constructor(
    private readonly name: string,
    private readonly threshold = 5,
    private readonly cooldownMs = 30_000,
  ) {
    // Hydrate from Redis on creation (fire-and-forget — first call will use default CLOSED)
    this.hydrateFromRedis().catch((err: unknown) => {
      logger.warn(`[CircuitBreaker:${this.name}] Failed to hydrate from Redis`, { error: String(err) });
    });
  }

  allow(): boolean {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN') {
      if (Date.now() - this.openedAt >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
        this.syncToRedis();
        return true;
      }
      circuitBreakerFallbackRequestsTotal.inc({ service: this.name });
      return false;
    }
    // HALF_OPEN — пропускаем одну попытку
    return true;
  }

  success(): void {
    const prevState = this.state;
    this.failures = 0;
    this.state = 'CLOSED';
    this.lastSuccessAt = Date.now();
    this.syncToRedis();
    if (prevState === 'HALF_OPEN' && this.state === 'CLOSED') {
      circuitBreakerRecoveredTotal.inc({ service: this.name });
    }
    if (prevState !== 'CLOSED' && this.onStateChange) {
      this.onStateChange(this.name, this.state);
    }
  }

  failure(errorMsg?: string): void {
    this.failures++;
    this.lastFailureAt = Date.now();
    this.lastErrorMessage = errorMsg || '';
    if (this.failures >= this.threshold) {
      const wasAlreadyOpen = this.state === 'OPEN';
      this.state = 'OPEN';
      this.openedAt = Date.now();
      logger.warn(`[CircuitBreaker:${this.name}] OPEN after ${this.failures} failures`);
      if (!wasAlreadyOpen) {
        circuitBreakerTripsTotal.inc({ service: this.name });
      }
      if (this.onStateChange) {
        this.onStateChange(this.name, this.state);
      }
      // Alert on OPEN transition (fire-and-forget, lazy import to avoid circular deps)
      if (!wasAlreadyOpen) {
        import('../services/alerting.service.js').then(({ alertCircuitBreakerOpen }) => {
          alertCircuitBreakerOpen(this.name, this.failures, this.lastErrorMessage).catch((err: unknown) => {
            logger.warn(`[CircuitBreaker:${this.name}] Failed to send alert`, { error: String(err) });
          });
        }).catch((err: unknown) => {
          logger.warn(`[CircuitBreaker:${this.name}] Failed to load alerting service`, { error: String(err) });
        });
      }
    }
    this.syncToRedis();
  }

  getState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
    return this.state;
  }

  getFailures(): number {
    return this.failures;
  }

  getLastSuccessAt(): number {
    return this.lastSuccessAt;
  }

  getLastFailureAt(): number {
    return this.lastFailureAt;
  }

  getLastError(): string {
    return this.lastErrorMessage;
  }

  getName(): string {
    return this.name;
  }

  setOnStateChange(cb: (name: string, state: string) => void): void {
    this.onStateChange = cb;
  }

  /** Sync current state to Redis (fire-and-forget). */
  private syncToRedis(): void {
    const redis = getCrmRedis();
    if (!redis) return;
    const key = `${REDIS_PREFIX}${this.name}`;
    const data: Record<string, string> = {
      state: this.state,
      failures: String(this.failures),
      openedAt: String(this.openedAt),
      lastSuccessAt: String(this.lastSuccessAt),
      lastFailureAt: String(this.lastFailureAt),
      lastErrorMessage: this.lastErrorMessage,
    };
    redis.hmset(key, data).catch((err: unknown) => {
      logger.warn(`[CircuitBreaker:${this.name}] Failed to sync state`, { error: String(err) });
    });
    // Auto-expire after 10 minutes of inactivity (stale breakers get cleaned up)
    redis.expire(key, 600).catch((err: unknown) => {
      logger.warn(`[CircuitBreaker:${this.name}] Failed to set state TTL`, { error: String(err) });
    });
  }

  /** Hydrate state from Redis (async, called on creation). */
  private async hydrateFromRedis(): Promise<void> {
    const redis = getCrmRedis();
    if (!redis) return;
    try {
      const data = await redis.hgetall(`${REDIS_PREFIX}${this.name}`);
      if (!data || !data['state']) return;
      this.state = data['state'] as 'CLOSED' | 'OPEN' | 'HALF_OPEN';
      this.failures = parseInt(data['failures'] || '0', 10);
      this.openedAt = parseInt(data['openedAt'] || '0', 10);
      this.lastSuccessAt = parseInt(data['lastSuccessAt'] || '0', 10);
      this.lastFailureAt = parseInt(data['lastFailureAt'] || '0', 10);
      this.lastErrorMessage = data['lastErrorMessage'] || '';
    } catch {
      // Redis unavailable — proceed with defaults
    }
  }
}

// --- Per-channel singleton instances ---
const breakers = new Map<string, CircuitBreaker>();

export function getBreaker(channel: string): CircuitBreaker {
  let breaker = breakers.get(channel);
  if (!breaker) {
    breaker = new CircuitBreaker(channel);
    breakers.set(channel, breaker);
  }
  return breaker;
}

export function getAllBreakers(): Map<string, CircuitBreaker> {
  return breakers;
}

// --- Service-level circuit breaker configs ---

export interface ServiceBreakerConfig {
  /** Unique breaker name, e.g. 'cloudpayments' */
  name: string;
  /** Consecutive failures before opening (default: 5) */
  threshold?: number;
  /** Cooldown before HALF_OPEN in ms (default: 30_000) */
  cooldownMs?: number;
  /** Default fetch timeout in ms (default: 10_000) */
  timeoutMs?: number;
}

/** Pre-defined configs for all external services */
export const SERVICE_BREAKERS = {
  cloudpayments: { name: 'cloudpayments', threshold: 3, cooldownMs: 60_000, timeoutMs: 30_000 },
  dadata: { name: 'dadata', threshold: 5, cooldownMs: 30_000, timeoutMs: 5_000 },
  pochta: { name: 'pochta.ru', threshold: 5, cooldownMs: 60_000, timeoutMs: 15_000 },
  pochtaOtpravka: { name: 'pochta-otpravka', threshold: 5, cooldownMs: 60_000, timeoutMs: 15_000 },
  reviewSync: { name: 'review-sync', threshold: 5, cooldownMs: 300_000, timeoutMs: 10_000 },
  grok: { name: 'grok-ai', threshold: 3, cooldownMs: 30_000, timeoutMs: 30_000 },
  gemini: { name: 'gemini-ai', threshold: 3, cooldownMs: 30_000, timeoutMs: 30_000 },
  claude: { name: 'claude-ai', threshold: 3, cooldownMs: 30_000, timeoutMs: 15_000 },
  openrouter: { name: 'openrouter-ai', threshold: 3, cooldownMs: 30_000, timeoutMs: 60_000 },
  falAi: { name: 'fal-ai', threshold: 3, cooldownMs: 30_000, timeoutMs: 60_000 },
  telegram: { name: 'telegram-file', threshold: 5, cooldownMs: 30_000, timeoutMs: 15_000 },
  bridge: { name: 'bridge-api', threshold: 5, cooldownMs: 15_000, timeoutMs: 10_000 },
  posBridge: { name: 'pos-bridge', threshold: 5, cooldownMs: 15_000, timeoutMs: 10_000 },
  atolFiscal: { name: 'atol-fiscal', threshold: 3, cooldownMs: 30_000, timeoutMs: 15_000 },
  smtp: { name: 'smtp', threshold: 3, cooldownMs: 60_000, timeoutMs: 15_000 },
  yandexDelivery: { name: 'yandex-delivery', threshold: 3, cooldownMs: 60_000, timeoutMs: 30_000 },
} as const satisfies Record<string, ServiceBreakerConfig>;

/**
 * Execute an async function with circuit breaker protection for external services.
 * Combines CB state checking with automatic success/failure tracking.
 *
 * @param cfg - Service breaker config from SERVICE_BREAKERS
 * @param fn - Async function to execute
 * @throws Error if circuit is OPEN or fn throws
 */
export async function withServiceCall<T>(
  cfg: ServiceBreakerConfig,
  fn: () => Promise<T>,
): Promise<T> {
  const breaker = getBreaker(cfg.name);

  if (!breaker.allow()) {
    throw new Error(
      `Circuit breaker OPEN for ${cfg.name} — ${breaker.getFailures()} failures, last: ${breaker.getLastError()}`,
    );
  }

  const t0 = Date.now();
  try {
    const result = await fn();
    breaker.success();
    if (breaker.getState() === 'CLOSED') {
      circuitBreakerCallDurationSeconds.observe({ service: cfg.name }, (Date.now() - t0) / 1000);
    }
    return result;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Rate-limit errors are transient — don't trip the breaker
    const isRateLimit = /429|rate.?limit|flood.?wait|too.?many/i.test(errMsg);
    if (!isRateLimit) {
      breaker.failure(errMsg);
    }
    throw err;
  }
}

/**
 * Convenience: fetch() with circuit breaker + timeout.
 * Uses AbortSignal.timeout() for clean abort handling.
 *
 * @param cfg - Service breaker config
 * @param url - URL to fetch
 * @param options - Standard RequestInit + optional timeoutMs override
 */
export async function fetchWithCB(
  cfg: ServiceBreakerConfig,
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs, ...fetchOptions } = options;
  const timeout = timeoutMs ?? cfg.timeoutMs ?? 10_000;

  // Inject X-Request-Id for distributed tracing
  const requestId = getRequestId();
  if (requestId) {
    const existing = fetchOptions.headers;
    if (existing instanceof Headers) {
      if (!existing.has('X-Request-Id')) {
        existing.set('X-Request-Id', requestId);
      }
    } else if (Array.isArray(existing)) {
      const hasHeader = existing.some(([k]) => k.toLowerCase() === 'x-request-id');
      if (!hasHeader) {
        existing.push(['X-Request-Id', requestId]);
      }
    } else {
      const rec = (existing ?? {}) as Record<string, string>;
      if (!rec['X-Request-Id']) {
        fetchOptions.headers = { ...rec, 'X-Request-Id': requestId };
      }
    }
  }

  return withServiceCall(cfg, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    // Merge signals if caller provided one
    if (fetchOptions.signal) {
      fetchOptions.signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
      if (!response.ok && response.status >= 500) {
        // Server errors should count as failures for CB
        throw new Error(`HTTP ${response.status}: ${url}`);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  });
}
