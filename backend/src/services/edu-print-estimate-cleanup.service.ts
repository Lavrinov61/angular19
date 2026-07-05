/**
 * Edu Print Estimate Cleanup Scheduler
 *
 * Калькулятор edu-печати загружает временные файлы в S3 под префикс print-estimates/.
 * Файл нужен только пока идёт оценка (включая повторные вызовы на тумблер Ч/Б↔Цвет).
 * delete-on-replace в роуте чистит прежние файлы пользователя при новой загрузке, а этот
 * sweep — defence-in-depth: удаляет всё под print-estimates/ старше 2 часов.
 *
 * Runs only on the leader instance (via scheduler-leader.ts advisory lock).
 */

import { storageService } from './storage.service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('edu-print-estimate-cleanup');

const PREFIX = 'print-estimates/';
const MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 часа
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // каждый час

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

async function sweepStaleEstimates(): Promise<void> {
  try {
    const objects = await storageService.listObjectsByPrefix(PREFIX);
    const cutoff = Date.now() - MAX_AGE_MS;
    const stale = objects.filter(o => o.lastModified !== null && o.lastModified.getTime() < cutoff);
    if (stale.length === 0) return;

    await Promise.all(stale.map(o => storageService.delete(o.key)));
    log.info('swept stale print-estimate files', { count: stale.length });
  } catch (err: unknown) {
    log.error('edu print-estimate cleanup failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function startEduPrintEstimateCleanup(): void {
  if (cleanupInterval) return;
  // Отложенный первый прогон — не мешать старту лидера.
  setTimeout(() => { void sweepStaleEstimates(); }, 60_000);
  cleanupInterval = setInterval(() => { void sweepStaleEstimates(); }, CLEANUP_INTERVAL_MS);
  log.info('edu print-estimate cleanup scheduler started (1h interval)');
}

export function stopEduPrintEstimateCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    log.info('edu print-estimate cleanup scheduler stopped');
  }
}
