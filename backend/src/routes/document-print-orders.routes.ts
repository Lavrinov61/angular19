import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import db from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { createUploadLimiter } from '../middleware/upload-limiter.js';
import { enqueueCrmEvent } from '../services/crm-event-queue.service.js';
import { generateOrderId } from '../utils/secure-random.js';
import { createLogger } from '../utils/logger.js';
import type PhotoPrintOrders from '../types/generated/public/PhotoPrintOrders.js';
import type { PickupStudioLookupRow } from '../types/views/studio-views.js';
import { createPresignedUploadRoutes, type VerifiedFile } from './shared/presigned-upload.factory.js';

const log = createLogger('document-print-orders');
const router = express.Router();

const MAX_DOCUMENT_FILE_SIZE = 100 * 1024 * 1024;
const MAX_DOCUMENT_FILES = 20;

const DOCUMENT_PRINT_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/rtf',
  'text/rtf',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'text/plain',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'image/bmp',
]);

const paperSizeSchema = z.enum(['a4', 'a3']);
const colorModeSchema = z.enum(['bw', 'color']);
const sidesSchema = z.enum(['single', 'double']);
const finishingSchema = z.enum(['none', 'staple', 'clip', 'plastic_spring']);

const createDocumentPrintOrderSchema = z.object({
  contact: z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(10).max(40),
    email: z.string().trim().email().max(254).optional().or(z.literal('')),
    comments: z.string().trim().max(1000).optional().or(z.literal('')),
  }),
  pickupLocationId: z.string().trim().min(1).max(120),
  print: z.object({
    paperSize: paperSizeSchema,
    colorMode: colorModeSchema,
    sides: sidesSchema.default('single'),
    copies: z.number().int().min(1).max(999),
    finishing: finishingSchema.default('none'),
  }),
  files: z.array(z.object({
    fileName: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(160),
    fileSize: z.number().int().positive().max(MAX_DOCUMENT_FILE_SIZE),
    s3Key: z.string().trim().min(1).max(512).optional(),
    uploadedUrl: z.string().trim().min(1).max(2048),
    pageCount: z.number().int().min(1).max(2000),
  })).min(1).max(MAX_DOCUMENT_FILES),
  source: z.string().trim().max(50).optional().default('website'),
});

type CreateDocumentPrintOrderInput = z.infer<typeof createDocumentPrintOrderSchema>;
type DocumentPaperSize = z.infer<typeof paperSizeSchema>;
type DocumentColorMode = z.infer<typeof colorModeSchema>;

const UNIT_PRICES: Record<DocumentPaperSize, Record<DocumentColorMode, number>> = {
  a4: { bw: 10, color: 15 },
  a3: { bw: 20, color: 30 },
};

const PAPER_LABELS: Record<DocumentPaperSize, string> = {
  a4: 'A4',
  a3: 'A3',
};

const COLOR_LABELS: Record<DocumentColorMode, string> = {
  bw: 'черно-белая',
  color: 'цветная',
};

const FINISHING_LABELS: Record<z.infer<typeof finishingSchema>, string> = {
  none: 'без переплёта',
  staple: 'скрепка',
  clip: 'зажим',
  plastic_spring: 'пластиковая пружина',
};

const FINISHING_UNIT_PRICES: Record<z.infer<typeof finishingSchema>, number> = {
  none: 0,
  staple: 0,
  clip: 0,
  plastic_spring: 100,
};

function normalizeOptionalText(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePhone(phone: string): string {
  return phone.trim();
}

function validatePhone(phone: string): void {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) {
    throw new AppError(400, 'Укажите корректный номер телефона');
  }
}

async function resolvePickupStudio(locationId: string): Promise<PickupStudioLookupRow | null> {
  const normalizedLocationId = locationId.trim();
  if (!normalizedLocationId) return null;

  return db.queryOne<PickupStudioLookupRow>(
    `SELECT id::text,
            name,
            address,
            location_code,
            CASE WHEN status_until IS NOT NULL AND status_until < CURRENT_DATE
                 THEN 'open'
                 ELSE COALESCE(status, 'open')
            END AS status,
            CASE WHEN status_until IS NOT NULL AND status_until < CURRENT_DATE
                 THEN NULL
                 ELSE status_message
            END AS status_message,
            CASE WHEN status_until IS NOT NULL AND status_until < CURRENT_DATE
                 THEN NULL
                 ELSE status_until::text
            END AS status_until
     FROM studios
     WHERE location_code = $1 OR id::text = $1
     LIMIT 1`,
    [normalizedLocationId],
  );
}

function calculateTotalPrice(body: CreateDocumentPrintOrderInput): number {
  const unitPrice = UNIT_PRICES[body.print.paperSize][body.print.colorMode];
  const printedSides = body.files.reduce((sum, file) => sum + file.pageCount, 0) * body.print.copies;
  const finishingPrice = FINISHING_UNIT_PRICES[body.print.finishing] * body.print.copies;
  return Number((printedSides * unitPrice + finishingPrice).toFixed(2));
}

