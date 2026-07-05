import { z } from 'zod';

// ── Reusable primitives ──────────────────────────────────────────────

const uuid = z.string().uuid();
const positiveNumber = z.coerce.number().min(0);
const paymentType = z.enum(['cash', 'card', 'sbp', 'online', 'subscription', 'transfer']);

const paymentItem = z.object({
  payment_type: paymentType.optional(),
  method: paymentType.optional(),
  amount: z.coerce.number(),
  reference: z.string().optional(),
}).passthrough().transform((payment, ctx) => {
  const payment_type = payment.payment_type ?? payment.method;
  if (!payment_type) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'payment method is required',
      path: ['payment_type'],
    });
    return z.NEVER;
  }
  return { ...payment, payment_type };
});

const receiptItem = z.object({
  product_id: z.string().nullable().optional(),
  product_name: z.string().min(1),
  quantity: z.coerce.number().int().min(1),
  unit_price: z.coerce.number(),
  discount_amount: z.coerce.number().optional().default(0),
  discount_percent: z.coerce.number().optional().default(0),
  points_used: z.coerce.number().optional().default(0),
  subscription_credits_used: z.coerce.number().optional().default(0),
  print_fill_percent: z.coerce.number().min(0).max(100).nullable().optional(),
  total: z.coerce.number(),
  vat_rate: z.string().optional().default('NoVat'),
}).passthrough();

// ── SHIFTS ───────────────────────────────────────────────────────────

export const openShiftSchema = z.object({
  studio_id: uuid,
  cash_at_open: positiveNumber,
  fiscal_enabled: z.boolean().optional().default(true),
});

export type OpenShiftInput = z.infer<typeof openShiftSchema>;

const denominationItem = z.object({
  denomination: z.coerce.number(),
  count: z.coerce.number().int().min(0),
}).passthrough();

export const closeShiftSchema = z.object({
  shift_id: uuid,
  cash_at_close: positiveNumber,
  notes: z.string().optional(),
  denominations: z.array(denominationItem).optional(),
});

export type CloseShiftInput = z.infer<typeof closeShiftSchema>;

export const cashWithdrawalSchema = z.object({
  amount: z.coerce.number().positive('amount must be positive'),
  reason: z.string().trim().min(2, 'reason is required').max(500),
});

export type CashWithdrawalInput = z.infer<typeof cashWithdrawalSchema>;

// ── RECEIPTS ─────────────────────────────────────────────────────────

export const createReceiptSchema = z.object({
  shift_id: uuid.optional(),
  studio_id: uuid,
  items: z.array(receiptItem).min(1, 'At least one item is required'),
  payments: z.array(paymentItem).min(1, 'At least one payment is required'),
  subtotal: z.coerce.number().optional(),
  discount_total: z.coerce.number().optional(),
  total: z.coerce.number(),
  customer_phone: z.string().optional(),
  customer_name: z.string().optional(),
  loyalty_profile_id: z.string().optional(),
  loyalty_points_to_use: z.coerce.number().int().min(0).optional().default(0),
  subscription_id: z.string().optional(),
  is_refund: z.boolean().optional(),
  refund_receipt_id: z.string().optional(),
  points_discount: z.coerce.number().optional(),
  promo_code: z.string().optional(),
  print_order_id: z.string().uuid().optional(),
  fiscal_required: z.boolean().optional().default(false),
}).passthrough();

export type CreateReceiptInput = z.infer<typeof createReceiptSchema>;

export const subscriptionCoverageSchema = z.object({
  subscription_id: uuid,
  items: z.array(receiptItem).min(1, 'At least one item is required'),
});

export type SubscriptionCoverageInput = z.infer<typeof subscriptionCoverageSchema>;

export const voidReceiptSchema = z.object({
  shift_id: uuid,
  reason: z.string().min(3, 'Reason must be at least 3 characters'),
});

export type VoidReceiptInput = z.infer<typeof voidReceiptSchema>;

const partialRefundItem = z.object({
  product_id: z.string().nullable().optional(),
  product_name: z.string().min(1),
  quantity: z.coerce.number().int().min(1),
  unit_price: z.coerce.number(),
  total: z.coerce.number(),
}).passthrough();

