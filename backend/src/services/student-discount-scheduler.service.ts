/**
 * Student discount scheduler — keeps verified student lifecycle and rolling
 * 30-day print allowance periods in sync under the singleton scheduler leader.
 */
import { runStudentMaintenanceCycle } from './student-verification.service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('student-discount-scheduler');
const INTERVAL_MS = 4 * 60 * 60 * 1000;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function runSchedulerCycle(): Promise<void> {
  try {
    const result = await runStudentMaintenanceCycle();
    if (result.expired + result.provisioned + result.photosCleaned + result.educationFieldsCleaned > 0) {
      log.info('Student discount scheduler cycle complete', result);
    }
  } catch (err) {
    log.error('Student discount scheduler cycle error', { error: err instanceof Error ? err.message : String(err) });
  }
}

export function startStudentDiscountScheduler(): void {
  if (intervalHandle) {
    log.warn('Student discount scheduler already running');
    return;
  }

  log.info(`Student discount scheduler started (interval: ${INTERVAL_MS / 1000}s)`);
  setTimeout(() => {
    runSchedulerCycle();
  }, 120_000);
  intervalHandle = setInterval(runSchedulerCycle, INTERVAL_MS);
}

export function stopStudentDiscountScheduler(): void {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  log.info('Student discount scheduler stopped');
}
