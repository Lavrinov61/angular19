import { Router, Response } from 'express';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  createRetouchTask,
  getRetouchQueue,
  getRetouchDetail,
  startRetouch,
  uploadResult,
  sendForApproval,
  getStats,
  bulkAssign,
  bulkCancel,
  bulkReassign,
  getPresets,
  createPreset,
  updatePreset,
  deletePreset,
} from '../services/retouch.service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('retouch-routes');

const router = Router();

router.use(authenticateToken);

// ─── POST /api/retouch — Create retouch task ───────────────────────────────
router.post('/', requirePermission('tasks:manage'), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const {
    order_id, chat_session_id, client_name, client_phone, studio_id,
    retouch_level, retouch_options, source_photo_url,
    document_type, priority, deadline_minutes, notes,
  } = req.body;

  if (!retouch_level) throw new AppError(400, 'retouch_level is required');
  if (!source_photo_url) throw new AppError(400, 'source_photo_url is required');

  const result = await createRetouchTask({
    order_id, chat_session_id, client_name, client_phone, studio_id,
    retouch_level, retouch_options, source_photo_url,
    document_type, priority, deadline_minutes, notes,
    created_by: req.user.id,
  });

  // WebSocket notification
  const io = req.app.socketServer;
  if (io) {
    io.getIO().to('employee:dashboard').emit('retouch:new', {
      id: result.id,
      task_number: result.task_number,
      status: result.status,
      assigned_to: result.assigned_to,
      retoucher_name: result.retoucher_name,
      retouch_level,
    });
  }

  res.status(201).json({ success: true, data: result });
});

// ─── GET /api/retouch/stats — KPI stats ────────────────────────────────────
router.get('/stats', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const stats = await getStats(req.query['studio_id'] as string | undefined);
  res.json({ success: true, data: stats });
});

// ─── GET /api/retouch/queue — Retouch queue ─────────────────────────────────
router.get('/queue', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { status, assigned_to, studio_id, order_id } = req.query as Record<string, string | undefined>;

  const tasks = await getRetouchQueue({
    status,
    assigned_to,
    studio_id,
    order_id,
    requesting_user_id: req.user.id,
  });

  res.json({ success: true, data: tasks });
});

// ─── GET /api/retouch/presets — List active presets ─────────────────────────
router.get('/presets', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const documentType = req.query['document_type'] as string | undefined;
  const presets = await getPresets(documentType);
  res.json({ success: true, data: presets });
});

// ─── POST /api/retouch/presets — Create preset (admin) ─────────────────────
router.post('/presets', requirePermission('tasks:manage'), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const preset = await createPreset(req.body);
  res.status(201).json({ success: true, data: preset });
});

// ─── PUT /api/retouch/presets/:presetId — Update preset ────────────────────
router.put('/presets/:presetId', requirePermission('tasks:manage'), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const preset = await updatePreset(req.params['presetId'], req.body);
  res.json({ success: true, data: preset });
});

// ─── DELETE /api/retouch/presets/:presetId — Deactivate preset ─────────────
router.delete('/presets/:presetId', requirePermission('tasks:manage'), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  await deletePreset(req.params['presetId']);
  res.json({ success: true });
});

// ─── POST /api/retouch/bulk/assign — Bulk assign tasks ─────────────────────
router.post('/bulk/assign', requirePermission('tasks:manage'), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { task_ids, retoucher_id } = req.body;
  if (!Array.isArray(task_ids) || !task_ids.length) throw new AppError(400, 'task_ids array is required');
  if (!retoucher_id) throw new AppError(400, 'retoucher_id is required');

  const result = await bulkAssign(task_ids, retoucher_id, req.user.id);

  const io = req.app.socketServer;
  if (io) {
    io.getIO().to('employee:dashboard').emit('retouch:bulk_assigned', {
      task_ids, retoucher_id, updated: result.updated,
    });
  }

  res.json({ success: true, data: result });
});

// ─── POST /api/retouch/bulk/cancel — Bulk cancel tasks ─────────────────────
router.post('/bulk/cancel', requirePermission('tasks:manage'), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { task_ids } = req.body;
  if (!Array.isArray(task_ids) || !task_ids.length) throw new AppError(400, 'task_ids array is required');

  const result = await bulkCancel(task_ids, req.user.id);

  const io = req.app.socketServer;
  if (io) {
    io.getIO().to('employee:dashboard').emit('retouch:bulk_cancelled', {
      task_ids, updated: result.updated,
    });
  }

  res.json({ success: true, data: result });
});

// ─── POST /api/retouch/bulk/reassign — Bulk reassign tasks ─────────────────
router.post('/bulk/reassign', requirePermission('tasks:manage'), async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { task_ids, retoucher_id } = req.body;
  if (!Array.isArray(task_ids) || !task_ids.length) throw new AppError(400, 'task_ids array is required');
  if (!retoucher_id) throw new AppError(400, 'retoucher_id is required');

  const result = await bulkReassign(task_ids, retoucher_id, req.user.id);

  const io = req.app.socketServer;
  if (io) {
    io.getIO().to('employee:dashboard').emit('retouch:bulk_reassigned', {
      task_ids, retoucher_id, updated: result.updated,
    });
  }

  res.json({ success: true, data: result });
});

// ─── GET /api/retouch/:id — Retouch task details ────────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const detail = await getRetouchDetail(req.params['id']);

  res.json({ success: true, data: detail });
});

// ─── POST /api/retouch/:id/start — Take in work ────────────────────────────
router.post('/:id/start', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const task = await startRetouch(req.params['id'], req.user.id);

  const io = req.app.socketServer;
  if (io) {
    io.getIO().to('employee:dashboard').emit('retouch:started', {
      taskId: task.id,
      employeeId: req.user.id,
    });
  }

  res.json({ success: true, data: task });
});

// ─── POST /api/retouch/:id/upload-result — Upload retouched photo ───────────
router.post('/:id/upload-result', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { s3_key, notes } = req.body;
  if (!s3_key) throw new AppError(400, 's3_key is required');

  const task = await uploadResult(req.params['id'], req.user.id, s3_key, notes);

  // Face validation для документов
  let faceValidation = null;
  if (task.retouch_level) {
    try {
      const { validateFace } = await import('../services/face-validation.service.js');
      faceValidation = await validateFace(`/media/${s3_key}`);
    } catch (err) {
      log.warn('[Retouch] Face validation failed', { error: String(err) });
    }
  }

  const io = req.app.socketServer;
  if (io) {
    io.getIO().to('employee:dashboard').emit('retouch:result_uploaded', {
      taskId: task.id,
    });
  }

  res.json({ success: true, data: { ...task, face_validation: faceValidation } });
});

// ─── POST /api/retouch/:id/send-for-approval — Send to client ──────────────
router.post('/:id/send-for-approval', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { task, publicLink } = await sendForApproval(req.params['id'], req.user.id);

  const io = req.app.socketServer;
  if (io) {
    io.getIO().to('employee:dashboard').emit('retouch:sent_for_approval', {
      taskId: task.id,
      publicLink,
    });
  }

  res.json({ success: true, data: { task, publicLink } });
});

export default router;
