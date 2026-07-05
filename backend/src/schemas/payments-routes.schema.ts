import { z } from 'zod';

/**
 * Zod schemas for payments.routes.ts endpoints (NOT webhook schemas —
 * those live in payments.schema.ts).
 */

// ── Shared ──────────────────────────────────────────────────────────

const serviceItemSchema = z.object({
  name: z.string().min(1),
  price: z.coerce.number(),
  quantity: z.coerce.number().int().min(1).optional().default(1),
}).passthrough();

const cartDisplayLineSchema = z.object({
  name: z.string().min(1),
  quantity: z.coerce.number().int().min(1),
  unitPrice: z.coerce.number(),
  total: z.coerce.number(),
  priceNote: z.string().nullable().optional(),
  discountLabel: z.string().nullable().optional(),
  discountAmount: z.coerce.number().optional(),
});

const cartDetailsSchema = z.object({
  lines: z.array(cartDisplayLineSchema).min(1),
  subtotal: z.coerce.number().optional(),
  savings: z.coerce.number().optional(),
});

// ── POST /sbp ───────────────────────────────────────────────────────

export const sbpPaymentSchema = z.object({
  amount: z.coerce.number().positive('Сумма обязательна'),
  orderId: z.string().optional(),
  description: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  successUrl: z.string().optional(),
  receipt: z.unknown().optional(),
});

export type SbpPaymentInput = z.infer<typeof sbpPaymentSchema>;

// ── POST /sbp/qr ────────────────────────────────────────────────────

export const sbpQrSchema = z.object({
  amount: z.coerce.number().positive('Сумма обязательна'),
  orderId: z.string().optional(),
  description: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  receipt: z.unknown().optional(),
});

export type SbpQrInput = z.infer<typeof sbpQrSchema>;

// ── POST /create-link ───────────────────────────────────────────────

export const createPaymentLinkSchema = z.object({
  amount: z.coerce.number().min(1, 'amount обязателен и >= 1'),
  description: z.string().optional(),
  phone: z.string().optional(),
  clientName: z.string().optional(),
  clientUserId: z.string().optional(),
  clientContactId: z.string().optional(),
  sessionId: z.string().optional(),
  services: z.array(serviceItemSchema).optional(),
  cartDetails: cartDetailsSchema.optional(),
  autoSend: z.boolean().optional(),
  promo_code: z.string().trim().min(1).optional(),
});

export type CreatePaymentLinkInput = z.infer<typeof createPaymentLinkSchema>;

// ── POST /manual-chat-payment ───────────────────────────────────────

const manualPaymentMethod = z.enum(['cash', 'transfer', 'card', 'sbp']);
const manualPaymentFiscalMode = z.enum(['fiscal', 'skip']);

export const manualChatPaymentSchema = z.object({
  sessionId: z.string().uuid(),
  amount: z.coerce.number().min(1, 'amount обязателен и >= 1'),
  method: manualPaymentMethod.default('cash'),
  fiscalMode: manualPaymentFiscalMode.optional(),
  receiptId: z.string().uuid().optional(),
  receiptNumber: z.string().trim().min(1).max(120).optional(),
  phone: z.string().optional(),
  clientName: z.string().optional(),
  cartDetails: cartDetailsSchema.optional(),
});

export type ManualChatPaymentInput = z.infer<typeof manualChatPaymentSchema>;

// ── PATCH /link/:id ─────────────────────────────────────────────────

export const updatePaymentLinkSchema = z.object({
  amount: z.coerce.number().min(1, 'amount обязателен и >= 1'),
  description: z.string().optional(),
  phone: z.string().optional(),
  clientName: z.string().optional(),
  clientUserId: z.string().optional(),
  clientContactId: z.string().optional(),
  services: z.array(serviceItemSchema).optional(),
  cartDetails: cartDetailsSchema.optional(),
  autoSend: z.boolean().optional(),
  promo_code: z.string().trim().min(1).optional(),
});

export type UpdatePaymentLinkInput = z.infer<typeof updatePaymentLinkSchema>;

// ── POST /link/:id/cancel ───────────────────────────────────────────

export const cancelPaymentLinkSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  notifyClient: z.boolean().optional().default(true),
});

