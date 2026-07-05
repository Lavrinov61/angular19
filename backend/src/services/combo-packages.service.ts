/**
 * Combo Packages Service — bundled service offers with discount.
 * F102: Allows creating pre-defined bundles like "Portrait + Retouch + Canvas" at a combo price.
 */

import db from '../database/db.js';
import type { ComboPackagesId } from '../types/generated/public/ComboPackages.js';
import type { ServiceOptionsId } from '../types/generated/public/ServiceOptions.js';
import type { ComboPackageRow, ComboPackageItemRow } from '../types/views/pricing-views.js';

// ============================================================================
// Types
// ============================================================================

export interface ComboPackageWithItems {
  id: ComboPackagesId;
  slug: string;
  name: string;
  description: string | null;
  combo_price: number;
  original_total: number | null;
  savings_label: string | null;
  display_channels: string[] | null;
  items: ComboItemView[];
}

export interface ComboItemView {
  option_slug: string;
  option_name: string;
  category_slug: string;
  quantity: number;
  base_price: number;
}

export interface DetectedCombo {
  id: ComboPackagesId;
  slug: string;
  name: string;
  combo_price: number;
  original_total: number | null;
  savings_label: string | null;
  missing_option_ids: ServiceOptionsId[];
  missing_option_slugs: string[];
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Get all active combo packages with their items
 */
export async function getActiveCombos(): Promise<ComboPackageWithItems[]> {
  const packages = await db.query<ComboPackageRow>(
    `SELECT id, slug, name, description, combo_price, original_total, savings_label, display_channels, sort_order, is_active
     FROM combo_packages
     WHERE is_active = true
     ORDER BY sort_order`,
  );

  if (packages.length === 0) return [];

  const packageIds = packages.map(p => p.id);

  const items = await db.query<ComboPackageItemRow & { base_price: string }>(
    `SELECT cpi.combo_package_id, cpi.service_option_id,
            so.slug AS option_slug, so.name AS option_name,
            so.base_price,
            sc.slug AS category_slug,
            cpi.quantity, cpi.sort_order
     FROM combo_package_items cpi
     JOIN service_options so ON cpi.service_option_id = so.id
     JOIN option_groups og ON so.option_group_id = og.id
     JOIN service_categories sc ON og.service_category_id = sc.id
     WHERE cpi.combo_package_id = ANY($1)
     ORDER BY cpi.sort_order`,
    [packageIds],
  );

  const itemsByPackage = new Map<string, ComboItemView[]>();
  for (const item of items) {
    const key = item.combo_package_id as string;
    if (!itemsByPackage.has(key)) itemsByPackage.set(key, []);
    itemsByPackage.get(key)!.push({
      option_slug: item.option_slug,
      option_name: item.option_name,
      category_slug: item.category_slug,
      quantity: item.quantity,
      base_price: parseFloat(item.base_price),
    });
  }

  return packages.map(p => {
    const comboPrice = parseFloat(p.combo_price);
    const pkgItems = itemsByPackage.get(p.id as string) || [];

    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      combo_price: comboPrice,
      original_total: null,
      savings_label: null,
      display_channels: p.display_channels,
      items: pkgItems,
    };
  });
}

/**
 * Detect which combo packages match or partially match a set of selected option IDs.
 * Returns combos where at least one item is present, sorted by completeness.
 */
export async function detectCombos(optionIds: string[]): Promise<DetectedCombo[]> {
  if (optionIds.length === 0) return [];

  interface DetectRow {
    id: ComboPackagesId;
    slug: string;
    name: string;
    combo_price: string;
    items_total: string;
    total_items: string;
    matched_items: string;
    missing_option_ids: ServiceOptionsId[] | null;
    missing_option_slugs: string[] | null;
  }

  const rows = await db.query<DetectRow>(
    `WITH combo_match AS (
       SELECT cp.id, cp.slug, cp.name, cp.combo_price,
              SUM(so.base_price * cpi.quantity) AS items_total,
              COUNT(cpi.id) AS total_items,
              COUNT(cpi.id) FILTER (WHERE cpi.service_option_id = ANY($1)) AS matched_items,
              ARRAY_AGG(cpi.service_option_id) FILTER (WHERE cpi.service_option_id != ALL($1)) AS missing_option_ids,
              ARRAY_AGG(so.slug) FILTER (WHERE cpi.service_option_id != ALL($1)) AS missing_option_slugs
       FROM combo_packages cp
       JOIN combo_package_items cpi ON cpi.combo_package_id = cp.id
       JOIN service_options so ON cpi.service_option_id = so.id
       WHERE cp.is_active = true
       GROUP BY cp.id, cp.slug, cp.name, cp.combo_price
       HAVING COUNT(cpi.id) FILTER (WHERE cpi.service_option_id = ANY($1)) > 0
     )
     SELECT * FROM combo_match
     ORDER BY matched_items DESC, total_items ASC`,
    [optionIds],
  );

  return rows.map(r => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    combo_price: parseFloat(r.combo_price),
    original_total: null,
    savings_label: null,
    missing_option_ids: r.missing_option_ids || [],
    missing_option_slugs: r.missing_option_slugs || [],
  }));
}