export const partialRefundSchema = z.object({
  shift_id: uuid,
  studio_id: uuid,
  items: z.array(partialRefundItem).min(1, 'At least one item is required'),
});

export type PartialRefundInput = z.infer<typeof partialRefundSchema>;

// ── FULL REFUND (receipts/:id/refund) ────────────────────────────────

export const fullRefundSchema = z.object({
  shift_id: uuid.optional(),
  items: z.array(z.object({
    total: z.coerce.number(),
  }).passthrough()).optional(),
  payments: z.array(z.object({
    amount: z.coerce.number(),
  }).passthrough()).optional(),
}).passthrough();

export type FullRefundInput = z.infer<typeof fullRefundSchema>;

// ── FROM PRICING ─────────────────────────────────────────────────────

const selectedOption = z.object({
  slug: z.string().min(1).optional(),
  option_slug: z.string().min(1).optional(),
  quantity: z.coerce.number().int().min(1).optional().default(1),
  print_fill_percent: z.coerce.number().min(0).max(100).nullable().optional(),
  fill_percent: z.coerce.number().min(0).max(100).nullable().optional(),
  coverage_percent: z.coerce.number().min(0).max(100).nullable().optional(),
}).passthrough().transform((option, ctx) => {
  const slug = option.slug ?? option.option_slug;
  if (!slug) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'slug is required',
      path: ['slug'],
    });
    return z.NEVER;
  }
  return { ...option, slug };
});

export const createFromPricingSchema = z.object({
  category_slug: z.string().min(1, 'category_slug is required'),
  selected_options: z.array(selectedOption).min(1, 'At least one option is required'),
  delivery_method: z.string().min(1, 'delivery_method is required'),
  shift_id: uuid.optional(),
  studio_id: uuid,
  payments: z.array(paymentItem).min(1, 'At least one payment is required'),
  customer_phone: z.string().optional(),
  client_user_id: z.string().optional(),
  client_contact_id: z.string().optional(),
  customer_name: z.string().optional(),
  loyalty_profile_id: z.string().optional(),
  subscription_id: z.string().optional(),
  loyalty_points_to_use: z.coerce.number().min(0).optional().default(0),
  promo_code: z.string().optional(),
  manual_amount: z.coerce.number().min(0).optional().default(0),
  manual_description: z.string().optional(),
  print_order_id: z.string().uuid().optional(),
  apply_volume_discount: z.boolean().optional(),
  fiscal_required: z.boolean().optional().default(false),
  retouch_config: z.object({
    gender: z.enum(['male', 'female', 'any']).optional(),
    groups: z.record(z.string(), z.array(z.string()).max(50)).default({}),
    notes: z.string().max(2000).optional(),
  }).optional(),
}).passthrough();

export type CreateFromPricingInput = z.infer<typeof createFromPricingSchema>;

// ── FISCAL ───────────────────────────────────────────────────────────

export const updateFiscalSchema = z.object({
  receipt_url: z.string().optional(),
  receipt_number: z.string().optional(),
  fiscal_sign: z.string().optional(),
  source: z.string().optional().default('atol27f'),
});

export type UpdateFiscalInput = z.infer<typeof updateFiscalSchema>;

export const fiscalCorrectionSchema = z.object({
  correction_type: z.enum(['self', 'instruction']).optional().default('self'),
  correction_base_date: z.string().trim().regex(/^\d{2}\.\d{2}\.\d{4}$/).optional(),
  correction_base_number: z.string().trim().max(128).optional(),
  correction_base_name: z.string().trim().max(256).optional(),
}).passthrough();

export type FiscalCorrectionInput = z.infer<typeof fiscalCorrectionSchema>;

const fiscalPrintLines = z.array(z.string().trim().max(64)).max(4).optional();

const fiscalReceiptSettingsSchema = z.object({
  print_receipt: z.boolean().optional(),
  receipt_copies: z.coerce.number().int().min(1).max(3).optional(),
  header_lines: fiscalPrintLines,
  footer_lines: fiscalPrintLines,
  show_cashier: z.boolean().optional(),
  show_receipt_number: z.boolean().optional(),
  show_order_number: z.boolean().optional(),
  show_customer: z.boolean().optional(),
  cashier_inn: z.string().trim().regex(/^\d{10}$|^\d{12}$/).nullable().optional(),
}).passthrough();

