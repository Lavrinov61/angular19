import { z } from 'zod';

// ── Reusable primitives ──────────────────────────────────────────────

const uuid = z.string().uuid();
const nonEmptyString = z.string().min(1);

// ── REPLY ────────────────────────────────────────────────────────────

export const replySchema = z.object({
  content: nonEmptyString,
  messageType: z.string().optional().default('text'),
  replyToMessageId: uuid.optional(),
});

export type ReplyInput = z.infer<typeof replySchema>;

// ── NOTE ─────────────────────────────────────────────────────────────

export const noteSchema = z.object({
  content: nonEmptyString,
});

export type NoteInput = z.infer<typeof noteSchema>;

// ── STATUS ───────────────────────────────────────────────────────────

export const updateStatusSchema = z.object({
  status: z.enum(['active', 'resolved', 'closed']),
});

export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;

// ── ASSIGN ───────────────────────────────────────────────────────────

export const assignSchema = z.object({
  operator_id: z.string().optional(),
});

export type AssignInput = z.infer<typeof assignSchema>;

// ── TRANSFER ─────────────────────────────────────────────────────────

export const transferSchema = z.object({
  to_operator_id: nonEmptyString,
  note: z.string().optional(),
  resource_type: z.enum(['conversation', 'visitor_session']).optional(),
});

export type TransferInput = z.infer<typeof transferSchema>;

// ── CLAIM / RELEASE PRIVATE ──────────────────────────────────────────

export const claimPrivateSchema = z.object({
  note: z.string().optional(),
  resource_type: z.enum(['conversation', 'visitor_session']).optional(),
});

export type ClaimPrivateInput = z.infer<typeof claimPrivateSchema>;

export const releasePrivateSchema = z.object({
  note: z.string().optional(),
  resource_type: z.enum(['conversation', 'visitor_session']).optional(),
});

export type ReleasePrivateInput = z.infer<typeof releasePrivateSchema>;

// ── CART ──────────────────────────────────────────────────────────────

const cartItem = z.object({
  name: z.string().min(1),
  price: z.coerce.number(),
  quantity: z.coerce.number().int().min(1),
  nextPrice: z.coerce.number().optional(),
  serviceOptionId: z.string().uuid().optional(),
}).passthrough();

export const updateCartSchema = z.object({
  items: z.array(cartItem),
});

export type UpdateCartInput = z.infer<typeof updateCartSchema>;

// ── PAYMENT LINK ─────────────────────────────────────────────────────

export const paymentLinkSchema = z.object({
  description: z.string().optional(),
});

export type PaymentLinkInput = z.infer<typeof paymentLinkSchema>;

// ── FOLLOWUP ─────────────────────────────────────────────────────────

export const followupSchema = z.object({
  follow_up_at: z.string().min(1, 'follow_up_at is required'),
  note: z.string().optional(),
});

export type FollowupInput = z.infer<typeof followupSchema>;

// ── QUICK REPLIES ────────────────────────────────────────────────────

export const createQuickReplySchema = z.object({
  title: nonEmptyString,
  content: nonEmptyString,
  category: z.string().optional(),
});

export type CreateQuickReplyInput = z.infer<typeof createQuickReplySchema>;

export const updateQuickReplySchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  category: z.string().optional(),
  sort_order: z.coerce.number().int().optional(),
});

export type UpdateQuickReplyInput = z.infer<typeof updateQuickReplySchema>;

// ── LINK CLIENT ──────────────────────────────────────────────────────

export const linkClientSchema = z.object({
  userId: nonEmptyString,
});

export type LinkClientInput = z.infer<typeof linkClientSchema>;

// ── LINK BOOKING ─────────────────────────────────────────────────────

export const linkBookingSchema = z.object({
  bookingId: nonEmptyString,
});

export type LinkBookingInput = z.infer<typeof linkBookingSchema>;

// ── DOWNLOAD SELECTED ────────────────────────────────────────────────

export const downloadSelectedSchema = z.object({
  messageIds: z.array(z.string().uuid()).min(1, 'At least one message ID is required').max(200, 'Too many files (max 200)'),
});

export type DownloadSelectedInput = z.infer<typeof downloadSelectedSchema>;

// ── UPDATE VISITOR PHONE (F70) ──────────────────────────────────────

export const updateVisitorPhoneSchema = z.object({
  phone: z.string()
    .min(6, 'Phone number too short')
    .max(20, 'Phone number too long')
    .regex(/^\+?\d[\d\s()-]{4,}$/, 'Invalid phone format'),
});

export type UpdateVisitorPhoneInput = z.infer<typeof updateVisitorPhoneSchema>;

// ── FORWARD MESSAGE ─────────────────────────────────────────────────

export const forwardMessageSchema = z.object({
  messageId: uuid,
  content: z.string().optional(),
});

export type ForwardMessageInput = z.infer<typeof forwardMessageSchema>;

// ── SCHEDULED MESSAGES (F65) ────────────────────────────────────────

export const scheduleMessageSchema = z.object({
  content: nonEmptyString,
  send_at: z.string().min(1, 'send_at is required').refine(
    (val) => !isNaN(Date.parse(val)),
    { message: 'send_at must be a valid ISO date string' },
  ).refine(
    (val) => new Date(val).getTime() > Date.now() + 60_000,
    { message: 'send_at must be at least 1 minute in the future' },
  ),
});

export type ScheduleMessageInput = z.infer<typeof scheduleMessageSchema>;
