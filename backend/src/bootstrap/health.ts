/**
 * runHealthCheck — CLI-mode startup probe for worker entry points.
 *
 * Используется в systemd / PM2 pre-start hook: процесс запускается с
 * `--health-check` флагом, прогоняет набор проверок (PG connect, Redis ping,
 * обязательные ENV) и exit 0/1. Если проверка зависла > 5s — exit 1.
 *
 * Не возвращает управление обратно: `Promise<never>` — всегда `process.exit()`.
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('health');

const HEALTH_CHECK_TIMEOUT_MS = 5_000;

/**
 * Run health checks and exit process. Always calls process.exit (never returns).
 *
 * @param checks async callback — должен бросить Error при любой неудаче.
 */
export async function runHealthCheck(checks: () => Promise<void>): Promise<never> {
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`health check timeout after ${HEALTH_CHECK_TIMEOUT_MS}ms`)),
      HEALTH_CHECK_TIMEOUT_MS,
    );
    t.unref();
  });

  try {
    await Promise.race([checks(), timeoutPromise]);
    log.info('health check passed');
    process.exit(0);
  } catch (err: unknown) {
    log.error('health check failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}
