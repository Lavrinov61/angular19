/**
 * kpi-gamification-bridge.service.ts — KPI ↔ Gamification integration
 *
 * Enterprise-grade bridge between KPI computation engine and gamification system.
 * Called from kpi-snapshot-scheduler after composite scores are saved.
 *
 * Guarantees:
 *   - Idempotent: safe to re-run for the same period (deduplication via entity_id)
 *   - Isolated: gamification errors never break KPI snapshots (caller wraps in try/catch)
 *   - Auditable: all XP awards logged with action_type + entity_id + description
 *   - Concurrent-safe: scheduler leader election ensures single execution
 *
 * Flow per employee per snapshot:
 *   1. Award XP based on composite rating (idempotent)
 *   2. Evaluate aggregate quests using computed metrics (daily only)
 *   3. Check KPI-specific achievements (deduplicated by achievement_id)
 *   4. Check general achievements (xp_1000 etc., triggered by awardXPIdempotent)
 */

import type { MetricResult, CompositeResult } from './kpi-computation.service.js';
import { createLogger } from '../utils/logger.js';
import {
  awardXPIdempotent,
  evaluateAggregateQuests,
  checkAchievements,
} from './employee-gamification.service.js';

const logger = createLogger('kpi-gamification-bridge.service');
const TAG = '[KPI-Gamification]';

// ─── XP Reward Matrix ────────────────────────────────────────────────

/**
 * XP rewards for KPI composite score ratings.
 * Keyed by period type → rating → XP amount.
 *
 * Only positive ratings are rewarded (no penalty for below/critical).
 * Monthly rewards are highest (long-term consistency is valuable).
 */
const KPI_XP_MATRIX: ReadonlyArray<{
  periodType: string;
  rating: string;
  xp: number;
}> = [
  // Daily rewards — frequent, small amounts
  { periodType: 'daily', rating: 'exceptional', xp: 50 },
  { periodType: 'daily', rating: 'good', xp: 30 },
  // Weekly rewards — moderate
  { periodType: 'weekly', rating: 'exceptional', xp: 100 },
  { periodType: 'weekly', rating: 'good', xp: 50 },
  // Monthly rewards — significant
  { periodType: 'monthly', rating: 'exceptional', xp: 200 },
  { periodType: 'monthly', rating: 'good', xp: 100 },
  { periodType: 'monthly', rating: 'meeting', xp: 50 },
];

// Pre-compute lookup for O(1) access
const XP_LOOKUP = new Map(
  KPI_XP_MATRIX.map(r => [`${r.periodType}:${r.rating}`, r.xp]),
);

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Process a KPI composite score for gamification rewards.
 *
 * @param employeeId — employee UUID
 * @param composite — computed composite score with rating and category scores
 * @param periodType — daily | weekly | monthly
 * @param periodStart — date string (YYYY-MM-DD), used as dedup key
 * @param metrics — raw metric results (needed for aggregate quest evaluation)
 */
export async function processKpiComposite(
  employeeId: string,
  composite: CompositeResult,
  periodType: 'daily' | 'weekly' | 'monthly',
  periodStart: string,
  metrics: MetricResult[] = [],
): Promise<void> {
  const t0 = Date.now();
  let xpAwarded = false;
  let questsCompleted = 0;

  try {
    // ── Step 1: Award XP based on composite rating (idempotent) ──
    const xpAmount = XP_LOOKUP.get(`${periodType}:${composite.rating}`);
    if (xpAmount) {
      const actionType = `kpi_${periodType}_${composite.rating}`;
      const entityId = `${periodType}:${periodStart}`;
      xpAwarded = await awardXPIdempotent(
        employeeId,
        actionType,
        xpAmount,
        entityId,
        `KPI ${periodType} ${periodStart}: score=${composite.compositeScore.toFixed(1)}, rating=${composite.rating}`,
      );
    }

    // ── Step 2: Evaluate aggregate quests (daily snapshots only) ──
    if (periodType === 'daily' && metrics.length > 0) {
      const metricsMap = new Map(metrics.map(m => [m.code, m.value]));
      questsCompleted = await evaluateAggregateQuests(employeeId, periodStart, metricsMap);
    }

    // ── Step 3: Check KPI-specific achievements ──
    // General achievement check is already triggered by awardXPIdempotent.
    // Only run explicit check if no XP was awarded (dedup case) but
    // composite data changed (new period = new achievement eligibility).
    if (!xpAwarded) {
      await checkAchievements(employeeId);
    }

  } catch (err) {
    // Isolated: log and swallow — KPI snapshots must not be affected
    logger.error(`${TAG} Error processing ${employeeId} ${periodType}:${periodStart}:`, { error: String(err) });
    return;
  }

  // ── Telemetry ──
  const elapsed = Date.now() - t0;
  if (xpAwarded || questsCompleted > 0) {
    logger.info(
      `${TAG} ${employeeId} ${periodType}:${periodStart} — ` +
      `xp=${xpAwarded ? 'awarded' : 'dedup'}, quests=${questsCompleted}, ${elapsed}ms`,
    );
  }
}
