/**
 * employee-gamification.service.ts — Employee XP, quests, achievements, leaderboard
 *
 * Separate from client loyalty (loyalty_profiles/points_transactions).
 * Uses: employee_xp_log, employee_achievements, employee_unlocked_achievements, employee_daily_quests
 */

import db from '../database/db.js';
import type { LockedAchievementRow, UncompletedQuestRow, XpDayRow, XpTotalRow } from '../types/views/kpi-views.js';
import type { IdOnly, CountResult } from '../types/db-common.types.js';

// ============================================================================
// Types
// ============================================================================

export interface GamificationStats {
  totalXP: number;
  level: number;
  levelProgress: number;
  nextLevelXP: number;
  streak: number;
  dailyQuests: DailyQuest[];
  recentAchievements: UnlockedAchievement[];
}

export interface DailyQuest {
  id: string;
  quest_type: string;
  title: string;
  target: number;
  progress: number;
  xp_reward: number;
  completed: boolean;
}

export interface UnlockedAchievement {
  id: string;
  code: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  xp_reward: number;
  unlocked_at: string;
}

export interface LeaderboardEntry {
  employee_id: string;
  display_name: string;
  photo_url: string | null;
  total_xp: number;
  level: number;
  rank: number;
}

export interface AchievementWithStatus {
  id: string;
  code: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  xp_reward: number;
  unlocked: boolean;
  unlocked_at: string | null;
}

export interface EmployeeProfile {
  total_shifts: number;
  completed_shifts: number;
  total_hours: number;
  avg_shift_duration: number;
  attendance_pct: number;
  punctuality_pct: number;
  current_streak: number;
  longest_streak: number;
  total_xp: number;
  level: number;
  level_progress: number;
  xp_this_month: number;
  leaderboard_rank: number;
  total_revenue: number;
  orders_count: number;
  quests_completed_total: number;
}

export interface XpLogEntry {
  xp_amount: number;
  action_type: string;
  entity_id: string | null;
  description: string | null;
  created_at: string;
}

// ============================================================================
// XP & Level calculation
// ============================================================================

const XP_REWARDS: Record<string, number> = {
  task_completed: 20,
  task_urgent: 35,
  order_processed: 15,
  chat_resolved: 10,
  review_collected: 25,
  shift_completed: 30,
  streak_bonus: 50,
};

function calculateLevel(totalXP: number): number {
  return Math.floor(Math.sqrt(totalXP / 100));
}

function xpForLevel(level: number): number {
  return level * level * 100;
}

// ============================================================================
// Core functions
// ============================================================================

export async function awardXP(
  employeeId: string,
  actionType: string,
  entityId?: string,
  description?: string,
): Promise<void> {
  const xpAmount = XP_REWARDS[actionType] || 10;

  await db.query(
    `INSERT INTO employee_xp_log (employee_id, xp_amount, action_type, entity_id, description)
     VALUES ($1, $2, $3, $4, $5)`,
    [employeeId, xpAmount, actionType, entityId || null, description || null],
  );

  // Update quest progress
  const questTypeMap: Record<string, string> = {
    task_completed: 'complete_tasks',
    task_urgent: 'complete_tasks',
    order_processed: 'process_orders',
    chat_resolved: 'resolve_chats',
    review_collected: 'collect_reviews',
  };

  const questType = questTypeMap[actionType];
  if (questType) {
    await db.query(
      `UPDATE employee_daily_quests
       SET progress = progress + 1,
           completed = CASE WHEN progress + 1 >= target THEN true ELSE completed END
       WHERE employee_id = $1 AND quest_date = CURRENT_DATE AND quest_type = $2 AND NOT completed`,
      [employeeId, questType],
    );

    // Check if quest just completed → award quest XP
    const justCompleted = await db.query<{ id: string; xp_reward: number }>(
      `SELECT id, xp_reward FROM employee_daily_quests
       WHERE employee_id = $1 AND quest_date = CURRENT_DATE AND quest_type = $2
         AND completed = true AND progress = target`,
      [employeeId, questType],
    );
    for (const q of justCompleted) {
      await db.query(
        `INSERT INTO employee_xp_log (employee_id, xp_amount, action_type, entity_id, description)
         VALUES ($1, $2, 'quest_completed', $3, $4)`,
        [employeeId, q.xp_reward, q.id, `Квест завершён`],
      );
    }
  }

  // Check achievements (fire-and-forget)
  checkAchievements(employeeId).catch(() => {});
}

