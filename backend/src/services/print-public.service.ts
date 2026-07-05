/**
 * Print Public Service — online photo print ordering.
 * Uses service_catalog for formats/pricing and photo_print_orders for order storage.
 */
import db from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
import { checkSubscription } from './subscription.service.js';
import type SubscriptionPlans from '../types/generated/public/SubscriptionPlans.js';
import type {
  PrintFormatRow,
  PrintCalculateItem,
  PrintCalculateResultItem,
  PrintOrderStatusRow,
} from '../types/views/print-public-views.js';
import { isPhotoPrintPriceRules } from '../types/views/print-public-views.js';

/** Get all active photo print formats with pricing */
export async function getPhotoPrintFormats(): Promise<PrintFormatRow[]> {
  return db.query<PrintFormatRow>(
    `SELECT id, slug, name, price_per_unit, price_rules, sort_order
     FROM service_catalog
     WHERE category = 'photo_print' AND is_active = true
     ORDER BY sort_order`,
  );
}

/** Resolve unit price for a format + quantity using volume discounts */
export function resolveUnitPrice(
  pricePerUnit: number,
  priceRules: Record<string, unknown> | null,
  quantity: number,
  paperType: string,
): number {
  let unitPrice = pricePerUnit;

  if (priceRules && isPhotoPrintPriceRules(priceRules)) {
    const sorted = [...priceRules.volume_discounts].sort((a, b) => b.min_qty - a.min_qty);
    for (const tier of sorted) {
      if (quantity >= tier.min_qty) {
        unitPrice = tier.price_per_unit;
        break;
      }
    }

    // Matte surcharge
    if (paperType === 'matte' && priceRules.matte_surcharge > 0) {
      unitPrice += priceRules.matte_surcharge;
    }
  }

  return unitPrice;
}

/** Calculate total price for a set of print items */
export async function calculatePrintPrice(
  items: PrintCalculateItem[],
  phone?: string,
): Promise<{
  items: PrintCalculateResultItem[];
  subtotal: number;
  subscription_discount: number;
  total: number;
}> {
  const formats = await getPhotoPrintFormats();
  const formatMap = new Map(formats.map(f => [f.slug, f]));

  let subtotal = 0;
  const resultItems: PrintCalculateResultItem[] = [];

  for (const item of items) {
    const format = formatMap.get(item.format_slug);
    if (!format) {
      throw new AppError(400, `Неизвестный формат: ${item.format_slug}`);
    }
    if (item.quantity < 1 || item.quantity > 9999) {
      throw new AppError(400, `Некорректное количество для ${item.format_slug}: ${item.quantity}`);
    }

    const unitPrice = resolveUnitPrice(
      format.price_per_unit ?? 0,
      format.price_rules,
      item.quantity,
      item.paper_type || 'glossy',
    );
    const itemSubtotal = unitPrice * item.quantity;
    subtotal += itemSubtotal;

    resultItems.push({
      format_slug: item.format_slug,
      format_name: format.name,
      paper_type: item.paper_type || 'glossy',
      quantity: item.quantity,
      unit_price: unitPrice,
      subtotal: itemSubtotal,
    });
  }

  // Check subscriber discount
  let subscriptionDiscount = 0;
  if (phone) {
    const sub = await checkSubscription(phone.replace(/\D/g, ''));
    if (sub && sub.plan_id) {
      const plan = await db.queryOne<Pick<SubscriptionPlans, 'subscriber_discount_percent'>>(
        `SELECT subscriber_discount_percent FROM subscription_plans WHERE id = $1`,
        [sub.plan_id],
      );
      if (plan && plan.subscriber_discount_percent) {
        const pct = parseFloat(plan.subscriber_discount_percent);
        if (pct > 0) {
          subscriptionDiscount = Math.round(subtotal * pct / 100);
        }
      }
    }
  }

  return {
    items: resultItems,
    subtotal,
    subscription_discount: subscriptionDiscount,
    total: subtotal - subscriptionDiscount,
  };
}

/** Get order status by order_id */
export async function getPrintOrderStatus(orderId: string): Promise<PrintOrderStatusRow | null> {
  return db.queryOne<PrintOrderStatusRow>(
    `SELECT order_id, status, payment_status, total_price, items, created_at, estimated_ready_at
     FROM photo_print_orders
     WHERE order_id = $1`,
    [orderId],
  );
}
