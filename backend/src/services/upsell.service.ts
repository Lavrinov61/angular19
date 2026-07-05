/**
 * upsell.service.ts — Upsell bonus computation engine
 *
 * Business rules:
 *   Conversion: offers_accepted / total_offers × 100
 *     ≥30% → +3000₽, ≥50% → +5000₽, ≥70% → +8000₽
 *   Quarterly avg check: >1000₽ → +8000₽, >1300₽ → +15000₽, >1500₽ → +25000₽
 *   Team revenue: >350K → +2000₽, >500K → +5000₽, >700K → +8000₽
 *   Streak: consecutive work days with ≥1 accepted upsell
 */

import db from '../database/db.js';
import type { UsersId } from '../types/generated/public/Users.js';
import type { OrdersId } from '../types/generated/public/Orders.js';

// ─── Response types ──────────────────────────────────────────────────

export interface UpsellStatsResponse {
  total_offers: number;
  accepted: number;
  conversion_pct: number;
  avg_check: number;
  streak_current: number;
  streak_best: number;
  bonus_progress: {
    conversion: { pct: number; threshold: number; bonus_amount: number };
    quarterly: { avg_check: number; threshold: number; bonus_amount: number };
    team: { revenue: number; target: number; bonus_amount: number };
  };
}

export interface StreakResponse {
  current: number;
  best: number;
  days: { date: string; had_upsell: boolean }[];
}

export interface StudioRevenueResponse {
  total: number;
  target: number;
  bonus_if_reached: number;
}

// ─── DB row types (Pick from Kanel where possible) ───────────────────

interface UpsellCountRow {
  total: string;
  accepted: string;
}

interface AvgCheckRow {
  avg_check: string;
}

interface ShiftUpsellRow {
  shift_date: string;
  has_upsell: boolean;
}

interface StudioRevenueRow {
  total: string;
}

// ─── Bonus thresholds ────────────────────────────────────────────────

const CONVERSION_TIERS = [
  { threshold: 70, bonus: 8000 },
  { threshold: 50, bonus: 5000 },
  { threshold: 30, bonus: 3000 },
] as const;

const QUARTERLY_TIERS = [
  { threshold: 1500, bonus: 25000 },
  { threshold: 1300, bonus: 15000 },
  { threshold: 1000, bonus: 8000 },
] as const;

