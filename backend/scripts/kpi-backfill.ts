/**
 * kpi-backfill.ts — One-time 90-day historical KPI backfill
 *
 * Usage: cd backend && npx tsx scripts/kpi-backfill.ts
 *
 * Computes daily snapshots for the last 90 days for all staff users,
 * then aggregates into weekly and monthly snapshots with composite scores.
 */

import db from '../src/database/db.js';
import {
  computeAllMetrics,
  computeCompositeScore,
  getMetricDefinitions,
  getApplicableMetrics,
  getStaffUsers,
  saveSnapshots,
  saveCompositeScore,
} from '../src/services/kpi-computation.service.js';

const DAYS_BACK = 90;

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

async function backfill(): Promise<void> {
  console.log('[KPI-Backfill] Starting 90-day historical backfill...');

  const staff = await getStaffUsers();
  const definitions = await getMetricDefinitions();
  console.log(`[KPI-Backfill] Found ${staff.length} staff users, ${definitions.length} metrics`);

  const today = new Date();

  for (const user of staff) {
    console.log(`[KPI-Backfill] Processing ${user.displayName} (${user.role})...`);
    const applicableCodes = await getApplicableMetrics(user.role);

    // ── Daily snapshots ──
    for (let i = DAYS_BACK; i >= 1; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const ds = formatDate(d);

      try {
        const metrics = await computeAllMetrics(user.id, ds, ds, applicableCodes);
        const hasData = metrics.some(m => m.value > 0);
        if (!hasData) continue;

        await saveSnapshots(user.id, metrics, 'daily', ds, ds);

        const composite = await computeCompositeScore(user.id, user.role, metrics, definitions, ds);
        await saveCompositeScore(user.id, 'daily', ds, ds, composite);
      } catch (err) {
        console.error(`  Day ${ds} error:`, (err as Error).message);
      }
    }

    // ── Weekly snapshots (last 12 weeks) ──
    for (let w = 12; w >= 1; w--) {
      const weekEnd = new Date(today);
      weekEnd.setDate(weekEnd.getDate() - (w * 7));
      const weekDay = weekEnd.getDay();
      const sunday = new Date(weekEnd);
      sunday.setDate(weekEnd.getDate() + (7 - weekDay));
      const monday = new Date(sunday);
      monday.setDate(sunday.getDate() - 6);

      const ws = formatDate(monday);
      const we = formatDate(sunday);

      try {
        const metrics = await computeAllMetrics(user.id, ws, we, applicableCodes);
        const hasData = metrics.some(m => m.value > 0);
        if (!hasData) continue;

        await saveSnapshots(user.id, metrics, 'weekly', ws, we);
        const composite = await computeCompositeScore(user.id, user.role, metrics, definitions, ws);
        await saveCompositeScore(user.id, 'weekly', ws, we, composite);
      } catch (err) {
        console.error(`  Week ${ws} error:`, (err as Error).message);
      }
    }

    // ── Monthly snapshots (last 3 months) ──
    for (let m = 3; m >= 1; m--) {
      const firstOfMonth = new Date(today.getFullYear(), today.getMonth() - m, 1);
      const lastOfMonth = new Date(today.getFullYear(), today.getMonth() - m + 1, 0);
      const ms = formatDate(firstOfMonth);
      const me = formatDate(lastOfMonth);

      try {
        const metrics = await computeAllMetrics(user.id, ms, me, applicableCodes);
        const hasData = metrics.some(m => m.value > 0);
        if (!hasData) continue;

        await saveSnapshots(user.id, metrics, 'monthly', ms, me);
        const composite = await computeCompositeScore(user.id, user.role, metrics, definitions, ms);
        await saveCompositeScore(user.id, 'monthly', ms, me, composite);
      } catch (err) {
        console.error(`  Month ${ms} error:`, (err as Error).message);
      }
    }

    console.log(`  Done: ${user.displayName}`);
  }

  console.log('[KPI-Backfill] Completed!');
  await db.close();
  process.exit(0);
}

backfill().catch(err => {
  console.error('[KPI-Backfill] Fatal error:', err);
  process.exit(1);
});