export type CancelPaymentLinkInput = z.infer<typeof cancelPaymentLinkSchema>;

// ── POST /create-order ──────────────────────────────────────────────

export const createPaymentOrderSchema = z.object({
  items: z.array(z.object({
    name: z.string().optional(),
    service: z.string().optional(),
    id: z.string().optional(),
    price: z.coerce.number().optional(),
    subtotal: z.coerce.number().optional(),
    quantity: z.coerce.number().int().min(1).optional(),
  }).passthrough()).min(1, 'items обязателен'),
  total: z.coerce.number().positive('total обязателен'),
  email: z.string().optional(),
  phone: z.string().optional(),
  clientUserId: z.string().optional(),
  clientContactId: z.string().optional(),
  chatSessionId: z.string().optional(),
  promoCode: z.string().optional(),
  promoDiscount: z.coerce.number().optional(),
  partnerPromoCode: z.string().optional(),
});

export type CreatePaymentOrderInput = z.infer<typeof createPaymentOrderSchema>;

// ── POST /confirm-from-widget ───────────────────────────────────────

export const confirmFromWidgetSchema = z.object({
  orderId: z.string().min(1, 'orderId обязателен'),
});

export type ConfirmFromWidgetInput = z.infer<typeof confirmFromWidgetSchema>;

export const confirmSubscriptionFromWidgetSchema = z.object({
  subscriptionId: z.string().min(1, 'subscriptionId обязателен'),
  transactionId: z.union([z.string(), z.number()]).optional(),
});

export type ConfirmSubscriptionFromWidgetInput = z.infer<typeof confirmSubscriptionFromWidgetSchema>;

// ── PATCH /:orderId/tip ─────────────────────────────────────────────

export const updateTipSchema = z.object({
  tipAmount: z.coerce.number().min(0).max(500, 'Максимальный tip 500'),
});

export type UpdateTipInput = z.infer<typeof updateTipSchema>;

// ── POST /quick-sale ────────────────────────────────────────────────

export const quickSaleSchema = z.object({
  amount: z.coerce.number().positive('amount обязателен'),
  phone: z.string().optional(),
  services: z.array(z.string()).optional(),
  taskId: z.string().optional(),
  chatSessionId: z.string().optional(),
}).refine(
  (data) => data.phone || data.taskId || data.chatSessionId,
  { message: 'phone, taskId, or chatSessionId is required' },
);

export type QuickSaleInput = z.infer<typeof quickSaleSchema>;

// ── GET /links ──────────────────────────────────────────────────────

export const listPaymentLinksSchema = z.object({
  contact_id: z.string().uuid().optional(),
  conversation_id: z.string().uuid().optional(),
  created_by: z.string().uuid().optional(),
  sales_scope: z.enum(['mine']).optional(),
  status: z.enum(['pending', 'paid', 'cancelled', 'expired']).optional(),
  date_from: z.string().trim().min(1).optional(),
  date_to: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type ListPaymentLinksInput = z.infer<typeof listPaymentLinksSchema>;

// ── POST /resend/:orderId ───────────────────────────────────────────

/**
 * Override channel for resending a payment link. Set of values mirrors
 * ALL_CHANNELS from services/connectors/core/types.ts (public.channel_type enum).
 */
const RESEND_CHANNELS = ['telegram', 'vk', 'whatsapp', 'instagram', 'max', 'email', 'web'] as const;

export const resendPaymentLinkSchema = z.object({
  channel: z.enum(RESEND_CHANNELS).optional(),
});

export type ResendPaymentLinkInput = z.infer<typeof resendPaymentLinkSchema>;

// ── POST /link/:id/create-order ─────────────────────────────────────

export const createOrderFromPaymentLinkSchema = z.object({
  comment: z.string().max(1000).optional(),
  uniform_description: z.string().max(500).optional(),
  wishes: z.string().max(500).optional(),
  priority: z.enum(['normal', 'urgent', 'vip']).optional().default('normal'),
  assigned_employee_id: z.string().uuid().optional(),
  studio_id: z.string().uuid().optional(),
  deadline_at: z.string().datetime().optional(),
});

export type CreateOrderFromPaymentLinkInput = z.infer<typeof createOrderFromPaymentLinkSchema>;
