import express, { Response } from 'express';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import db from '../database/db.js';
import {
  getAvailableSlots,
  createBooking,
  getBookings,
  getBookingById,
  updateBookingStatus,
  rescheduleBooking,
  getScheduleOverview,
  getStudios,
  searchClients,
} from '../services/booking-autonomous.service.js';
import type { BookingRecord } from '../services/booking-autonomous.service.js';
import { getClientContext, getClientContextByUserId, getClientContextByContactId } from '../services/client-context.service.js';
import type { SocketServer } from '../websocket/socket-server.js';
import type { BookingStatusHistoryEventLookup } from '../types/views/booking-views.js';

const router = express.Router();

function isStaff(role: string): boolean {
  return ['admin', 'employee', 'photographer'].includes(role);
}

function getSocketServer(req: express.Request): SocketServer | undefined {
  return req.app.socketServer;
}

type BookingEvent = 'booking:created' | 'booking:updated' | 'booking:cancelled' | 'booking:rescheduled';
type BookingEventValue = string | number | boolean | null | undefined | BookingRecord;

interface BookingEventData {
  readonly [key: string]: BookingEventValue;
}

const UNKNOWN_CLIENT_PHONE = '?';

function normalizeClientPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\?+$/.test(trimmed)) {
    return UNKNOWN_CLIENT_PHONE;
  }

  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 10 ? digits : null;
}

function emitBookingEvent(
  req: express.Request,
  studioId: string,
  event: BookingEvent,
  data: BookingEventData,
): void {
  const socketServer = getSocketServer(req);
  socketServer?.sendTaskEvent(studioId, event, data);
}

// All CRM booking endpoints require authentication and bookings:manage permission
router.use(authenticateToken, requirePermission('bookings:manage'));

// ============================================================================
// GET /api/crm-booking/studios — Список студий
// ============================================================================
router.get('/studios', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Доступ запрещён');
  }

  const studios = await getStudios();
  res.json({ studios });
});

// ============================================================================
// GET /api/crm-booking/slots — Доступные слоты
// ============================================================================
router.get('/slots', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Доступ запрещён');
  }

  const { studioId, date } = req.query;

  if (!studioId || !date) {
    throw new AppError(400, 'studioId и date обязательны');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date as string)) {
    throw new AppError(400, 'Формат даты: YYYY-MM-DD');
  }

  const result = await getAvailableSlots(studioId as string, date as string);
  res.json(result);
});

// ============================================================================
// POST /api/crm-booking/book — Создать запись
// ============================================================================
router.post('/book', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Доступ запрещён');
  }

  const { studioId, date, time, duration, clientName, clientPhone, clientEmail, serviceName, source, notes } = req.body;

  if (!studioId || !date || !time || typeof clientName !== 'string' || !clientName.trim() || clientPhone === undefined || clientPhone === null) {
    throw new AppError(400, 'studioId, date, time, clientName, clientPhone обязательны');
  }

  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AppError(400, 'Формат даты: YYYY-MM-DD');
  }

  if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) {
    throw new AppError(400, 'Формат времени: HH:MM');
  }

  const normalizedPhone = normalizeClientPhone(clientPhone);
  if (!normalizedPhone) {
    throw new AppError(400, "Телефон: минимум 10 цифр или '?'");
  }

  const result = await createBooking({
    studioId,
    date,
    time,
    duration: duration || 30,
    clientName: clientName.trim(),
    clientPhone: normalizedPhone,
    clientEmail: clientEmail || undefined,
    serviceName,
    source: source || 'crm',
    notes,
    createdBy: req.user.id,
  });

  if (!result.success) {
    throw new AppError(409, result.error || 'Conflict');
  }

  // WebSocket: уведомляем операторов
  emitBookingEvent(req, studioId, 'booking:created', { bookingId: result.bookingId, studioId, date, time });

  res.status(201).json(result);
});

// ============================================================================
// GET /api/crm-booking/list — Список записей
// ============================================================================
router.get('/list', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Доступ запрещён');
  }

  const { studioId, dateFrom, dateTo, status, clientPhone, limit, offset } = req.query;

  const result = await getBookings({
    studioId: studioId as string | undefined,
    dateFrom: dateFrom as string | undefined,
    dateTo: dateTo as string | undefined,
    status: status as string | undefined,
    clientPhone: clientPhone as string | undefined,
    limit: limit ? parseInt(limit as string, 10) : undefined,
    offset: offset ? parseInt(offset as string, 10) : undefined,
  });

  res.json(result);
});

