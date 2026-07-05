import { Router, Response } from 'express';
import {
  createAssignment, takeOrder, completeOrder,
  requestHelp, joinOrder, getPendingOrders, getMyOrders, cancelAssignment,
} from '../services/order-assignment.service.js';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

router.use(authenticateToken);

// GET /api/orders/assignments/pending — незанятые заказы
router.get('/pending', async (req: AuthRequest, res: Response) => {
  const studioId = req.query['studio_id'] as string | undefined;
  const orders = await getPendingOrders(studioId);
  res.json({ success: true, orders });
});

// GET /api/orders/assignments/my — мои заказы в работе
router.get('/my', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const orders = await getMyOrders(req.user.id);
  res.json({ success: true, orders });
});

// POST /api/orders/assignments — создать задание (admin/manager)
router.post('/', requirePermission('workflows:manage'), async (req: AuthRequest, res: Response) => {
  const { order_id, order_type, order_summary, source, studio_id,
    deadline_at, estimated_minutes, priority, metadata } = req.body;
  if (!order_id || !order_type) throw new AppError(400, 'order_id and order_type are required');

  const assignment = await createAssignment({
    order_id, order_type, order_summary, source, studio_id,
    deadline_at, estimated_minutes, priority, metadata,
  });

  // Уведомить сотрудников через WebSocket
  const io = req.app.socketServer;
  if (io) {
    io.getIO().to('employee:dashboard').emit('order:new_pending', {
      assignment,
      message: `Новый заказ: ${order_type}${order_summary ? ' — ' + order_summary : ''}`,
    });
  }

  res.status(201).json({ success: true, assignment });
});

// POST /api/orders/assignments/:id/take — взять задание в работу
router.post('/:id/take', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const assignment = await takeOrder(req.params['id'], req.user.id);

  const io = req.app.socketServer;
  if (io) {
    io.getIO().to('employee:dashboard').emit('order:taken', {
      assignmentId: assignment.id,
      employeeId: req.user.id,
    });
  }

  res.json({ success: true, assignment });
});

// POST /api/orders/assignments/:id/complete — завершить задание
router.post('/:id/complete', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const assignment = await completeOrder(req.params['id'], req.user.id);

  const io = req.app.socketServer;
  if (io) {
    io.getIO().to('employee:dashboard').emit('order:completed', {
      assignmentId: assignment.id,
      employeeId: req.user.id,
    });
  }

  res.json({ success: true, assignment });
});

// POST /api/orders/assignments/:id/help — попросить помощи
router.post('/:id/help', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const { message } = req.body;
  if (!message) throw new AppError(400, 'message is required');

  await requestHelp(req.params['id'], req.user.id, message);

  const io = req.app.socketServer;
  if (io) {
    io.getIO().to('employee:dashboard').emit('order:help_needed', {
      assignmentId: req.params['id'],
      employeeId: req.user.id,
      message,
    });
  }

  res.json({ success: true });
});

// POST /api/orders/assignments/:id/join — присоединиться для помощи
router.post('/:id/join', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  await joinOrder(req.params['id'], req.user.id);

  const io = req.app.socketServer;
  if (io) {
    io.getIO().to('employee:dashboard').emit('order:helper_joined', {
      assignmentId: req.params['id'],
      helperId: req.user.id,
    });
  }

  res.json({ success: true });
});

// POST /api/orders/assignments/:id/cancel — отменить задание (admin/manager)
router.post('/:id/cancel', requirePermission('workflows:manage'), async (_req, res: Response) => {
  await cancelAssignment(_req.params['id']);
  res.json({ success: true });
});

export default router;