const fiscalSlipSettingsSchema = z.object({
  print_bank_slip_on_atol: z.boolean().optional(),
  bank_slip_copies: z.coerce.number().int().min(1).max(3).optional(),
  print_merchant_copy: z.boolean().optional(),
  print_customer_copy: z.boolean().optional(),
  include_rrn: z.boolean().optional(),
  include_approval_code: z.boolean().optional(),
  include_card_mask: z.boolean().optional(),
  include_sbp_id: z.boolean().optional(),
  footer_lines: fiscalPrintLines,
}).passthrough();

const fiscalShiftSettingsSchema = z.object({
  auto_open_before_card_sbp: z.boolean().optional(),
  auto_close_on_last_pos_shift_close: z.boolean().optional(),
  print_open_report: z.boolean().optional(),
  print_close_report: z.boolean().optional(),
}).passthrough();

export const posFiscalSettingsQuerySchema = z.object({
  studio_id: uuid,
});

export const posFiscalSettingsSchema = z.object({
  studio_id: uuid,
  agent_id: uuid.nullable().optional(),
  enabled: z.boolean().optional(),
  receipt_settings: fiscalReceiptSettingsSchema.optional(),
  slip_settings: fiscalSlipSettingsSchema.optional(),
  shift_settings: fiscalShiftSettingsSchema.optional(),
}).passthrough();

export type PosFiscalSettingsInput = z.infer<typeof posFiscalSettingsSchema>;

// ── BRIDGE ───────────────────────────────────────────────────────────

/**
 * Позиция snapshot-корзины: строже базового receiptItem — фискальный чек по 54-ФЗ
 * не должен содержать отрицательной цены (anti-tamper фронта), потому
 * unit_price >= 0. Базовый receiptItem допускает отрицательные позиции (рефанды),
 * поэтому ограничение применяем точечно в snapshot.
 */
const snapshotReceiptItem = receiptItem.extend({
  unit_price: z.coerce.number().min(0, 'Цена не может быть отрицательной'),
});

/**
 * Снимок корзины, переживающий обрыв связи касса↔терминал: пишется в
 * command_payload payment-tx при /bridge/pay, чтобы при in_doubt номенклатура
 * НЕ терялась и чек можно было допробить через /payments/:id/resolve.
 * items/subtotal/total обязательны (createReceipt их требует); прочее optional.
 * Сервер канонизирует snapshot (пересчитывает per-item total/subtotal), фронту
 * не доверяет. source различает прямую корзину и услуги (from-pricing).
 */
const cartSnapshot = z.object({
  items: z.array(snapshotReceiptItem).min(1, 'At least one item is required'),
  subtotal: z.coerce.number(),
  discount_total: z.coerce.number().optional(),
  total: z.coerce.number(),
  shiftId: uuid.optional(),
  studioId: uuid.optional(),
  customerPhone: z.string().optional(),
  customerName: z.string().optional(),
  promoCode: z.string().optional(),
  loyaltyProfileId: z.string().optional(),
  source: z.enum(['cart', 'from_pricing']).optional(),
}).passthrough();

/**
 * Тело pricing-ветки /bridge/pay (услуги, order-first): те же поля, что у
 * createFromPricingSchema, по которым бэк сам строит snapshot через
 * buildPricingReceiptItems. delivery_method optional — для snapshot не нужен.
 */
const bridgePricing = z.object({
  category_slug: z.string().min(1, 'category_slug is required'),
  selected_options: z.array(selectedOption).min(1, 'At least one option is required'),
  delivery_method: z.string().min(1).optional(),
  promo_code: z.string().optional(),
  customer_phone: z.string().optional(),
  client_user_id: z.string().optional(),
  client_contact_id: z.string().optional(),
  loyalty_profile_id: z.string().optional(),
  apply_volume_discount: z.boolean().optional(),
  shift_id: uuid.optional(),
}).passthrough();

export const bridgePaySchema = z.object({
  amount: z.coerce.number().positive('Amount must be positive'),
  orderId: z.string().min(1, 'orderId is required'),
  studioId: uuid,
  snapshot: cartSnapshot.optional(),
  pricing: bridgePricing.optional(),
}).passthrough();

