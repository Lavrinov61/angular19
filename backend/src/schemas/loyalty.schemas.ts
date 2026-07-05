import { z } from 'zod';

// ── Reusable primitives ──────────────────────────────────────────────

const uuid = z.string().uuid();

// ── CLIENT: GET /loyalty/transactions ────────────────────────────────

export const getTransactionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type GetTransactionsQuery = z.infer<typeof getTransactionsQuery>;

// ── CLIENT: GET /loyalty/benefit-summary ────────────────────────────

export const getBenefitSummaryQuery = z.object({
  months: z.coerce.number().int().min(1).max(12).default(6),
});

export type GetBenefitSummaryQuery = z.infer<typeof getBenefitSummaryQuery>;

// ── CLIENT: POST /loyalty/referral ───────────────────────────────────

export const applyReferralBody = z.object({
  code: z.string().min(4).max(20).transform(s => s.toUpperCase()),
});

export type ApplyReferralBody = z.infer<typeof applyReferralBody>;

// ── CLIENT: POST /loyalty/cashback/selection ────────────────────────

export const cashbackCategoryKey = z.enum([
  'documents',
  'photos',
  'id-photo',
  'restoration',
  'photoshoot',
  'albums',
]);

export const cashbackSelectionBody = z.object({
  categoryKey: cashbackCategoryKey,
});

export type CashbackSelectionBody = z.infer<typeof cashbackSelectionBody>;

// ── POS / PAYMENT: POST /loyalty/spend ───────────────────────────────

export const spendPointsBody = z.object({
  loyalty_profile_id: uuid,
  points: z.number().int().positive(),
  reference_id: z.string().min(1).max(200),
});

export type SpendPointsBody = z.infer<typeof spendPointsBody>;

// ── ADMIN: POST /loyalty/profiles/:id/adjust ─────────────────────────

export const adminAdjustBody = z.object({
  amount: z.number().int().min(-10000).max(10000),
  reason: z.string().min(3).max(500),
});

export type AdminAdjustBody = z.infer<typeof adminAdjustBody>;

// ── ADMIN: GET /loyalty/profiles ─────────────────────────────────────

export const adminProfilesQuery = z.object({
  search: z.string().optional(),
  level: z.coerce.number().int().min(1).max(5).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(['points', 'total_spent', 'level', 'created_at']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type AdminProfilesQuery = z.infer<typeof adminProfilesQuery>;

// ── ADMIN: params /:id ───────────────────────────────────────────────

export const adminProfileIdParam = z.object({
  id: uuid,
});

export type AdminProfileIdParam = z.infer<typeof adminProfileIdParam>;