export async function getMyStats(employeeId: string): Promise<GamificationStats> {
  // Total XP
  const xpResult = await db.queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(xp_amount), 0) as total FROM employee_xp_log WHERE employee_id = $1`,
    [employeeId],
  );
  const totalXP = parseInt(xpResult?.total || '0', 10);
  const level = calculateLevel(totalXP);
  const currentLevelXP = xpForLevel(level);
  const nextLevelXP = xpForLevel(level + 1);
  const levelProgress = nextLevelXP > currentLevelXP
    ? Math.round(((totalXP - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100)
    : 100;

  // Streak (consecutive days with shift_completed)
  const streakResult = await db.query<{ day: string }>(
    `SELECT DISTINCT DATE(created_at) as day FROM employee_xp_log
     WHERE employee_id = $1 AND action_type = 'shift_completed'
     ORDER BY day DESC LIMIT 60`,
    [employeeId],
  );
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < streakResult.length; i++) {
    const expected = new Date(today);
    expected.setDate(expected.getDate() - i);
    const dayStr = expected.toISOString().split('T')[0];
    if (streakResult[i].day === dayStr) {
      streak++;
    } else {
      break;
    }
  }

  // Daily quests (generate if none for today)
  await generateDailyQuests(employeeId);
  const dailyQuests = await db.query<DailyQuest>(
    `SELECT id, quest_type, title, target, progress, xp_reward, completed
     FROM employee_daily_quests
     WHERE employee_id = $1 AND quest_date = CURRENT_DATE
     ORDER BY created_at`,
    [employeeId],
  );

  // Recent achievements (last 5)
  const recentAchievements = await db.query<UnlockedAchievement>(
    `SELECT ua.id, a.code, a.title, a.description, a.icon, a.category, a.xp_reward, ua.unlocked_at
     FROM employee_unlocked_achievements ua
     JOIN employee_achievements a ON a.id = ua.achievement_id
     WHERE ua.employee_id = $1
     ORDER BY ua.unlocked_at DESC LIMIT 5`,
    [employeeId],
  );

  return {
    totalXP,
    level,
    levelProgress,
    nextLevelXP,
    streak,
    dailyQuests,
    recentAchievements,
  };
}

export async function getLeaderboard(period: string = 'month'): Promise<LeaderboardEntry[]> {
  const intervals: Record<string, string> = {
    week: '7 days',
    month: '30 days',
    all: '10 years',
  };
  const interval = intervals[period] || '30 days';

  const rows = await db.query<{
    employee_id: string;
    display_name: string;
    photo_url: string | null;
    total_xp: string;
  }>(
    `SELECT xl.employee_id, u.display_name, u.photo_url,
            SUM(xl.xp_amount) as total_xp
     FROM employee_xp_log xl
     JOIN users u ON u.id = xl.employee_id
     WHERE xl.created_at > NOW() - $1::interval
     GROUP BY xl.employee_id, u.display_name, u.photo_url
     ORDER BY total_xp DESC
     LIMIT 10`,
    [interval],
  );

  return rows.map((r, i) => ({
    employee_id: r.employee_id,
    display_name: r.display_name,
    photo_url: r.photo_url,
    total_xp: parseInt(r.total_xp, 10),
    level: calculateLevel(parseInt(r.total_xp, 10)),
    rank: i + 1,
  }));
}

export async function getAchievements(employeeId: string): Promise<AchievementWithStatus[]> {
  return db.query<AchievementWithStatus>(
    `SELECT a.id, a.code, a.title, a.description, a.icon, a.category, a.xp_reward,
            CASE WHEN ua.id IS NOT NULL THEN true ELSE false END as unlocked,
            ua.unlocked_at
     FROM employee_achievements a
     LEFT JOIN employee_unlocked_achievements ua ON ua.achievement_id = a.id AND ua.employee_id = $1
     ORDER BY a.sort_order`,
    [employeeId],
  );
}

// ============================================================================
// Profile & XP Log
// ============================================================================

export async function getMyProfile(employeeId: string): Promise<EmployeeProfile> {
  // Shifts stats
  const shiftsRow = await db.queryOne<{
    total_shifts: string;
    completed_shifts: string;
    total_hours: string;
    avg_duration: string;
  }>(
    `SELECT
       COUNT(*) as total_shifts,
       COUNT(*) FILTER (WHERE status = 'completed') as completed_shifts,
       COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 3600) FILTER (WHERE status = 'completed'), 0) as total_hours,
       COALESCE(AVG(EXTRACT(EPOCH FROM (end_time - start_time)) / 3600) FILTER (WHERE status = 'completed'), 0) as avg_duration
     FROM employee_shifts WHERE employee_id = $1`,
    [employeeId],
  );

  const totalShifts = parseInt(shiftsRow?.total_shifts || '0', 10);
  const completedShifts = parseInt(shiftsRow?.completed_shifts || '0', 10);
  const totalHours = parseFloat(shiftsRow?.total_hours || '0');
  const avgDuration = parseFloat(shiftsRow?.avg_duration || '0');

  // Attendance & punctuality
  const attendanceRow = await db.queryOne<{ scheduled: string; showed_up: string; on_time: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('completed', 'active', 'scheduled') AND shift_date <= CURRENT_DATE) as scheduled,
       COUNT(*) FILTER (WHERE status IN ('completed', 'active')) as showed_up,
       COUNT(*) FILTER (WHERE status = 'completed' AND checked_in_at IS NOT NULL
         AND checked_in_at <= (shift_date + start_time + INTERVAL '5 minutes')) as on_time
     FROM employee_shifts WHERE employee_id = $1`,
    [employeeId],
  );

  const scheduled = parseInt(attendanceRow?.scheduled || '0', 10);
  const showedUp = parseInt(attendanceRow?.showed_up || '0', 10);
  const onTime = parseInt(attendanceRow?.on_time || '0', 10);
  const attendancePct = scheduled > 0 ? Math.round((showedUp / scheduled) * 100) : 100;
  const punctualityPct = showedUp > 0 ? Math.round((onTime / showedUp) * 100) : 100;

  // XP
  const xpRow = await db.queryOne<{ total: string; this_month: string }>(
    `SELECT
       COALESCE(SUM(xp_amount), 0) as total,
       COALESCE(SUM(xp_amount) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE)), 0) as this_month
     FROM employee_xp_log WHERE employee_id = $1`,
    [employeeId],
  );
  const totalXP = parseInt(xpRow?.total || '0', 10);
  const xpThisMonth = parseInt(xpRow?.this_month || '0', 10);
  const level = calculateLevel(totalXP);
  const currentLevelXP = xpForLevel(level);
  const nextLevelXP = xpForLevel(level + 1);
  const levelProgress = nextLevelXP > currentLevelXP
    ? Math.round(((totalXP - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100)
    : 100;

  // Streak
  const streakDays = await db.query<{ day: string }>(
    `SELECT DISTINCT DATE(created_at) as day FROM employee_xp_log
     WHERE employee_id = $1 AND action_type = 'shift_completed'
     ORDER BY day DESC LIMIT 60`,
    [employeeId],
  );
  let currentStreak = 0;
  let longestStreak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < streakDays.length; i++) {
    const expected = new Date(today);
    expected.setDate(expected.getDate() - i);
    const dayStr = expected.toISOString().split('T')[0];
    if (streakDays[i].day === dayStr) {
      currentStreak++;
    } else {
      break;
    }
  }
  // Longest streak — simplified: use current if no history tracking
  longestStreak = currentStreak;

  // Leaderboard rank
  const rankRow = await db.queryOne<{ rank: string }>(
    `SELECT COUNT(*) + 1 as rank FROM (
       SELECT employee_id, SUM(xp_amount) as xp
       FROM employee_xp_log
       WHERE created_at > NOW() - INTERVAL '30 days'
       GROUP BY employee_id
       HAVING SUM(xp_amount) > (
         SELECT COALESCE(SUM(xp_amount), 0) FROM employee_xp_log
         WHERE employee_id = $1 AND created_at > NOW() - INTERVAL '30 days'
       )
     ) sub`,
    [employeeId],
  );
  const leaderboardRank = parseInt(rankRow?.rank || '1', 10);

  // Revenue (from POS receipts)
  const revRow = await db.queryOne<{ revenue: string; orders: string }>(
    `SELECT
       COALESCE(SUM(total::numeric), 0) as revenue,
       COUNT(*) as orders
     FROM pos_receipts
     WHERE employee_id = $1 AND is_refund = false`,
    [employeeId],
  );
  const totalRevenue = parseFloat(revRow?.revenue || '0');
  const ordersCount = parseInt(revRow?.orders || '0', 10);

  // Quests completed total
  const questsRow = await db.queryOne<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM employee_daily_quests WHERE employee_id = $1 AND completed = true`,
    [employeeId],
  );
  const questsCompleted = parseInt(questsRow?.cnt || '0', 10);

  return {
    total_shifts: totalShifts,
    completed_shifts: completedShifts,
    total_hours: Math.round(totalHours * 10) / 10,
    avg_shift_duration: Math.round(avgDuration * 10) / 10,
    attendance_pct: attendancePct,
    punctuality_pct: punctualityPct,
    current_streak: currentStreak,
    longest_streak: longestStreak,
    total_xp: totalXP,
    level,
    level_progress: levelProgress,
    xp_this_month: xpThisMonth,
    leaderboard_rank: leaderboardRank,
    total_revenue: totalRevenue,
    orders_count: ordersCount,
    quests_completed_total: questsCompleted,
  };
}

export async function getMyXpLog(employeeId: string, limit = 30): Promise<XpLogEntry[]> {
  return db.query<XpLogEntry>(
    `SELECT xp_amount, action_type, entity_id, description, created_at
     FROM employee_xp_log
     WHERE employee_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [employeeId, limit],
  );
}

