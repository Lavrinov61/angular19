/**
 * @deprecated PARTIALLY DEPRECATED: Print HTTP routes are now handled by Rust print-api at :3004.
 * nginx routes /api/print/* directly to Rust. The route file (print.routes.ts) is disconnected.
 *
 * STILL IN USE by orders.routes.ts: autoRoutePrinter(), createPrintJob(), updateJobStatus()
 * These functions write to the shared `print_jobs` / `printers` PG tables.
 * DO NOT delete this file until orders.routes.ts is migrated to call Rust print-api instead.
 *
 * Safe to delete bridge-related code (sendToBridge, BridgeDevice CRUD) after 2026-04-30.
 *
 * Original description:
 * Print Service — управление принтерами и очередью печати
 * Epson L8050 (фото) + Canon C3226i (документы/МФУ)
 * Связь через POS Bridge (localhost:8888) → SvfPrintHelper.exe
 */
import db from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
// config import removed — bridge proxy deleted
import { createLogger } from '../utils/logger.js';
import type { PrintItem } from '../utils/order-item.js';
import { OrderItemType } from '../utils/order-item.js';
import type { PhotoPrintOrder } from '../types/views/print-order-views.js';

const printLog = createLogger('print.service');

// ─── TYPES ────────────────────────────────────────────────

export interface PaperSize {
  id: string;
  name: string;
  width_mm: number;
  height_mm: number;
}

export interface MediaType {
  id: string;
  name: string;
}

export interface QualityMode {
  id: string;
  name: string;
}

export interface PrinterCapabilities {
  paper_sizes: PaperSize[];
  media_types: MediaType[];
  quality_modes: QualityMode[];
  color: boolean;
  duplex: boolean;
  borderless: boolean;
  max_dpi: number;
  ppm?: number;
  max_gsm?: number;
  ink_count?: number;
  ink_type?: string;
  sublimation?: boolean;
  mirror_default?: boolean;
  paper_sources?: { id: string; name: string }[];
  finishing?: { id: string; name: string; icon?: string }[];
}

export interface Printer {
  id: string;
  name: string;
  printer_type: 'photo' | 'document' | 'mfp';
  win_printer_name: string;
  studio_id: string | null;
  capabilities: PrinterCapabilities;
  is_active: boolean;
  created_at: string;
}

export interface PrintJob {
  id: string;
  printer_id: string;
  file_url: string;
  file_name: string | null;
  copies: number;
  paper_size: string;
  color_mode: 'color' | 'bw';
  quality: string;
  duplex: boolean;
  orientation: 'portrait' | 'landscape' | 'auto';
  borderless: boolean;
  media_type: string | null;
  fit_mode: 'fit' | 'fill' | 'stretch' | 'actual';
  status: 'queued' | 'sending' | 'printing' | 'completed' | 'failed' | 'cancelled';
  error_message: string | null;
  order_id: string | null;
  order_type: string | null;
  receipt_id: string | null;
  created_by: string;
  studio_id: string | null;
  completed_at: string | null;
  created_at: string;
  // Joined
  printer_name?: string;
  printer_type?: string;
  creator_name?: string;
}

export interface CreatePrintJobParams {
  printer_id: string;
  file_url: string;
  file_name?: string;
  copies?: number;
  paper_size?: string;
  color_mode?: 'color' | 'bw';
  quality?: string;
  duplex?: boolean;
  orientation?: 'portrait' | 'landscape' | 'auto';
  borderless?: boolean;
  media_type?: string;
  fit_mode?: 'fit' | 'fill' | 'stretch' | 'actual';
  rotation?: number;
  layout_rows?: number;
  layout_cols?: number;
  cut_margin_mm?: number;
  custom_photo_width_mm?: number;
  custom_photo_height_mm?: number;
  order_id?: string;
  order_type?: string;
  receipt_id?: string;
  created_by: string;
  studio_id?: string;
}

export interface PrinterWithStudio extends Printer {
  studio_name: string | null;
}

export interface PrintQueueFilters {
  printer_id?: string;
  status?: string;
  studio_id?: string;
  order_id?: string;
  limit?: number;
}

// ─── PRINTERS ─────────────────────────────────────────────

export async function getPrinters(studioId?: string): Promise<Printer[]> {
  const rows = studioId
    ? await db.query<Printer>(
        'SELECT * FROM printers WHERE is_active = TRUE AND (studio_id = $1 OR studio_id IS NULL) ORDER BY printer_type, name',
        [studioId]
      )
    : await db.query<Printer>(
        'SELECT * FROM printers WHERE is_active = TRUE ORDER BY printer_type, name'
      );
  return rows;
}

