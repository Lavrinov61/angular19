/**
 * registerShutdownHandlers — унифицированные SIGTERM/SIGINT/uncaughtException handlers.
 *
 * Вызывается каждым entry point (api, scheduler, worker-*, telephony) ровно один раз после
 * старта. Cleanup-callback получает таймаут `timeoutMs` — если не укладывается,
 * процесс exit(1) принудительно.
 *
 *  - SIGTERM, SIGINT       → cleanup(), exit(0). Таймаут → exit(1).
 *  - uncaughtException     → log, cleanup(), exit(1). Таймаут → exit(1).
 *  - unhandledRejection    → log only (НЕ крашим — ловим race'ы в фоновых promise'ах).
 */

import { createLogger } from '../utils/logger.js';
import { captureException } from '../utils/error-tracker.js';

const log = createLogger('shutdown');

/** Guard — чтобы повторный сигнал не запускал второй cleanup. */
let shuttingDown = false;

export function registerShutdownHandlers(
  processName: string,
  cleanup: () => Promise<void>,
  timeoutMs = 30_000,
): void {
  const runCleanup = async (signal: string, exitCode: number): Promise<void> => {
    if (shuttingDown) {
      log.warn('shutdown already in progress — ignoring repeated signal', {
        processName,
        signal,
      });
      return;
    }
    shuttingDown = true;

    log.info('shutdown initiated', { processName, signal });

    const timer = setTimeout(() => {
      log.error('shutdown timeout — forcing exit', { processName, signal, timeoutMs });
      process.exit(1);
    }, timeoutMs);
    // Таймер не должен держать event loop живым, если cleanup успел завершиться.
    timer.unref();

    try {
      await cleanup();
      clearTimeout(timer);
      log.info('shutdown complete', { processName, signal });
      process.exit(exitCode);
    } catch (err: unknown) {
      clearTimeout(timer);
      log.error('cleanup threw during shutdown', {
        processName,
        signal,
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => { void runCleanup('SIGTERM', 0); });
  process.on('SIGINT', () => { void runCleanup('SIGINT', 0); });

  process.on('uncaughtException', (err: Error) => {
    log.error('uncaughtException — initiating crash shutdown', {
      processName,
      error: err.message,
      stack: err.stack,
    });
    try {
      captureException(err, {
        tags: { processName, source: 'uncaughtException' },
        level: 'fatal',
      });
    } catch {
      /* best-effort */
    }
    void runCleanup('uncaughtException', 1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    // Не крашим — многие фоновые promise'ы имеют свои .catch'ы ниже по стеку.
    log.warn('unhandledRejection (not crashing)', {
      processName,
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
    try {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      captureException(err, {
        tags: { processName, source: 'unhandledRejection' },
        level: 'error',
      });
    } catch {
      /* best-effort */
    }
  });
}
