import { z } from 'zod';

// ── Reusable primitives ──────────────────────────────────────────────

const uuid = z.string().uuid();

const VALID_STATUSES = [
  'draft', 'pending', 'sent', 'confirmed', 'in_production',
  'quality_check', 'shipped', 'delivered', 'completed', 'cancelled', 'returned',
] as const;

// ── POST /houses ────────────────────────────────────────────────────

export const createPrintingHouseSchema = z.object({
  name: z.string().min(1, 'name обязателен'),
  code: z.string().min(1, 'code обязателен'),
  contact_email: z.string().email().optional(),
  contact_phone: z.string().optional(),
  address: z.string().optional(),
  website: z.string().optional(),
  capabilities: z.record(z.unknown()).optional(),
  notes: z.string().optional(),
}).passthrough();

export type CreatePrintingHouseInput = z.infer<typeof createPrintingHouseSchema>;

// ── PATCH /houses/:id ───────────────────────────────────────────────

export const updatePrintingHouseSchema = z.object({
  name: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  contact_email: z.string().email().optional(),
  contact_phone: z.string().optional(),
  address: z.string().optional(),
  website: z.string().optional(),
  capabilities: z.record(z.unknown()).optional(),
  status: z.enum(['active', 'inactive', 'paused']).optional(),
  notes: z.string().optional(),
}).passthrough();

export type UpdatePrintingHouseInput = z.infer<typeof updatePrintingHouseSchema>;

// ── POST /houses/:houseId/products ──────────────────────────────────

export const createProductSchema = z.object({
  name: z.string().min(1, 'name обязателен'),
  category: z.string().min(1, 'category обязателен'),
  base_price: z.coerce.number().nonnegative('base_price должен быть неотрицательным'),
  specs: z.record(z.unknown()).optional(),
  sku: z.string().optional(),
  is_active: z.boolean().optional().default(true),
}).passthrough();

export type CreateProductInput = z.infer<typeof createProductSchema>;

// ── POST /orders ────────────────────────────────────────────────────

const productionOrderItemSchema = z.object({
  product_id: z.string().min(1, 'product_id обязателен'),
  product_name: z.string().optional(),
  category: z.string().optional(),
  specs: z.record(z.unknown()).optional(),
  quantity: z.coerce.number().int().positive(),
  unit_price: z.coerce.number().nonnegative(),
  total_price: z.coerce.number().nonnegative().optional(),
}).passthrough();

export const createProductionOrderSchema = z.object({
  printing_house_id: uuid,
  items: z.array(productionOrderItemSchema).optional(),
  total_cost: z.coerce.number().nonnegative().optional(),
  deadline_at: z.string().optional(),
  delivery_method: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(VALID_STATUSES).optional().default('draft'),
  photo_order_id: z.string().uuid().optional(),
}).passthrough();

export type CreateProductionOrderInput = z.infer<typeof createProductionOrderSchema>;

// ── POST /orders/batch-status ───────────────────────────────────────

export const batchStatusSchema = z.object({
  ids: z.array(uuid).min(1, 'ids (массив UUID) обязателен'),
  status: z.enum(VALID_STATUSES),
});

export type BatchStatusInput = z.infer<typeof batchStatusSchema>;

// ── PATCH /orders/:id/status ────────────────────────────────────────

export const updateProductionStatusSchema = z.object({
  status: z.enum(VALID_STATUSES),
  comment: z.string().optional(),
});

export type UpdateProductionStatusInput = z.infer<typeof updateProductionStatusSchema>;

// ── PATCH /orders/:id ───────────────────────────────────────────────

export const updateProductionOrderSchema = z.object({
  notes: z.string().optional(),
  tracking_number: z.string().optional(),
  deadline_at: z.string().optional(),
  delivery_method: z.string().optional(),
  printing_house_notes: z.string().optional(),
  total_cost: z.coerce.number().nonnegative().optional(),
  items: z.array(z.object({
    product_id: z.string().min(1),
    quantity: z.coerce.number().int().positive(),
    unit_price: z.coerce.number().nonnegative(),
  }).passthrough()).optional(),
}).passthrough();

export type UpdateProductionOrderInput = z.infer<typeof updateProductionOrderSchema>;

// ── POST /orders/:id/cancel ─────────────────────────────────────────

export const cancelProductionOrderSchema = z.object({
  reason: z.string().optional().default(''),
});

export type CancelProductionOrderInput = z.infer<typeof cancelProductionOrderSchema>;

// ── POST /orders/:id/quality ────────────────────────────────────────

export const rateQualitySchema = z.object({
  rating: z.coerce.number().int().min(1, 'rating от 1').max(5, 'rating до 5'),
  notes: z.string().optional().default(''),
  has_defects: z.boolean().optional().default(false),
});

export type RateQualityInput = z.infer<typeof rateQualitySchema>;

// ── POST /reference-data ────────────────────────────────────────────

export const createReferenceDataSchema = z.object({
  ref_type: z.string().min(1, 'ref_type обязателен'),
  ref_key: z.string().min(1, 'ref_key обязателен'),
  display_name: z.string().min(1, 'display_name обязателен'),
  category_scope: z.array(z.string()).optional().default([]),
  metadata: z.record(z.unknown()).optional().default({}),
  sort_order: z.coerce.number().int().optional().default(0),
  is_active: z.boolean().optional().default(true),
});

export type CreateReferenceDataInput = z.infer<typeof createReferenceDataSchema>;

// ── POST /orders/from-receipt ───────────────────────────────────────

export const createFromReceiptSchema = z.object({
  receipt_id: z.string().min(1, 'receipt_id обязателен'),
  printing_house_id: z.string().uuid().optional(),
});

export type CreateFromReceiptInput = z.infer<typeof createFromReceiptSchema>;
