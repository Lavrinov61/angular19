/**
 * View types for public print API — online photo print ordering.
 */

import type ServiceCatalog from '../generated/public/ServiceCatalog.js';

/** Volume discount tier from price_rules JSONB */
export interface VolumeDiscount {
  min_qty: number;
  price_per_unit: number;
}

/** Typed price_rules from service_catalog for photo_print category */
export interface PhotoPrintPriceRules {
  volume_discounts: VolumeDiscount[];
  paper_types: string[];
  matte_surcharge: number;
}

/** Type guard for price_rules JSONB */
export function isPhotoPrintPriceRules(v: unknown): v is PhotoPrintPriceRules {
  if (typeof v !== 'object' || v === null) return false;
  const rec = v as Record<string, unknown>;
  return Array.isArray(rec['volume_discounts']) && Array.isArray(rec['paper_types']);
}

/** Public-facing format row */
export type PrintFormatRow = Pick<ServiceCatalog,
  'id' | 'slug' | 'name' | 'price_per_unit' | 'price_rules' | 'sort_order'
>;

/** Calculate request item */
export interface PrintCalculateItem {
  format_slug: string;
  paper_type: string;
  quantity: number;
}

/** Calculate response item */
export interface PrintCalculateResultItem {
  format_slug: string;
  format_name: string;
  paper_type: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

/** Order status lookup row */
export interface PrintOrderStatusRow {
  order_id: string;
  status: string;
  payment_status: string;
  total_price: string;
  items: unknown;
  created_at: string;
  estimated_ready_at: string | null;
}
