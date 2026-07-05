/**
 * View types for pricing engine DB queries.
 * Used in pricing-engine.service.ts loadAllCategories() and calculatePriceWaterfall().
 */

import type { ServiceCategoriesId } from '../generated/public/ServiceCategories.js';
import type { ServiceOptionsId } from '../generated/public/ServiceOptions.js';
import type { OptionGroupsId } from '../generated/public/OptionGroups.js';
import type { ProductsId } from '../generated/public/Products.js';
import type { ComboPackagesId } from '../generated/public/ComboPackages.js';

// ─── loadAllCategories() ───────────────────────────────────────────────────

/** Row from: SELECT ... FROM service_categories WHERE is_active = true */
export interface ServiceCategoryRow {
  id: ServiceCategoriesId;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  gradient: string | null;
  image_url: string | null;
  price_range: string | null;
  display_channels: string[];
  processing_time: string | null;
  valid_delivery_methods: string[];
  sort_order: number;
  crm_orderable: boolean;
  metadata: Record<string, unknown> | null;
}

/** Row from: SELECT ... FROM option_groups WHERE is_active = true */
export interface OptionGroupRow {
  id: OptionGroupsId;
  service_category_id: ServiceCategoriesId;
  slug: string;
  name: string;
  description: string | null;
  selection_type: string;
  is_required: boolean;
  min_selections: number;
  max_selections: number;
  sort_order: number;
}

/** Row from: SELECT ... FROM service_options WHERE is_active = true */
export interface ServiceOptionRow {
  id: ServiceOptionsId;
  option_group_id: OptionGroupsId;
  product_id: ProductsId | null;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  base_price: string;
  price_online: string | null;
  price_studio: string | null;
  price_next_unit: string | null;
  price_max: string | null;
  promo_first_price: string | null;
  promo_description: string | null;
  features: string[];
  popular: boolean;
  original_price: string | null;
  discount_percent: number | null;
  satisfies_requires: boolean;
  sort_order: number;
  estimated_minutes: number | null;
  processing_time: string | null;
}

/** Row from: SELECT ... FROM option_rules WHERE is_active = true */
export interface OptionRuleRow {
  service_category_id: ServiceCategoriesId;
  rule_type: string;
  source_option_id: ServiceOptionsId;
  target_option_id: ServiceOptionsId;
  override_price: string | null;
  description: string | null;
}

/** Row from: SELECT ... FROM service_option_features WHERE is_active = true */
export interface ServiceOptionFeatureRow {
  id: string;
  service_option_id: ServiceOptionsId;
  name: string;
  price: string;
  tier_index: number;
  origin_tier_index: number;
  sort_order: number;
}

/** Row from: SELECT ... FROM v_order_item_features WHERE order_id = $1 */
export interface OrderItemFeatureBreakdownRow {
  order_item_id: string;
  feature_name: string;
  feature_price: string;
  tier_index: number;
  origin_tier_index: number;
  sort_order: number;
  is_disabled: boolean;
}

/** Row from: SELECT ... FROM order_items WHERE order_id = $1 (GET /:orderId enrichment) */
export interface OrderItemDetailRow {
  id: string;
  name: string;
  unit_price: string;
  quantity: number;
  subtotal: string;
  service_option_id: string | null;
  metadata: Record<string, unknown> | null;
}

// ─── calculatePriceWaterfall() ─────────────────────────────────────────────

/** Row from: SELECT so.*, og.service_category_id ... JOIN option_groups */
export interface WaterfallOptionRow {
  id: ServiceOptionsId;
  slug: string;
  name: string;
  base_price: string;
  price_online: string | null;
  price_studio: string | null;
  price_next_unit: string | null;
  price_max: string | null;
  promo_first_price: string | null;
  option_group_id: OptionGroupsId;
  product_id: ProductsId | null;
  category_id: ServiceCategoriesId;
  group_slug: string;
  category_slug?: string;
}

// ─── Combo Packages ──────────────────────────────────────────────────────

/** Row from: SELECT cp.*, ... combo_packages query */
export interface ComboPackageRow {
  id: ComboPackagesId;
  slug: string;
  name: string;
  description: string | null;
  combo_price: string;
  original_total: string | null;
  savings_label: string | null;
  display_channels: string[] | null;
  sort_order: number;
  is_active: boolean;
}

/** Row from: SELECT cpi.*, so.slug, so.name, sc.slug ... combo_package_items JOIN */
export interface ComboPackageItemRow {
  combo_package_id: ComboPackagesId;
  service_option_id: ServiceOptionsId;
  option_slug: string;
  option_name: string;
  category_slug: string;
  quantity: number;
  sort_order: number;
}