const TEAM_TIERS = [
  { threshold: 700_000, bonus: 8000 },
  { threshold: 500_000, bonus: 5000 },
  { threshold: 350_000, bonus: 2000 },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────

function getMonthRange(month: string): { start: string; end: string } {
  const [year, mon] = month.split('-').map(Number);
  const start = `${year}-${String(mon).padStart(2, '0')}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const end = `${year}-${String(mon).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

function getQuarterRange(month: string): { start: string; end: string; label: string } {
  const [year, mon] = month.split('-').map(Number);
  const q = Math.ceil(mon / 3);
  const qStart = (q - 1) * 3 + 1;
  const qEnd = q * 3;
  const start = `${year}-${String(qStart).padStart(2, '0')}-01`;
  const lastDay = new Date(year, qEnd, 0).getDate();
  const end = `${year}-${String(qEnd).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end, label: `Q${q}-${year}` };
}

function findTier<T extends { threshold: number; bonus: number }>(
  value: number,
  tiers: readonly T[],
): { threshold: number; bonus: number } {
  for (const tier of tiers) {
    if (value >= tier.threshold) return { threshold: tier.threshold, bonus: tier.bonus };
  }
  return { threshold: tiers[tiers.length - 1].threshold, bonus: 0 };
}

// ─── Public API ──────────────────────────────────────────────────────

export async function getUpsellStats(
  employeeId: UsersId,
  month: string,
): Promise<UpsellStatsResponse> {
  const { start, end } = getMonthRange(month);
  const quarter = getQuarterRange(month);

  // Upsell counts for the month
  const countRow = await db.queryOne<UpsellCountRow>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE accepted)::text AS accepted
     FROM employee_upsell_offers
     WHERE employee_id = $1 AND shift_date BETWEEN $2::date AND $3::date`,
    [employeeId, start, end],
  );

  const total = parseInt(countRow?.total || '0', 10);
  const accepted = parseInt(countRow?.accepted || '0', 10);
  const conversionPct = total > 0 ? Math.round((accepted / total) * 10000) / 100 : 0;

  // Average check for the quarter (orders created by this employee)
  const avgRow = await db.queryOne<AvgCheckRow>(
    `SELECT COALESCE(AVG(o.total_amount::numeric), 0)::text AS avg_check
     FROM orders o
     JOIN employee_shifts es ON es.employee_id = $1
       AND es.shift_date = o.created_at::date
     WHERE o.created_at BETWEEN $2::date AND ($3::date + 1)
       AND o.status NOT IN ('cancelled', 'refunded')
       AND o.total_amount IS NOT NULL
       AND es.employee_id = $1`,
    [employeeId, quarter.start, quarter.end],
  );
  const avgCheck = Math.round(parseFloat(avgRow?.avg_check || '0'));

  // Studio revenue for the month (via employee's studio shifts)
  const revenueRow = await db.queryOne<StudioRevenueRow>(
    `SELECT COALESCE(SUM(o.total_amount::numeric), 0)::text AS total
     FROM orders o
     WHERE o.created_at BETWEEN $1::date AND ($2::date + 1)
       AND o.status NOT IN ('cancelled', 'refunded')
       AND o.total_amount IS NOT NULL`,
    [start, end],
  );
  const studioRevenue = Math.round(parseFloat(revenueRow?.total || '0'));

  // Streak
  const { current: streakCurrent, best: streakBest } = await computeStreak(employeeId, month);

  // Determine bonus tiers
  const convTier = findTier(conversionPct, CONVERSION_TIERS);
  const qTier = findTier(avgCheck, QUARTERLY_TIERS);
  const teamTier = findTier(studioRevenue, TEAM_TIERS);

  return {
    total_offers: total,
    accepted,
    conversion_pct: conversionPct,
    avg_check: avgCheck,
    streak_current: streakCurrent,
    streak_best: streakBest,
    bonus_progress: {
      conversion: { pct: conversionPct, threshold: convTier.threshold, bonus_amount: convTier.bonus },
      quarterly: { avg_check: avgCheck, threshold: qTier.threshold, bonus_amount: qTier.bonus },
      team: { revenue: studioRevenue, target: teamTier.threshold, bonus_amount: teamTier.bonus },
    },
  };
}

export async function recordUpsellOffer(
  employeeId: UsersId,
  orderId: OrdersId | null,
  offeredItems: string[],
  accepted: boolean,
): Promise<{ id: string }> {
  const row = await db.queryOne<{ id: string }>(
    `INSERT INTO employee_upsell_offers (employee_id, order_id, offered_items, accepted)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [employeeId, orderId, offeredItems, accepted],
  );
  return { id: row!.id };
}

export async function getUpsellStreak(
  employeeId: UsersId,
  month: string,
): Promise<StreakResponse> {
  const { current, best, days } = await computeStreak(employeeId, month);
  return { current, best, days };
}

export async function getStudioRevenue(month: string): Promise<StudioRevenueResponse> {
  const { start, end } = getMonthRange(month);

  const row = await db.queryOne<StudioRevenueRow>(
    `SELECT COALESCE(SUM(o.total_amount::numeric), 0)::text AS total
     FROM orders o
     WHERE o.created_at BETWEEN $1::date AND ($2::date + 1)
       AND o.status NOT IN ('cancelled', 'refunded')
       AND o.total_amount IS NOT NULL`,
    [start, end],
  );
  const total = Math.round(parseFloat(row?.total || '0'));
  const teamTier = findTier(total, TEAM_TIERS);

  return {
    total,
    target: teamTier.threshold,
    bonus_if_reached: teamTier.bonus,
  };
}

// ─── Streak computation ──────────────────────────────────────────────

async function computeStreak(
  employeeId: UsersId,
  month: string,
): Promise<{ current: number; best: number; days: { date: string; had_upsell: boolean }[] }> {
  const { start, end } = getMonthRange(month);

  // Get all shift dates for this employee in the month, with upsell flag
  const rows = await db.query<ShiftUpsellRow>(
    `SELECT
       es.shift_date::text AS shift_date,
       EXISTS (
         SELECT 1 FROM employee_upsell_offers euo
         WHERE euo.employee_id = es.employee_id
           AND euo.shift_date = es.shift_date
           AND euo.accepted = true
       ) AS has_upsell
     FROM employee_shifts es
     WHERE es.employee_id = $1 AND es.shift_date BETWEEN $2::date AND $3::date
     ORDER BY es.shift_date ASC`,
    [employeeId, start, end],
  );

  let current = 0;
  let best = 0;
  let streak = 0;

  const days: { date: string; had_upsell: boolean }[] = [];
  for (const row of rows) {
    days.push({ date: row.shift_date, had_upsell: row.has_upsell });
    if (row.has_upsell) {
      streak++;
      if (streak > best) best = streak;
    } else {
      streak = 0;
    }
  }
  current = streak;

  return { current, best, days };
}
