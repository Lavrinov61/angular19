/**
 * kpi-snapshot-scheduler.service.ts — Daily/Weekly/Monthly KPI snapshots
 *
 * Leader-elected scheduler (same pattern as other 16 schedulers in server.ts).
 * - Daily:   00:05 MSK — snapshots for previous day
 * - Weekly:  Monday 00:30 MSK — aggregate previous week (Mon–Sun)
 * - Monthly: 1st of month 01:00 MSK — aggregate previous month + composite scores + alerts
 */

import {
  computeAllMetrics,
  getMetricDefinitions,
  getApplicableMetrics,
  getStaffUsers,
  saveSnapshots,
  computeCompositeScore,
  saveCompositeScore,
  generateAlerts,
  saveAlerts,
} from './kpi-computation.service.js';
import { processKpiComposite } from './kpi-gamification-bridge.service.js';

import { createLogger } from '../utils/logger.js';
const TAG = '[KPI-Scheduler]';

const logger = createLogger('kpi-snapshot-scheduler.service');
let dailyTimer: ReturnType<typeof setInterval> | null = null;
let weeklyTimer: ReturnType<typeof setInterval> | null = null;
let monthlyTimer: ReturnType<typeof setInterval> | null = null;
let initialTimeout: ReturnType<typeof setTimeout> | null = null;

// ─── Helpers ────────────────────────────────────────────────────────

function toMoscow(date: Date): Date {
  // Moscow is UTC+3
  return new Date(date.getTime() + 3 * 60 * 60 * 1000);
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function yesterday(): { start: string; end: string } {
  const now = toMoscow(new Date());
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const ds = formatDate(y);
  return { start: ds, end: ds };
}

function lastWeek(): { start: string; end: string } {
  const now = toMoscow(new Date());
  const dayOfWeek = now.getDay(); // 0=Sun..6=Sat
  // Previous Monday
  const prevMon = new Date(now);
  prevMon.setDate(now.getDate() - dayOfWeek - 6);
  // Previous Sunday
  const prevSun = new Date(prevMon);
  prevSun.setDate(prevMon.getDate() + 6);
  return { start: formatDate(prevMon), end: formatDate(prevSun) };
}

function lastMonth(): { start: string; end: string } {
  const now = toMoscow(new Date());
  const firstOfPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastOfPrev = new Date(now.getFullYear(), now.getMonth(), 0);
  return { start: formatDate(firstOfPrev), end: formatDate(lastOfPrev) };
}

// ─── Snapshot Computation ───────────────────────────────────────────

async function computeSnapshots(
  periodType: 'daily' | 'weekly' | 'monthly',
  start: string,
  end: string,
  withComposite: boolean,
): Promise<void> {
  const staff = await getStaffUsers();
  const definitions = await getMetricDefinitions();
  logger.info(`${TAG} Computing ${periodType} snapshots (${start} → ${end}) for ${staff.length} employees`);

  for (const user of staff) {
    try {
      const applicableCodes = await getApplicableMetrics(user.role);
      const metrics = await computeAllMetrics(user.id, start, end, applicableCodes);
      await saveSnapshots(user.id, metrics, periodType, start, end);

      if (withComposite) {
        const composite = await computeCompositeScore(
          user.id, user.role, metrics, definitions, start,
        );
        await saveCompositeScore(user.id, periodType, start, end, composite);

        // KPI → Gamification: award XP + aggregate quests + achievements
        await processKpiComposite(user.id, composite, periodType, start, metrics);

        // Alerts only for weekly/monthly
        if (periodType !== 'daily') {
          const alerts = await generateAlerts(
            user.id, user.role, metrics, definitions, periodType, start,
          );
          if (alerts.length > 0) {
            await saveAlerts(alerts);
            logger.info(`${TAG} ${user.displayName}: ${alerts.length} alerts`);
          }
        }
      }
    } catch (err) {
      logger.error(`${TAG} Error for ${user.displayName} (${user.id}):`, { error: String(err) });
    }
  }

  logger.info(`${TAG} ${periodType} snapshots completed`);
}

// ─── Scheduled Jobs ─────────────────────────────────────────────────

async function runDailySnapshot(): Promise<void> {
  const { start, end } = yesterday();
  await computeSnapshots('daily', start, end, true);
}

async function runWeeklySnapshot(): Promise<void> {
  const now = toMoscow(new Date());
  if (now.getDay() !== 1) return; // Only Monday
  const { start, end } = lastWeek();
  await computeSnapshots('weekly', start, end, true);
}

async function runMonthlySnapshot(): Promise<void> {
  const now = toMoscow(new Date());
  if (now.getDate() !== 1) return; // Only 1st
  const { start, end } = lastMonth();
  await computeSnapshots('monthly', start, end, true);
}

// ─── Start/Stop (called from server.ts leader election) ─────────

export function startKpiSnapshotScheduler(): void {
  logger.info(`${TAG} Starting KPI snapshot scheduler`);

  // Run initial daily snapshot after 30s delay (let other services start)
  initialTimeout = setTimeout(() => {
    runDailySnapshot().catch(err => logger.error(`${TAG} Initial daily error`, { error: String(err) }));
    runWeeklySnapshot().catch(err => logger.error(`${TAG} Initial weekly error`, { error: String(err) }));
    runMonthlySnapshot().catch(err => logger.error(`${TAG} Initial monthly error`, { error: String(err) }));
  }, 30_000);

  // Daily: every 24h
  dailyTimer = setInterval(() => {
    runDailySnapshot().catch(err => logger.error(`${TAG} Daily error`, { error: String(err) }));
  }, 24 * 60 * 60 * 1000);

  // Weekly: check every 24h (actual run only on Monday)
  weeklyTimer = setInterval(() => {
    runWeeklySnapshot().catch(err => logger.error(`${TAG} Weekly error`, { error: String(err) }));
  }, 24 * 60 * 60 * 1000);

  // Monthly: check every 24h (actual run only on 1st)
  monthlyTimer = setInterval(() => {
    runMonthlySnapshot().catch(err => logger.error(`${TAG} Monthly error`, { error: String(err) }));
  }, 24 * 60 * 60 * 1000);
}

export function stopKpiSnapshotScheduler(): void {
  if (initialTimeout) { clearTimeout(initialTimeout); initialTimeout = null; }
  if (dailyTimer) { clearInterval(dailyTimer); dailyTimer = null; }
  if (weeklyTimer) { clearInterval(weeklyTimer); weeklyTimer = null; }
  if (monthlyTimer) { clearInterval(monthlyTimer); monthlyTimer = null; }
  logger.info(`${TAG} Stopped`);
}

// ─── Manual Trigger (for backfill/admin) ────────────────────────────

export { computeSnapshots };