export type BridgePayInput = z.infer<typeof bridgePaySchema>;
export type CartSnapshotInput = z.infer<typeof cartSnapshot>;
export type BridgePricingInput = z.infer<typeof bridgePricing>;

/**
 * Тело POST /payments/:id/resolve — ручное разрешение зависшей оплаты.
 * outcome='paid' (за флагом POS_INDOUBT_RESOLVE_ENABLED) допробивает чек по
 * сохранённому snapshot ИЛИ переданным items; outcome='unpaid' метит как не
 * оплаченную. items — фолбэк, если snapshot не сохранился в command_payload.
 */
export const resolvePaymentSchema = z.object({
  outcome: z.enum(['paid', 'unpaid']),
  items: z.array(receiptItem).min(1).optional(),
}).passthrough();

export type ResolvePaymentInput = z.infer<typeof resolvePaymentSchema>;

/**
 * Позиция чека по осиротевшей оплате: строже базового receiptItem (54-ФЗ —
 * фискальный чек не должен содержать отрицательных/нулевых цен): quantity > 0
 * (уже в receiptItem int().min(1)), unit_price >= 0, discount_amount >= 0.
 */
const orphanReceiptItem = receiptItem.extend({
  unit_price: z.coerce.number().min(0, 'Цена не может быть отрицательной'),
  discount_amount: z.coerce.number().min(0).optional().default(0),
});

/**
 * Тело POST /payments/:id/create-receipt — оформление чека по осиротевшей оплате
 * (completed без чека). У реальных orphan snapshot обычно нет (order_id NULL) →
 * items вводятся кассиром вручную; если snapshot есть — берётся из него.
 */
export const createOrphanReceiptSchema = z.object({
  items: z.array(orphanReceiptItem).min(1).optional(),
}).passthrough();

export type CreateOrphanReceiptInput = z.infer<typeof createOrphanReceiptSchema>;

export const bridgeRefundSchema = z.object({
  studioId: uuid,
  transactionId: uuid,
}).passthrough();

export type BridgeRefundInput = z.infer<typeof bridgeRefundSchema>;

export const bridgeCashDrawerSchema = z.object({
  studioId: z.string().uuid().optional(),
}).passthrough();

export type BridgeCashDrawerInput = z.infer<typeof bridgeCashDrawerSchema>;

export const bridgeSettlementSchema = z.object({
  studioId: z.string().uuid(),
}).passthrough();

export type BridgeSettlementInput = z.infer<typeof bridgeSettlementSchema>;

export const bridgeFiscalSchema = z.object({
  receiptId: z.string().min(1),
  items: z.array(z.unknown()).optional(),
  total: z.coerce.number().optional(),
  studioId: z.string().uuid(),
}).passthrough();

export type BridgeFiscalInput = z.infer<typeof bridgeFiscalSchema>;

// ── SERVICE TIMER ────────────────────────────────────────────────────

export const startTimerSchema = z.object({
  studio_id: uuid,
  order_description: z.string().optional(),
  is_custom_order: z.boolean().optional(),
  custom_surcharge: z.coerce.number().optional(),
  custom_surcharge_reason: z.string().optional(),
  hourly_rate: z.coerce.number().optional(),
});

export type StartTimerInput = z.infer<typeof startTimerSchema>;

export const stopTimerSchema = z.object({
  work_log_id: uuid,
});

export type StopTimerInput = z.infer<typeof stopTimerSchema>;

export const customSurchargeSchema = z.object({
  work_log_id: uuid,
  amount: z.coerce.number(),
  reason: z.string().min(1, 'Reason is required'),
});

export type CustomSurchargeInput = z.infer<typeof customSurchargeSchema>;

// ── MATERIALS ────────────────────────────────────────────────────────

export const recordMaterialUsageSchema = z.object({
  receipt_id: z.string().optional(),
  work_log_id: z.string().optional(),
  product_id: z.string().min(1, 'product_id is required'),
  quantity: z.coerce.number().positive('quantity must be positive'),
  unit: z.string().min(1, 'unit is required'),
  studio_id: uuid,
  notes: z.string().optional(),
});

export type RecordMaterialUsageInput = z.infer<typeof recordMaterialUsageSchema>;
