import type { PosReceiptItem } from '../../../services/pos-api.service';
import type { PaymentCartDetails, SelectedItem } from '../models/payment-dialog.models';

export function singlePricingCategorySlug(items: readonly SelectedItem[]): string | null {
  const categorySlugs = new Set(
    items
      .map(item => item.service.categorySlug.trim())
      .filter(slug => slug.length > 0),
  );
  if (categorySlugs.size !== 1) return null;
  return categorySlugs.values().next().value ?? null;
}

export function buildReceiptItemsFromCartDetails(cartDetails: PaymentCartDetails): PosReceiptItem[] {
  return cartDetails.lines.map(line => ({
    product_id: null,
    product_name: line.name,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    discount_amount: line.discountAmount,
    discount_percent: 0,
    points_used: 0,
    subscription_credits_used: 0,
    total: line.total,
  }));
}
