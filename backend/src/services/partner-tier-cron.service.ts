/**
 * Partner Tier Cron Service — автоматический пересчёт тиров партнёров.
 *
 * Логика:
 * 1. Каждые сутки пересчитывает monthly_revenue для каждого партнёра
 *    (сумма commission_amount по подтверждённым/оплаченным рефералам за 30 дней).
 * 2. Проверяет, соответствует ли выручка новому уровню:
 *    - Повышение: сразу при достижении порога.
 *    - Понижение: только после downgrade_grace_months месяцев ниже порога.
 * 3. Уведомляет партнёра при изменении тира.
 *
 * Вызывается из server.ts cron-расписанием (ежедневно в 02:00).
 */

import db from '../database/db.js';
import type { PartnerTierRow } from './partners.service.js';

import { createLogger } from '../utils/logger.js';
interface PartnerForTier {
  id: number;
  name: string;
  tier_slug: string;
  monthly_revenue: string;
  downgrade_months_count: number;
}

const logger = createLogger('partner-tier-cron.service');
/**
 * Пересчитывает monthly_revenue и тир для всех активных партнёров.
 * Возвращает количество обновлённых тиров.
 */
export async function recalculatePartnerTiers(): Promise<{ updated: number; errors: number }> {
  let updated = 0;
  let errors = 0;

  // Load all tiers sorted by min_monthly_revenue DESC (highest first for upgrade check)
  const tiers = await db.query<PartnerTierRow>(
    `SELECT * FROM partner_tiers WHERE is_manual_only = false ORDER BY min_monthly_revenue DESC`,
  );

  if (tiers.length === 0) {
    logger.info('[PartnerTierCron] No tiers found, skipping.');
    return { updated, errors };
  }

  // Get all approved partners
  const partners = await db.query<PartnerForTier>(
    `SELECT id, name, COALESCE(tier_slug, 'start') AS tier_slug,
            COALESCE(monthly_revenue, 0)::text AS monthly_revenue,
            COALESCE(downgrade_months_count, 0) AS downgrade_months_count
     FROM partners WHERE status = 'approved'`,
  );

  logger.info(`[PartnerTierCron] Processing ${partners.length} partners...`);

  for (const partner of partners) {
    try {
      const hasAutoTier = tiers.some(t => t.slug === partner.tier_slug);
      if (!hasAutoTier) {
        // Keep manual-only tiers untouched by automatic recalculation.
        continue;
      }

      // Calculate actual monthly revenue (commission from confirmed/paid referrals in last 30 days)
      const revenueRow = await db.queryOne<{ revenue: string }>(
        `SELECT COALESCE(SUM(commission_amount), 0)::text AS revenue
         FROM partner_referrals
         WHERE partner_id = $1
           AND status IN ('confirmed', 'paid')
           AND created_at >= NOW() - INTERVAL '30 days'`,
        [partner.id],
      );

      const currentRevenue = parseFloat(revenueRow?.revenue || '0');

      // Update monthly_revenue in DB
      await db.query(
        `UPDATE partners SET monthly_revenue = $1, monthly_revenue_at = NOW() WHERE id = $2`,
        [currentRevenue, partner.id],
      );

      // Determine the correct tier (highest tier where revenue >= min_monthly_revenue)
      const currentTier = tiers.find(t => t.slug === partner.tier_slug);
      let targetTier = tiers.find(t => currentRevenue >= parseFloat(t.min_monthly_revenue)) || null;

      // Fallback to 'start' tier if no tier matches
      if (!targetTier) {
        const startTier = await db.queryOne<PartnerTierRow>(
          `SELECT * FROM partner_tiers WHERE slug = 'start'`,
        );
        targetTier = startTier;
      }

      if (!targetTier || targetTier.slug === partner.tier_slug) {
        // Same tier: if partner is above threshold, reset downgrade counter
        if (currentTier && currentRevenue >= parseFloat(currentTier.min_monthly_revenue)) {
          if (partner.downgrade_months_count > 0) {
            await db.query(
              `UPDATE partners SET downgrade_months_count = 0 WHERE id = $1`,
              [partner.id],
            );
          }
        }
        continue;
      }

      const isUpgrade = targetTier && currentTier &&
        parseFloat(targetTier.min_monthly_revenue) > parseFloat(currentTier.min_monthly_revenue);

      if (isUpgrade) {
        // Immediate upgrade
        await db.query(
          `UPDATE partners SET tier_slug = $1, tier_updated_at = NOW(), downgrade_months_count = 0 WHERE id = $2`,
          [targetTier!.slug, partner.id],
        );
        updated++;
        logger.info(`[PartnerTierCron] ${partner.name} upgraded: ${partner.tier_slug} → ${targetTier!.slug} (revenue: ${currentRevenue}₽)`);

        // Notify partner
        import('./partner-notify.service.js')
          .then(({ notifyPartnerTierChange }) => {
            notifyPartnerTierChange?.({
              id: partner.id,
              name: partner.name,
              oldTier: partner.tier_slug,
              newTier: targetTier!.slug,
              direction: 'upgrade',
            }).catch((err: Error) => logger.error('[PartnerTierCron] notify error:', { error: err.message }));
          })
          .catch(() => {/* ignore */});
      } else {
        // Downgrade: check grace period
        const graceMonths = currentTier?.downgrade_grace_months ?? 1;
        const newDowngradeCount = partner.downgrade_months_count + 1;

        if (newDowngradeCount >= graceMonths) {
          // Apply downgrade
          await db.query(
            `UPDATE partners SET tier_slug = $1, tier_updated_at = NOW(), downgrade_months_count = 0 WHERE id = $2`,
            [targetTier!.slug, partner.id],
          );
          updated++;
          logger.info(`[PartnerTierCron] ${partner.name} downgraded: ${partner.tier_slug} → ${targetTier!.slug} (grace expired)`);

          import('./partner-notify.service.js')
            .then(({ notifyPartnerTierChange }) => {
              notifyPartnerTierChange?.({
                id: partner.id,
                name: partner.name,
                oldTier: partner.tier_slug,
                newTier: targetTier!.slug,
                direction: 'downgrade',
              }).catch((err: Error) => logger.error('[PartnerTierCron] notify error:', { error: err.message }));
            })
            .catch(() => {/* ignore */});
        } else {
          // Increment downgrade counter
          await db.query(
            `UPDATE partners SET downgrade_months_count = $1 WHERE id = $2`,
            [newDowngradeCount, partner.id],
          );
          logger.info(`[PartnerTierCron] ${partner.name} below threshold (${newDowngradeCount}/${graceMonths} months grace)`);
        }
      }
    } catch (err) {
      errors++;
      logger.error(`[PartnerTierCron] Error processing partner ${partner.id}:`, { error: String(err) });
    }
  }

  logger.info(`[PartnerTierCron] Done. Updated: ${updated}, Errors: ${errors}`);
  return { updated, errors };
}

// Daily interval: 24 hours
const INTERVAL_MS = 24 * 60 * 60 * 1000;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startPartnerTierScheduler(): void {
  if (intervalHandle) return;
  // Run immediately on start, then every 24h
  recalculatePartnerTiers().catch(err => logger.error('[PartnerTierCron] Initial run error', { error: String(err) }));
  intervalHandle = setInterval(
    () => recalculatePartnerTiers().catch(err => logger.error('[PartnerTierCron] Scheduled run error', { error: String(err) })),
    INTERVAL_MS,
  );
  logger.info('[PartnerTierCron] Scheduler started (daily)');
}

export function stopPartnerTierScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('[PartnerTierCron] Scheduler stopped');
  }
}