export async function getAllPrinters(): Promise<PrinterWithStudio[]> {
  return db.query<PrinterWithStudio>(
    `SELECT p.*, s.name AS studio_name
     FROM printers p
     LEFT JOIN studios s ON s.id = p.studio_id
     ORDER BY p.printer_type, p.name`
  );
}

// createPrinter, updatePrinter, deletePrinter — removed (now handled by Rust print-api :3004)

export async function getPrinterById(printerId: string): Promise<Printer> {
  const printer = await db.queryOne<Printer>(
    'SELECT * FROM printers WHERE id = $1 AND is_active = TRUE',
    [printerId]
  );
  if (!printer) throw new AppError(404, `Принтер не найден: ${printerId}`);
  return printer;
}

/**
 * Автоматический выбор принтера по типу заказа:
 * - photo_print, foto-na-document, photo → Epson L8050 (photo)
 * - document, pos, kserokopiya, scan, design → Canon C3226i (mfp/document)
 */
export async function autoRoutePrinter(orderType: string, studioId?: string): Promise<Printer> {
  const photoTypes = ['photo_print', 'foto-na-document', 'photo', 'pechat-foto'];
  const targetType = photoTypes.includes(orderType) ? 'photo' : 'mfp';

  const printer = await db.queryOne<Printer>(
    `SELECT * FROM printers
     WHERE is_active = TRUE AND printer_type = $1
       AND ($2::uuid IS NULL OR studio_id = $2 OR studio_id IS NULL)
     ORDER BY (studio_id IS NOT NULL) DESC, created_at
     LIMIT 1`,
    [targetType, studioId || null]
  );

  if (!printer) throw new AppError(503, `Принтер типа '${targetType}' не найден`);
  return printer;
}

// ─── PRINT JOBS ───────────────────────────────────────────

export async function createPrintJob(params: CreatePrintJobParams): Promise<PrintJob> {
  const printer = await getPrinterById(params.printer_id);

  // Дефолтный размер бумаги из capabilities
  const defaultPaper = (printer.capabilities.paper_sizes[0]?.id) || 'A4';
  const defaultMedia = printer.capabilities.media_types[0]?.id || null;
  const defaultQuality = printer.capabilities.quality_modes.find(q => q.id === 'photo')?.id
    || printer.capabilities.quality_modes[0]?.id || 'normal';

  const job = await db.queryOne<PrintJob>(
    `INSERT INTO print_jobs (
      printer_id, file_url, file_name,
      copies, paper_size, color_mode, quality, duplex,
      orientation, borderless, media_type, fit_mode,
      rotation, layout_rows, layout_cols, cut_margin_mm,
      custom_photo_width_mm, custom_photo_height_mm,
      order_id, order_type, receipt_id,
      created_by, studio_id, status
    ) VALUES (
      $1, $2, $3,
      $4, $5, $6, $7, $8,
      $9, $10, $11, $12,
      $13, $14, $15, $16,
      $17, $18,
      $19, $20, $21,
      $22, $23, 'queued'
    ) RETURNING *`,
    [
      params.printer_id, params.file_url, params.file_name || null,
      params.copies ?? 1,
      params.paper_size ?? defaultPaper,
      params.color_mode ?? 'color',
      params.quality ?? defaultQuality,
      params.duplex ?? false,
      params.orientation ?? 'auto',
      params.borderless ?? false,
      params.media_type ?? defaultMedia,
      params.fit_mode ?? (printer.printer_type === 'photo' ? 'fill' : 'fit'),
      params.rotation ?? 0,
      params.layout_rows ?? null,
      params.layout_cols ?? null,
      params.cut_margin_mm ?? null,
      params.custom_photo_width_mm ?? null,
      params.custom_photo_height_mm ?? null,
      params.order_id ?? null,
      params.order_type ?? null,
      params.receipt_id ?? null,
      params.created_by,
      params.studio_id ?? null,
    ]
  );

  if (!job) throw new AppError(500, 'Не удалось создать задание печати');
  return { ...job, printer_name: printer.name, printer_type: printer.printer_type };
}