// ============================================================================
// Internal helpers
// ============================================================================

const QUEST_TEMPLATES = [
  { type: 'complete_tasks', title: 'Закрой {n} задач', targets: [3, 5, 7], xpRewards: [30, 50, 80] },
  { type: 'process_orders', title: 'Обработай {n} заказов', targets: [2, 4, 6], xpRewards: [25, 45, 70] },
  { type: 'resolve_chats', title: 'Закрой {n} чатов', targets: [3, 5, 8], xpRewards: [20, 40, 65] },
  { type: 'collect_reviews', title: 'Собери {n} отзывов', targets: [1, 2, 3], xpRewards: [30, 55, 80] },
];

async function generateDailyQuests(employeeId: string): Promise<void> {
  // Check if quests exist for today
  const existing = await db.queryOne<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM employee_daily_quests WHERE employee_id = $1 AND quest_date = CURRENT_DATE`,
    [employeeId],
  );
  if (parseInt(existing?.cnt || '0', 10) > 0) return;

  // Pick 3 random quest types
  const shuffled = [...QUEST_TEMPLATES].sort(() => Math.random() - 0.5).slice(0, 3);

  for (const tmpl of shuffled) {
    const difficultyIdx = Math.floor(Math.random() * tmpl.targets.length);
    const target = tmpl.targets[difficultyIdx];
    const xpReward = tmpl.xpRewards[difficultyIdx];
    const title = tmpl.title.replace('{n}', String(target));

    await db.query(
      `INSERT INTO employee_daily_quests (employee_id, quest_date, quest_type, title, target, xp_reward)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5)
       ON CONFLICT (employee_id, quest_date, quest_type) DO NOTHING`,
      [employeeId, tmpl.type, title, target, xpReward],
    );
  }
}

export async function checkAchievements(employeeId: string): Promise<void> {
  // Get all not-yet-unlocked achievements
  const locked = await db.query<LockedAchievementRow>(
    `SELECT a.id, a.code, a.condition, a.xp_reward
     FROM employee_achievements a
     WHERE NOT EXISTS (
       SELECT 1 FROM employee_unlocked_achievements ua
       WHERE ua.achievement_id = a.id AND ua.employee_id = $1
     )`,
    [employeeId],
  );

  for (const ach of locked) {
    const rawCond = typeof ach.condition === 'string' ? JSON.parse(ach.condition as string) : ach.condition;
    const cond = rawCond as Record<string, unknown>;
    let met = false;

    const condTarget = typeof cond['target'] === 'number' ? cond['target'] : 0;
    const condAction = typeof cond['action'] === 'string' ? cond['action'] : '';

    if (cond['type'] === 'count' && condAction && condTarget > 0) {
      const result = await db.queryOne<CountResult>(
        `SELECT COUNT(*)::int as cnt FROM employee_xp_log WHERE employee_id = $1 AND action_type = $2`,
        [employeeId, condAction],
      );
      met = (result?.cnt ?? 0) >= condTarget;
    } else if (cond['type'] === 'streak' && condTarget > 0) {
      // Calculate streak
      const days = await db.query<XpDayRow>(
        `SELECT DISTINCT DATE(created_at)::text as day FROM employee_xp_log
         WHERE employee_id = $1 AND action_type = 'shift_completed'
         ORDER BY day DESC LIMIT $2`,
        [employeeId, condTarget + 5],
      );
      let streak = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      for (let i = 0; i < days.length; i++) {
        const expected = new Date(today);
        expected.setDate(expected.getDate() - i);
        const dayStr = expected.toISOString().split('T')[0];
        if (days[i].day === dayStr) {
          streak++;
        } else {
          break;
        }
      }
      met = streak >= condTarget;
    } else if (cond['type'] === 'total_xp' && condTarget > 0) {
      const result = await db.queryOne<XpTotalRow>(
        `SELECT COALESCE(SUM(xp_amount), 0)::int as total FROM employee_xp_log WHERE employee_id = $1`,
        [employeeId],
      );
      met = (result?.total ?? 0) >= condTarget;
    }

    if (met) {
      await db.query(
        `INSERT INTO employee_unlocked_achievements (employee_id, achievement_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [employeeId, ach.id],
      );
      // Award achievement XP
      if (ach.xp_reward > 0) {
        await db.query(
          `INSERT INTO employee_xp_log (employee_id, xp_amount, action_type, entity_id, description)
           VALUES ($1, $2, 'achievement_unlocked', $3, $4)`,
          [employeeId, ach.xp_reward, ach.id, `Ачивка: ${ach.code}`],
        );
      }
    }
  }
}