// ============================================================================
// GET /api/crm-booking/clients/search — Поиск клиентов по телефону
// ============================================================================
router.get('/clients/search', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Доступ запрещён');
  }

  const { phone } = req.query;
  if (!phone || (phone as string).replace(/\D/g, '').length < 3) {
    res.json({ clients: [] });
    return;
  }

  const cleanPhone = (phone as string).replace(/\D/g, '');
  const clients = await searchClients(cleanPhone);
  res.json({ clients });
});

// ============================================================================
// GET /api/crm-booking/client-context — Карточка клиента по телефону
// ============================================================================
router.get('/client-context', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Доступ запрещён');
  }

  const { phone, userId, contactId } = req.query;
  if (!phone && !userId && !contactId) {
    throw new AppError(400, 'phone, userId или contactId обязателен');
  }

  const context = userId
    ? await getClientContextByUserId(userId as string)
    : contactId
      ? await getClientContextByContactId(contactId as string)
      : await getClientContext(phone as string);
  res.json({ success: true, data: context });
});

// ============================================================================
// GET /api/crm-booking/:id — Детали записи
// ============================================================================
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Доступ запрещён');
  }

  const booking = await getBookingById(req.params['id']);

  if (!booking) {
    throw new AppError(404, 'Запись не найдена');
  }

  const events = await db.query<BookingStatusHistoryEventLookup>(
    `SELECT h.id, h.old_status, h.new_status, h.changed_at,
            u.display_name as changed_by_name
     FROM booking_status_history h
     LEFT JOIN users u ON u.id = h.changed_by
     WHERE h.booking_id = $1
     ORDER BY h.changed_at ASC`,
    [req.params['id']],
  );

  res.json({ success: true, booking, events });
});

// ============================================================================
// PUT /api/crm-booking/:id/status — Обновить статус
// ============================================================================
router.put('/:id/status', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Доступ запрещён');
  }

  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'cancelled', 'completed', 'no-show'];

  if (!status || !validStatuses.includes(status)) {
    throw new AppError(400, `status должен быть: ${validStatuses.join(', ')}`);
  }

  const booking = await updateBookingStatus(req.params['id'], status, req.user!.id);

  if (!booking) {
    throw new AppError(404, 'Запись не найдена');
  }

  // WebSocket: уведомляем операторов
  const wsEvent = status === 'cancelled' ? 'booking:cancelled' : 'booking:updated';
  emitBookingEvent(req, booking.studio_id, wsEvent, { booking });

  res.json({ success: true, booking });
});

// ============================================================================
// PUT /api/crm-booking/:id/reschedule — Перенести запись
// ============================================================================
router.put('/:id/reschedule', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Доступ запрещён');
  }

  const { date, time, studioId } = req.body;

  if (!date || !time) {
    throw new AppError(400, 'date и time обязательны');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AppError(400, 'Формат даты: YYYY-MM-DD');
  }

  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new AppError(400, 'Формат времени: HH:MM');
  }

  const result = await rescheduleBooking(req.params['id'], date, time, studioId);

  if (!result.success) {
    throw new AppError(409, result.error || 'Conflict');
  }

  // WebSocket: уведомляем операторов
  if (result.booking) {
    emitBookingEvent(req, result.booking.studio_id, 'booking:rescheduled', { booking: result.booking });
  }

  res.json(result);
});

// ============================================================================
// GET /api/crm-booking/schedule — Обзор расписания на неделю
// ============================================================================
router.get('/schedule/overview', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || !isStaff(req.user.role)) {
    throw new AppError(403, 'Доступ запрещён');
  }

  const { studioId, weekStart } = req.query;

  if (!studioId || !weekStart) {
    throw new AppError(400, 'studioId и weekStart обязательны');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart as string)) {
    throw new AppError(400, 'Формат weekStart: YYYY-MM-DD');
  }

  const days = await getScheduleOverview(studioId as string, weekStart as string);
  res.json({ days });
});

export default router;