export async function getPrintQueue(filters: PrintQueueFilters = {}): Promise<PrintJob[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (filters.printer_id) {
    conditions.push(`pj.printer_id = $${idx++}`);
    values.push(filters.printer_id);
  }
  if (filters.status) {
    conditions.push(`pj.status = $${idx++}`);
    values.push(filters.status);
  }
  if (filters.studio_id) {
    conditions.push(`pj.studio_id = $${idx++}`);
    values.push(filters.studio_id);
  }
  if (filters.order_id) {
    conditions.push(`pj.order_id = $${idx++}`);
    values.push(filters.order_id);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  values.push(limit);

  return db.query<PrintJob>(
    `SELECT pj.*, p.name AS printer_name, p.printer_type,
            u.display_name AS creator_name
     FROM print_jobs pj
     LEFT JOIN printers p ON p.id = pj.printer_id
     LEFT JOIN users u ON u.id = pj.created_by
     ${where}
     ORDER BY pj.created_at DESC
     LIMIT $${idx}`,
    values
  );
}

export async function getJobById(jobId: string): Promise<PrintJob | null> {
  return db.queryOne<PrintJob>(
    `SELECT pj.*, p.name AS printer_name, p.printer_type,
            u.display_name AS creator_name
     FROM print_jobs pj
     LEFT JOIN printers p ON p.id = pj.printer_id
     LEFT JOIN users u ON u.id = pj.created_by
     WHERE pj.id = $1`,
    [jobId]
  );
}

export async function updateJobStatus(
  jobId: string, status: string, errorMessage?: string
): Promise<void> {
  await db.query(
    `UPDATE print_jobs SET status = $1, error_message = $2,
       completed_at = CASE WHEN $1 IN ('completed','failed','cancelled') THEN NOW() ELSE NULL END
     WHERE id = $3`,
    [status, errorMessage ?? null, jobId]
  );
}

export async function cancelJob(jobId: string): Promise<void> {
  const job = await db.queryOne<{ status: string }>(
    'SELECT status FROM print_jobs WHERE id = $1', [jobId]
  );
  if (!job) throw new AppError(404, 'Задание не найдено');
  if (job.status === 'printing') throw new AppError(409, 'Задание уже печатается');
  if (job.status === 'completed') throw new AppError(409, 'Задание уже завершено');
  await updateJobStatus(jobId, 'cancelled');
}

// ─── AUTO-PRINT ──────────────────────────────────────────────

/** Statuses that trigger auto-print (configurable via env) */
const AUTO_PRINT_STATUSES = (process.env['AUTO_PRINT_STATUSES'] || 'processing').split(',').map(s => s.trim());
const AUTO_PRINT_ENABLED = process.env['AUTO_PRINT_ENABLED'] !== 'false';

export interface AutoPrintResult {
  queued: number;
  printerId: string | null;
  printerName: string | null;
}

/**
 * Auto-print: создаёт print jobs для всех PrintItem в заказе photo_print_orders.
 * Вызывается при переходе статуса в AUTO_PRINT_STATUSES.
 */
export async function autoPrintOrderItems(orderId: string, operatorId: string): Promise<AutoPrintResult> {
  if (!AUTO_PRINT_ENABLED) return { queued: 0, printerId: null, printerName: null };

  const ppo = await db.queryOne<Pick<PhotoPrintOrder, 'items' | 'service_type' | 'order_id'>>(
    `SELECT items, service_type, order_id FROM photo_print_orders WHERE order_id = $1`,
    [orderId]
  );
  if (!ppo || !Array.isArray(ppo.items) || ppo.items.length === 0) {
    return { queued: 0, printerId: null, printerName: null };
  }

  const printItems = ppo.items.filter((i): i is PrintItem => i.type === OrderItemType.PRINT);
  if (printItems.length === 0) {
    return { queued: 0, printerId: null, printerName: null };
  }

  const printer = await autoRoutePrinter(ppo.service_type ?? 'photo_print');
  let queued = 0;

  for (const item of printItems) {
    if (!item.uploadedUrl) continue;

    await createPrintJob({
      printer_id: printer.id,
      file_url: item.uploadedUrl,
      file_name: `${item.format} — ${ppo.order_id}`,
      copies: item.quantity,
      paper_size: item.format,
      order_id: ppo.order_id,
      order_type: 'auto_print',
      created_by: operatorId,
      studio_id: printer.studio_id ?? undefined,
    });
    queued++;
  }

  if (queued > 0) {
    printLog.info(`[AutoPrint] Queued ${queued} jobs for order ${ppo.order_id}`, {
      orderId: ppo.order_id, printerId: printer.id, printerName: printer.name, jobCount: queued,
    });
  }

  return { queued, printerId: printer.id, printerName: printer.name };
}

/** Check if a given status should trigger auto-print */
export function shouldAutoPrint(status: string): boolean {
  return AUTO_PRINT_ENABLED && AUTO_PRINT_STATUSES.includes(status);
}

// sendToBridge, Telemetry, BridgeDevice CRUD — removed (now handled by Rust print-api :3004)
