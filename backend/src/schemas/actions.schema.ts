import { z } from 'zod';

// ── Shared sub-schemas ────────────────────────────────────────────────

const contactSchema = z.object({
  name: z.string().min(1, 'Contact name is required'),
  phone: z.string().min(1, 'Contact phone is required'),
  email: z.string().email().optional(),
});

const contactWithCommentsSchema = contactSchema.extend({
  comments: z.string().optional(),
});

const locationSchema = z.object({
  address: z.string().optional(),
  city: z.string().optional(),
  coordinates: z
    .object({
      lat: z.number(),
      lng: z.number(),
    })
    .optional(),
});

const priceSchema = z.object({
  totalPrice: z.number().optional(),
  total: z.number().optional(),
  basePrice: z.number().optional(),
  currency: z.string().optional(),
});

// ── POST /bookings ────────────────────────────────────────────────────

export const createBookingSchema = z.object({
  serviceId: z.string().min(1, 'serviceId is required'),
  serviceType: z.enum(['studio', 'onLocation']).optional(),
  startTime: z.string().min(1, 'startTime is required'),
  endTime: z.string().min(1, 'endTime is required'),
  photographerId: z.string().optional(),
  price: priceSchema.optional(),
  contact: contactSchema,
  notes: z.string().optional(),
  persons: z.coerce.number().int().min(1).optional(),
  location: locationSchema.optional(),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

// ── POST /photo-print-orders ──────────────────────────────────────────

const photoPrintItemSchema = z.object({
  uploadedUrl: z.string().optional(),
  photoUrl: z.string().optional(),
  format: z.string().min(1, 'format is required'),
  paperType: z.string().min(1, 'paperType is required'),
  quantity: z.coerce.number().int().min(1, 'quantity must be >= 1'),
});

export const createPhotoPrintOrderSchema = z.object({
  mode: z.enum(['simple', 'custom']),
  items: z.array(photoPrintItemSchema).min(1, 'At least one item is required'),
  contact: contactWithCommentsSchema,
  totalPrice: z.coerce.number(),
});

export type CreatePhotoPrintOrderInput = z.infer<typeof createPhotoPrintOrderSchema>;

// ── POST /payment-links ──────────────────────────────────────────────

export const createPaymentLinkSchema = z.object({
  orderType: z.enum(['photo_print', 'booking', 'custom']),
  orderId: z.string().min(1, 'orderId is required'),
  amount: z.coerce.number().optional(),
  currency: z.string().optional(),
  description: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
});

export type CreatePaymentLinkInput = z.infer<typeof createPaymentLinkSchema>;
