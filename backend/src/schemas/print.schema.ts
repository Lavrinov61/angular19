import { z } from 'zod';
import { MEDIA_ALLOWED_DOMAINS } from '../config/media-domains.js';

// ── Reusable primitives ──────────────────────────────────────────────

const uuid = z.string().uuid();

// ── POST /printers ──────────────────────────────────────────────────

const capabilitiesSchema = z.object({
  paperSizes: z.array(z.string()).optional(),
  colorModes: z.array(z.string()).optional(),
  maxDpi: z.coerce.number().optional(),
  duplex: z.boolean().optional(),
  borderless: z.boolean().optional(),
  mediaTypes: z.array(z.string()).optional(),
}).passthrough();

export const createPrinterSchema = z.object({
  name: z.string().min(1, 'name обязателен'),
  printer_type: z.enum(['photo', 'document', 'mfp'], { message: 'printer_type должен быть photo/document/mfp' }),
  win_printer_name: z.string().min(1, 'win_printer_name обязателен'),
  studio_id: z.string().uuid().nullable().optional(),
  capabilities: capabilitiesSchema,
  is_active: z.boolean().optional().default(true),
});

export type CreatePrinterInput = z.infer<typeof createPrinterSchema>;

// ── PUT /printers/:id ───────────────────────────────────────────────

export const updatePrinterSchema = z.object({
  name: z.string().min(1).optional(),
  printer_type: z.enum(['photo', 'document', 'mfp']).optional(),
  win_printer_name: z.string().min(1).optional(),
  studio_id: z.string().uuid().nullable().optional(),
  capabilities: capabilitiesSchema.optional(),
  is_active: z.boolean().optional(),
});

export type UpdatePrinterInput = z.infer<typeof updatePrinterSchema>;

// ── POST /jobs ──────────────────────────────────────────────────────
// P1 SECURITY FIX: URL validation (SSRF prevention)

export const createPrintJobSchema = z.object({
  printer_id: z.string().uuid('printer_id обязателен'),
  file_url: z.string()
    .url('file_url must be valid URL')
    .refine(u => {
      const url = new URL(u);
      return MEDIA_ALLOWED_DOMAINS.some(d => url.hostname === d || url.hostname?.endsWith(`.${d}`));
    }, 'file_url must be from allowed media origins')
    .refine(u => {
      const protocol = new URL(u).protocol;
      return protocol === 'https:' || protocol === 'http:';
    }, 'file_url must use HTTP(S) protocol'),
  file_name: z.string().optional(),
  copies: z.coerce.number().int().min(1).optional(),
  paper_size: z.string().optional(),
  color_mode: z.enum(['color', 'bw']).optional().default('color'),
  quality: z.string().optional(),
  duplex: z.boolean().optional().default(false),
  orientation: z.enum(['portrait', 'landscape', 'auto']).optional().default('auto'),
  borderless: z.boolean().optional().default(false),
  media_type: z.string().optional(),
  fit_mode: z.enum(['fit', 'fill', 'stretch', 'actual']).optional(),
  layout_rows: z.number().int().min(1).max(20).optional(),
  layout_cols: z.number().int().min(1).max(20).optional(),
  cut_margin_mm: z.number().min(0).max(10).optional(),
  cut_marks: z.boolean().optional(),
  cut_mark_length_mm: z.number().min(1).max(20).optional(),
  cut_mark_offset_mm: z.number().min(0).max(10).optional(),
  custom_photo_width_mm: z.number().min(10).max(500).optional(),
  custom_photo_height_mm: z.number().min(10).max(500).optional(),
  order_id: z.string().optional(),
  order_type: z.string().optional(),
  receipt_id: z.string().optional(),
  icc_profile_id: z.string().uuid('Must be valid UUID').optional(),
  rendering_intent: z.enum(['perceptual', 'relative_colorimetric', 'saturation', 'absolute_colorimetric']).optional(),
  photo_enhance: z.boolean().optional(),
  brightness: z.coerce.number().int().min(-40).max(40).optional(),
  contrast: z.coerce.number().int().min(-40).max(40).optional(),
  saturation: z.coerce.number().int().min(-60).max(60).optional(),
});

export type CreatePrintJobInput = z.infer<typeof createPrintJobSchema>;

// ── POST /bridges ───────────────────────────────────────────────────

export const createBridgeDeviceSchema = z.object({
  studio_id: z.string().uuid('studio_id обязателен'),
  name: z.string().min(1, 'name обязателен'),
  mqtt_username: z.string().min(1, 'mqtt_username обязателен'),
  mqtt_password_hash: z.string().min(1, 'mqtt_password_hash обязателен'),
});

export type CreateBridgeDeviceInput = z.infer<typeof createBridgeDeviceSchema>;

// ── PUT /bridges/:id ────────────────────────────────────────────────

export const updateBridgeDeviceSchema = z.object({
  name: z.string().min(1).optional(),
  studio_id: z.string().uuid().optional(),
  is_active: z.boolean().optional(),
});

export type UpdateBridgeDeviceInput = z.infer<typeof updateBridgeDeviceSchema>;
