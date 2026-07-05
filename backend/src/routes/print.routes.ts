/**
 * @deprecated DEPRECATED: These routes are handled by Rust print-api at :3004.
 * nginx routes /api/print/* directly to Rust. This file is disconnected from app.ts.
 * Safe to delete after 2026-04-30.
 */
import { Router, Response } from 'express';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  createPrintJobSchema,
} from '../schemas/print.schema.js';
import {
  getPrinters, getAllPrinters,
  createPrintJob, getPrintQueue, getJobById,
  cancelJob, getPrinterById, updateJobStatus,
} from '../services/print.service.js';

const router = Router();
router.use(authenticateToken, requirePermission('pos:use'));

// ─── PRINTERS READ ─────────────────────────────────────────

router.get('/printers/all', requirePermission('catalog:manage'), async (_req: AuthRequest, res: Response) => {
  const printers = await getAllPrinters();
  res.json({ success: true, printers });
});

router.get('/printers', async (req: AuthRequest, res: Response) => {
  const { studio_id } = req.query as Record<string, string>;
  const printers = await getPrinters(studio_id);
  res.json({ success: true, printers });
});

// ─── JOBS ─────────────────────────────────────────────────

router.post('/jobs', validate(createPrintJobSchema), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const {
    printer_id, file_url, file_name,
    copies, paper_size, color_mode, quality,
    duplex, orientation, borderless, media_type, fit_mode,
    order_id, order_type, receipt_id,
  } = req.body;

  const job = await createPrintJob({
    printer_id,
    file_url,
    file_name,
    copies,
    paper_size,
    color_mode,
    quality,
    duplex,
    orientation,
    borderless,
    media_type,
    fit_mode,
    order_id,
    order_type,
    receipt_id,
    created_by: req.user.id,
    studio_id: req.user.studio_id ?? undefined,
  });

  res.status(201).json({ success: true, job });
});

router.get('/jobs', async (req: AuthRequest, res: Response) => {
  const { printer_id, status, studio_id, order_id, limit } = req.query as Record<string, string>;
  const jobs = await getPrintQueue({
    printer_id,
    status,
    studio_id: studio_id || (req.user?.studio_id ?? undefined),
    order_id,
    limit: limit ? parseInt(limit, 10) : undefined,
  });
  res.json({ success: true, jobs });
});

router.post('/jobs/:id/cancel', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  await cancelJob(id);
  res.json({ success: true });
});

router.post('/jobs/:id/retry', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const job = await getJobById(req.params['id']);
  if (!job) throw new AppError(404, 'Задание не найдено');
  if (!['failed', 'cancelled'].includes(job.status)) {
    throw new AppError(409, 'Можно повторить только неудавшееся или отменённое задание');
  }

  await updateJobStatus(job.id, 'queued', undefined);
  res.json({ success: true, job: { ...job, status: 'queued' } });
});

router.post('/jobs/:id/reprint', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const original = await getJobById(req.params['id']);
  if (!original) throw new AppError(404, 'Задание не найдено');

  const newJob = await createPrintJob({
    printer_id: original.printer_id,
    file_url: original.file_url,
    file_name: original.file_name ?? undefined,
    copies: original.copies,
    paper_size: original.paper_size,
    color_mode: original.color_mode,
    quality: original.quality,
    duplex: original.duplex,
    orientation: original.orientation,
    borderless: original.borderless,
    media_type: original.media_type ?? undefined,
    fit_mode: original.fit_mode,
    order_id: original.order_id ?? undefined,
    order_type: original.order_type ?? undefined,
    created_by: req.user.id,
    studio_id: original.studio_id ?? undefined,
  });

  res.status(201).json({ success: true, job: newJob });
});

export default router;
