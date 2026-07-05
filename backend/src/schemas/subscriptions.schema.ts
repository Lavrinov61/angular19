import { z } from 'zod';

// ── POST /plans (admin) ─────────────────────────────────────────────

export const createPlanSchema = z.object({
  name: z.string().min(1, 'name обязателен'),
  slug: z.string().min(1, 'slug обязателен'),
  base_price: z.coerce.number().nonnegative('base_price должен быть неотрицательным'),
  category: z.string().optional(),
  description: z.string().optional(),
  credits: z.coerce.number().int().optional(),
  features: z.record(z.unknown()).optional(),
  is_active: z.boolean().optional().default(true),
}).passthrough();

export type CreatePlanInput = z.infer<typeof createPlanSchema>;

// ── POST /calculate ─────────────────────────────────────────────────

const customItemSchema = z.object({
  service_slug: z.string().min(1),
  quantity: z.coerce.number().int().positive(),
}).passthrough();

export const calculatePackageSchema = z.object({
  items: z.array(customItemSchema).min(1, 'items array обязателен'),
});

export type CalculatePackageInput = z.infer<typeof calculatePackageSchema>;

// ── POST /init ──────────────────────────────────────────────────────

export const initSubscriptionSchema = z.object({
  phone: z.string().min(1, 'phone обязателен'),
  plan_id: z.string().uuid().optional(),
  custom_items: z.array(customItemSchema).optional(),
  customer_name: z.string().optional(),
  email: z.string().email().optional(),
  promo_code: z.string().max(50).optional(),
}).refine(
  (data) => data.plan_id || (data.custom_items && data.custom_items.length > 0),
  { message: 'plan_id or custom_items is required' },
);

export type InitSubscriptionInput = z.infer<typeof initSubscriptionSchema>;

// ── POST /gift-promos ──────────────────────────────────────────────

export const createGiftSubscriptionPromoSchema = z.object({
  plan_id: z.string().uuid('plan_id должен быть UUID'),
  chat_session_id: z.string().uuid('chat_session_id должен быть UUID'),
  expires_in_days: z.coerce.number().int().min(1).max(365).optional(),
});

export type CreateGiftSubscriptionPromoInput = z.infer<typeof createGiftSubscriptionPromoSchema>;

// ── POST /account-access-info ─────────────────────────────────────

export const sendAccountAccessInfoSchema = z.object({
  account_type: z.enum(['personal', 'business', 'education']),
  chat_session_id: z.string().uuid('chat_session_id должен быть UUID'),
});

export type SendAccountAccessInfoInput = z.infer<typeof sendAccountAccessInfoSchema>;

// ── POST /redeem-gift ──────────────────────────────────────────────

export const redeemGiftSubscriptionPromoSchema = z.object({
  promo_code: z.string().trim().min(1, 'promo_code обязателен').max(50),
  phone: z.string().trim().optional(),
  customer_name: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
});

export type RedeemGiftSubscriptionPromoInput = z.infer<typeof redeemGiftSubscriptionPromoSchema>;

// ── Gift activation (account-first multi-step) ─────────────────────

const pin4 = z.string().regex(/^\d{4}$/, 'Код должен содержать 4 цифры');
const giftFingerprintVisitorId = z.string().trim().min(1).max(128).optional();

/**
 * POST /subscriptions/gift-activation/start
 * Public. Validates promo + identity, opens a Redis activation session,
 * sends voice + email codes.
 */
export const giftActivationStartSchema = z.object({
  promo_code: z.string().trim().min(1, 'Промокод обязателен').max(50),
  full_name: z.string().trim().min(2, 'Укажите имя и фамилию').max(200, 'Имя слишком длинное'),
  // ДР опциональна; формат YYYY-MM-DD, валидность диапазона проверяется в роуте.
  date_of_birth: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата рождения должна быть в формате YYYY-MM-DD')
    .optional(),
  phone: z.string().trim().min(1, 'Телефон обязателен'),
  email: z.string().trim().email('Некорректный email').max(255),
  consent: z.literal(true, { message: 'Требуется согласие на обработку персональных данных' }),
  policy_version: z.string().trim().min(1).max(32),
  fingerprint_visitor_id: giftFingerprintVisitorId,
});

export type GiftActivationStartInput = z.infer<typeof giftActivationStartSchema>;

/**
 * POST /subscriptions/gift-activation/verify-email AND /verify-phone —
 * both take a single 4-digit code and verify it against session state.
 */
export const giftActivationCodeSchema = z.object({
  code: pin4,
});

export type GiftActivationCodeInput = z.infer<typeof giftActivationCodeSchema>;

/**
 * POST /subscriptions/gift-activation/finalize — runs the atomic activation.
 * Requires emailVerified (always) and phoneVerified, unless viaEmailOnly=true.
 */
export const giftActivationFinalizeSchema = z.object({
  viaEmailOnly: z.boolean().optional().default(false),
});

export type GiftActivationFinalizeInput = z.infer<typeof giftActivationFinalizeSchema>;

/**
 * POST /subscriptions/gift-activation/resend — re-send voice or email code.
 * email correction allowed when channel='email'.
 */
export const giftActivationResendSchema = z.object({
  channel: z.enum(['voice', 'email']),
  email: z.string().trim().email('Некорректный email').max(255).optional(),
});

export type GiftActivationResendInput = z.infer<typeof giftActivationResendSchema>;
