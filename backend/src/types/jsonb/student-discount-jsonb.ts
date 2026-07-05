/** JSONB contracts for student discount ledgers. */
export interface StudentDiscountRedemptionMetadata {
  source?: 'pos' | 'online_print';
  receiptNumber?: string;
  printOrderId?: string;
  serviceOptionSlug?: string;
  product_id?: string | null;
  productId?: string | null;
  product_name?: string | null;
  productName?: string | null;
  units?: number;
  partial_refunded_units?: number;
  partial_refunded_at?: string;
  [key: string]: unknown;
}
