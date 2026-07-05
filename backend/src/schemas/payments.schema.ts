import { z } from 'zod';

/**
 * CloudPayments webhook schemas.
 *
 * IMPORTANT: all schemas use .passthrough() because CloudPayments sends
 * many additional fields (IpAddress, IpCity, CardFirstSix, etc.) that we
 * don't destructure in every handler but must preserve on req.body.
 */

// ── POST /check ───────────────────────────────────────────────────────

export const checkWebhookSchema = z
  .object({
    Amount: z.coerce.number(),
    Currency: z.string().optional(),
    InvoiceId: z.string().optional(),
    AccountId: z.string().optional(),
    TestMode: z.union([z.literal('1'), z.literal(1), z.literal('0'), z.literal(0)]).optional(),
  })
  .passthrough();

export type CheckWebhookInput = z.infer<typeof checkWebhookSchema>;

// ── POST /pay ─────────────────────────────────────────────────────────

export const payWebhookSchema = z
  .object({
    TransactionId: z.coerce.number(),
    Amount: z.coerce.number(),
    Currency: z.string().optional(),
    InvoiceId: z.string().optional(),
    CardFirstSix: z.string().optional(),
    CardLastFour: z.string().optional(),
    CardType: z.string().optional(),
    Data: z.unknown().optional(),
    TestMode: z.union([z.literal('1'), z.literal(1), z.literal('0'), z.literal(0)]).optional(),
    Email: z.string().optional(),
    Token: z.string().optional(),
    CardExpDate: z.string().optional(),
  })
  .passthrough();

export type PayWebhookInput = z.infer<typeof payWebhookSchema>;

// ── POST /confirm ─────────────────────────────────────────────────────

export const confirmWebhookSchema = z
  .object({
    TransactionId: z.coerce.number(),
    Amount: z.coerce.number(),
    Currency: z.string().optional(),
    InvoiceId: z.string().optional(),
    AccountId: z.string().optional(),
    Email: z.string().optional(),
    DateTime: z.string().optional(),
    CardFirstSix: z.string().optional(),
    CardLastFour: z.string().optional(),
    Data: z.unknown().optional(),
    TestMode: z.union([z.literal('1'), z.literal(1), z.literal('0'), z.literal(0)]).optional(),
  })
  .passthrough();

export type ConfirmWebhookInput = z.infer<typeof confirmWebhookSchema>;
