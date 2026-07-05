import { pool } from '../database/db.js';
import { createLogger } from '../utils/logger.js';
import { addBusinessMinutes } from './business-hours.service.js';
import type { SlaOptionRow, SlaSlugOptionRow } from '../types/views/sla-views.js';

const logger = createLogger('sla.service');

const DEFAULT_SLA_MINUTES = 30;

export interface SlaOrderItemInput {
  serviceOptionId: string;
  quantity?: number | null;
  slaQuantity?: number | null;
}

interface SlaBucket {
  maxSingle: number;
  sumMulti: number;
  sumQuantity: number;
}

function normalizeUnits(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

function addSlaContribution(bucket: SlaBucket, selectionType: string, minutes: number, units: number): void {
  const contribution = Math.max(0, minutes) * normalizeUnits(units);
  if (contribution <= 0) return;

  if (selectionType === 'multi') {
    bucket.sumMulti += contribution;
    return;
  }

  if (selectionType === 'quantity') {
    bucket.sumQuantity += contribution;
    return;
  }

  bucket.maxSingle = Math.max(bucket.maxSingle, contribution);
}

function totalFromBuckets(buckets: Iterable<SlaBucket>): number {
  let total = 0;
  for (const bucket of buckets) {
    total += bucket.maxSingle + bucket.sumMulti + bucket.sumQuantity;
  }
  return total;
}

/**
 * Compute SLA deadline in minutes from grouped selected option slugs.
 * Formula: MAX(single/quantity groups) + SUM(multi groups)
 *
 * @param categorySlug - slug категории услуги (photo-docs, voennaya-retush, etc.)
 * @param groupedOptions - { group_slug: option_slug[] } — выбранные опции по группам
 * @returns SLA в минутах
 */
export async function computeOrderSlaMinutes(
  categorySlug: string,
  groupedOptions: Record<string, string[]>,
): Promise<number> {
  const allSlugs = Object.values(groupedOptions).flat();
  if (!allSlugs.length) return DEFAULT_SLA_MINUTES;

  try {
    const result = await pool.query<SlaSlugOptionRow>(
      `SELECT og.selection_type, so.estimated_minutes, so.slug as option_slug
       FROM service_options so
       JOIN option_groups og ON og.id = so.option_group_id
       WHERE og.service_category_id = (SELECT id FROM service_categories WHERE slug = $1)
         AND so.slug = ANY($2)
         AND so.is_active = true`,
      [categorySlug, allSlugs],
    );

    if (!result.rows.length) return DEFAULT_SLA_MINUTES;

    let maxSingle = 0;
    let sumMulti = 0;

    for (const row of result.rows) {
      if (row.selection_type === 'single' || row.selection_type === 'quantity') {
        maxSingle = Math.max(maxSingle, row.estimated_minutes ?? 0);
      } else {
        // multi: суммируем все выбранные опции
        sumMulti += row.estimated_minutes ?? 0;
      }
    }

    const total = maxSingle + sumMulti;
    return total > 0 ? total : DEFAULT_SLA_MINUTES;
  } catch (err) {
    logger.error('[SLA] Failed to compute SLA minutes', { error: String(err), categorySlug });
    return DEFAULT_SLA_MINUTES;
  }
}

/**
 * Compute SLA from option IDs (UUIDs).
 * Used for CRM orders where option IDs are available directly.
 */
export async function computeSlaFromOptionIds(optionIds: string[]): Promise<number> {
  if (!optionIds.length) return DEFAULT_SLA_MINUTES;
  return computeSlaFromOrderItems(optionIds.map(serviceOptionId => ({ serviceOptionId })));
}

/**
 * Compute SLA from order items with quantities/work units.
 *
 * DB remains the source of time per option (`service_options.estimated_minutes`).
 * `quantity` represents sold units; `slaQuantity` may override it when a UI knows
 * the real work units, e.g. uploaded image count for one selected processing tier.
 */
export async function computeSlaFromOrderItems(items: readonly SlaOrderItemInput[]): Promise<number> {
  const normalized = items
    .filter(item => item.serviceOptionId)
    .map(item => ({
      serviceOptionId: item.serviceOptionId,
      units: normalizeUnits(item.slaQuantity ?? item.quantity),
    }));

  if (normalized.length === 0) return DEFAULT_SLA_MINUTES;

  try {
    const optionIds = [...new Set(normalized.map(item => item.serviceOptionId))];
    const result = await pool.query<SlaOptionRow>(
      `SELECT so.id AS option_id,
              og.service_category_id AS category_id,
              og.selection_type,
              so.estimated_minutes
       FROM service_options so
       JOIN option_groups og ON og.id = so.option_group_id
       WHERE so.id = ANY($1)
         AND so.is_active = true`,
      [optionIds],
    );

    if (!result.rows.length) return DEFAULT_SLA_MINUTES;

    const rowsByOptionId = new Map<string, SlaOptionRow>(
      result.rows.map(row => [String(row.option_id), row]),
    );
    const bucketsByCategory = new Map<string, SlaBucket>();

    for (const item of normalized) {
      const row = rowsByOptionId.get(item.serviceOptionId);
      if (!row) continue;

      const categoryKey = row.category_id;
      let bucket = bucketsByCategory.get(categoryKey);
      if (!bucket) {
        bucket = { maxSingle: 0, sumMulti: 0, sumQuantity: 0 };
        bucketsByCategory.set(categoryKey, bucket);
      }

      addSlaContribution(bucket, row.selection_type, row.estimated_minutes ?? 0, item.units);
    }

    const total = totalFromBuckets(bucketsByCategory.values());
    return total > 0 ? total : DEFAULT_SLA_MINUTES;
  } catch (err) {
    logger.error('[SLA] Failed to compute SLA from order items', { error: String(err) });
    return DEFAULT_SLA_MINUTES;
  }
}

/**
 * Compute order deadline as a Date, respecting studio business hours.
 * Uses computeOrderSlaMinutes to get the raw SLA, then addBusinessMinutes to
 * produce a deadline that only counts minutes within operating hours.
 */
export async function computeOrderDeadline(
  categorySlug: string,
  groupedOptions: Record<string, string[]>,
  studioId?: string,
  startTime: Date = new Date(),
): Promise<Date> {
  const minutes = await computeOrderSlaMinutes(categorySlug, groupedOptions);
  return addBusinessMinutes(startTime, minutes, studioId);
}

/**
 * Compute deadline from option IDs, respecting studio business hours.
 * Used for CRM orders where option UUIDs are available directly.
 */
export async function computeDeadlineFromOptionIds(
  optionIds: string[],
  studioId?: string,
  startTime: Date = new Date(),
): Promise<Date> {
  const minutes = await computeSlaFromOptionIds(optionIds);
  return addBusinessMinutes(startTime, minutes, studioId);
}
