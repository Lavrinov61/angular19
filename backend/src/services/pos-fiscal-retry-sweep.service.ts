/**
 * Авто-ретрай фискализации POS-чеков (leader-only sweep).
 *
 * Чеки fiscal_status pending/failed (свежее окна, P1.2), у которых нет завершённой
 * fiscal_sale/refund и число фискальных tx < max → повторный enqueueFiscal (тот же
 * живой путь, что даёт успешные чеки). enqueueFiscal идемпотентен (CAS по
 * fiscal_status: queued/processing/success не перезаписываются) — дубль fiscal_sale
 * не плодится.
 *
 * Перед прогоном проверяем circuit-breaker atol-fiscal (allow()) — при OPEN ATOL
 * недоступен, ретрай бессмысленен и копил бы очередь.
 *
 * Регистрируется в server.ts под monolith-leader (БЕЗ нового advisory-lock).
 */

import { config } from '../config/index.js';
import { findFiscalRetryCandidates } from './pos.service.js';
import { enqueueFiscal } from '../workers/pos-fiscal-worker.js';
import { getBreaker, SERVICE_BREAKERS } from '../utils/circuit-breaker.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('pos-fiscal-retry-sweep');

const FIRST_RUN_DELAY_MS = 90_000; // первый прогон через 90с после старта

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Прогон авто-ретрая. Killswitch — флаг POS_FISCAL_AUTORETRY_ENABLED (ранний выход).
 * При OPEN-breaker'е ATOL недоступен → пропускаем тик.
 */
export async function processFiscalRetries(): Promise<void> {
  if (!config.pos.fiscalAutoretryEnabled) return;

  const breaker = getBreaker(SERVICE_BREAKERS.atolFiscal.name);
  if (!breaker.allow()) {
    log.debug('ATOL breaker OPEN — skipping fiscal retry tick');
    return;
  }

  try {
    const candidates = await findFiscalRetryCandidates({
      maxAttempts: config.pos.fiscalAutoretryMax,
      maxAgeMinutes: config.pos.fiscalAutoretryMaxAgeMinutes,
      includeStuck: config.pos.fiscalSweepIncludeStuck,
      staleMinutes: config.pos.fiscalAutoretryStaleMinutes,
    });
    if (candidates.length === 0) return;

    let enqueued = 0;
    for (const c of candidates) {
      try {
        // payments:[] → enqueueFiscal дефолтит payment_method='card' (для наших
        // кейсов корректно). enqueueFiscal сам no-op'ит уже queued/processing/success.
        await enqueueFiscal({
          receiptId: c.id,
          receiptNumber: c.receipt_number,
          items: [],
          total: Number(c.total),
          payments: [],
          operation: 'sale',
        });
        enqueued++;
      } catch (err) {
        log.error('Fiscal retry enqueue error', { receiptId: c.id, error: String(err) });
      }
    }
    if (enqueued > 0) log.info(`Re-enqueued ${enqueued} fiscal receipt(s)`);
  } catch (err) {
    log.error('processFiscalRetries error', { error: String(err) });
  }
}

// ─── Регистрация планировщика (leader-only) ───────────────────────────────────

export function startFiscalRetrySweep(): void {
  if (intervalHandle) {
    log.warn('Sweep already running');
    return;
  }
  const intervalMs = config.pos.fiscalAutoretryIntervalMs;
  log.info(`Sweep started (interval: ${intervalMs / 1000}s)`);
  setTimeout(() => {
    processFiscalRetries();
  }, FIRST_RUN_DELAY_MS);
  intervalHandle = setInterval(processFiscalRetries, intervalMs);
}

export function stopFiscalRetrySweep(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    log.info('Sweep stopped');
  }
}