// ============================================================================
// KPI-Gamification Bridge functions
// ============================================================================

/**
 * Award XP with idempotency check (entity_id deduplication).
 * Returns true if XP was awarded, false if already awarded (dedup).
 */
export async function awardXPIdempotent(
  employeeId: string,
  actionType: string,
  xpAmount: number,
  entityId: string,
  description: string,
): Promise<boolean> {
  // Check for existing entry with same entity_id
  const existing = await db.queryOne<IdOnly>(
    `SELECT id FROM employee_xp_log
     WHERE employee_id = $1 AND entity_id = $2`,
    [employeeId, entityId],
  );
  if (existing) return false;

  await db.query(
    `INSERT INTO employee_xp_log (employee_id, xp_amount, action_type, entity_id, description)
     VALUES ($1, $2, $3, $4, $5)`,
    [employeeId, xpAmount, actionType, entityId, description],
  );

  // Trigger achievement check after XP award
  await checkAchievements(employeeId);

  return true;
}

/**
 * Evaluate aggregate quests that depend on computed KPI metrics.
 * Checks uncompleted daily quests and compares their target against
 * the corresponding metric value from the KPI computation engine.
 * Returns the number of quests completed.
 */
export async function evaluateAggregateQuests(
  employeeId: string,
  questDate: string,
  metricsMap: Map<string, number>,
): Promise<number> {
  // Quest type to metric code mapping for aggregate evaluation
  const QUEST_METRIC_MAP: Record<string, string> = {
    complete_tasks: 'prod_tasks_completed',
    process_orders: 'prod_orders_processed',
    resolve_chats: 'prod_chats_resolved',
    collect_reviews: 'sat_feedback_count',
  };

  const uncompleted = await db.query<UncompletedQuestRow>(
    `SELECT id, quest_type, xp_reward, target, progress
     FROM employee_daily_quests
     WHERE employee_id = $1 AND quest_date = $2::date AND completed = false`,
    [employeeId, questDate],
  );

  let completedCount = 0;

  for (const quest of uncompleted) {
    const metricCode = QUEST_METRIC_MAP[quest.quest_type];
    if (!metricCode) continue;

    const metricValue = metricsMap.get(metricCode);
    if (metricValue === undefined) continue;

    // If the metric value meets or exceeds the quest target, complete the quest
    if (metricValue >= quest.target && quest.progress < quest.target) {
      await db.query(
        `UPDATE employee_daily_quests
         SET progress = $2, completed = true
         WHERE id = $1`,
        [quest.id, quest.target],
      );

      // Award quest completion XP (idempotent via entity_id)
      await awardXPIdempotent(
        employeeId,
        'quest_completed',
        quest.xp_reward,
        `quest:${quest.id}`,
        'Квест завершён (KPI агрегат)',
      );

      completedCount++;
    }
  }

  return completedCount;
}