function buildOrderItems(body: CreateDocumentPrintOrderInput, unitPrice: number) {
  const finishingPrice = FINISHING_UNIT_PRICES[body.print.finishing] * body.print.copies;
  return body.files.map((file, index) => {
    const totalSides = file.pageCount * body.print.copies;
    const printSubtotal = Number((totalSides * unitPrice).toFixed(2));
    const itemFinishingPrice = index === 0 ? finishingPrice : 0;
    return {
      type: 'document_print',
      fileName: file.fileName,
      uploadedUrl: file.uploadedUrl,
      s3Key: file.s3Key ?? null,
      contentType: file.contentType,
      fileSize: file.fileSize,
      pageCount: file.pageCount,
      copies: body.print.copies,
      paperSize: body.print.paperSize,
      colorMode: body.print.colorMode,
      sides: body.print.sides,
      finishing: body.print.finishing,
      unitPrice,
      finishingPrice: itemFinishingPrice,
      totalSides,
      subtotal: Number((printSubtotal + itemFinishingPrice).toFixed(2)),
    };
  });
}

router.use('/direct-upload', createPresignedUploadRoutes({
  prefix: 'document-print',
  allowedMimes: DOCUMENT_PRINT_MIMES,
  maxFileSize: MAX_DOCUMENT_FILE_SIZE,
  maxFiles: MAX_DOCUMENT_FILES,
  auth: [],
  rateLimiter: createUploadLimiter('ul-document-print:', 80),
  onComplete: async (files: VerifiedFile[], _req: Request, res: Response): Promise<void> => {
    res.json({
      success: true,
      data: {
        files: files.map((file) => ({
          s3Key: file.s3Key,
          uploadedUrl: file.s3Url,
          fileName: file.fileName,
          contentType: file.contentType,
          fileSize: file.fileSize,
        })),
        count: files.length,
      },
    });
  },
}));

router.post('/', validate(createDocumentPrintOrderSchema), async (req: Request, res: Response): Promise<void> => {
  const body = req.body as CreateDocumentPrintOrderInput;

  validatePhone(body.contact.phone);

  const pickupStudio = await resolvePickupStudio(body.pickupLocationId);
  if (!pickupStudio) {
    throw new AppError(400, 'Выбранная точка самовывоза недоступна');
  }
  if ((pickupStudio.status || 'open') !== 'open') {
    throw new AppError(409, pickupStudio.status_message || 'Эта точка сейчас недоступна для самовывоза');
  }

  const orderId = generateOrderId();
  const unitPrice = UNIT_PRICES[body.print.paperSize][body.print.colorMode];
  const totalPrice = calculateTotalPrice(body);
  const orderItems = buildOrderItems(body, unitPrice);
  const contactName = body.contact.name.trim();
  const contactPhone = normalizePhone(body.contact.phone);
  const printLabel = `${PAPER_LABELS[body.print.paperSize]} ${COLOR_LABELS[body.print.colorMode]}`;
  const pickupWishes = [
    `Самовывоз: ${pickupStudio.name}, ${pickupStudio.address}`,
    `Печать: ${printLabel}, ${body.print.copies} экз., ${body.print.sides === 'double' ? 'двусторонняя' : 'односторонняя'}`,
    body.print.finishing !== 'none' ? `Скрепление: ${FINISHING_LABELS[body.print.finishing]}` : null,
  ].filter((part): part is string => Boolean(part));

  const params: unknown[] = [
    orderId,
    'document_print',
    contactName,
    contactPhone,
    normalizeOptionalText(body.contact.email),
    normalizeOptionalText(body.contact.comments),
    totalPrice,
    JSON.stringify(orderItems),
    'pending_payment',
    'none',
    'pickup',
    pickupStudio.address,
    `Печать документов, самовывоз: ${pickupStudio.name}`,
    pickupWishes.join('\n'),
    2,
    body.source || 'website',
    'document_print',
  ];

  await db.queryOne<PhotoPrintOrders>(
    `INSERT INTO photo_print_orders (
        order_id, mode, contact_name, contact_phone, contact_email,
        comments, total_price, items, status, payment_status,
        delivery_method, delivery_address, description, wishes,
        priority, source, service_type
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17
      ) RETURNING *`,
    params,
  );

  enqueueCrmEvent('order', orderId, 'order_created', {
    client_name: contactName,
    client_phone: contactPhone,
    preview: `Печать документов ${orderId}`,
    status: 'pending_payment',
    priority: 2,
    sort_time: new Date().toISOString(),
    channel: null,
    assigned_to: null,
    assigned_to_name: null,
    unread: false,
    metadata: {
      paymentRequired: true,
      source: body.source || 'website',
      serviceType: 'document_print',
      pickupLocationId: pickupStudio.location_code || pickupStudio.id,
      pickupAddress: pickupStudio.address,
      totalFiles: body.files.length,
      totalPrice,
    },
  }).catch((err: unknown) => log.warn('enqueueCrmEvent failed', { orderId, error: String(err) }));

  res.status(201).json({
    success: true,
    data: {
      orderId,
      totalPrice,
      paymentUrl: `/pay/${orderId}`,
      message: 'Заказ создан, ожидается оплата',
    },
  });
});

export default router;
