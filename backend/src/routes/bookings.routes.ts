import express, { Response } from 'express';
import db from '../database/db.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { PaginatedResponse } from '../types/index.js';
import { NotificationService } from '../services/notification.service.js';
import { createTaskFromBooking } from '../services/task-auto.service.js';
import { idempotent } from '../middleware/idempotency.js';
import type { MyBookingRow } from '../types/views/booking-views.js';

import { createLogger } from '../utils/logger.js';
const router = express.Router();

const logger = createLogger('bookings.routes');
// All routes require authentication
router.use(authenticateToken);

// ─── Available slots for a photographer on a given date ─────────────────────
router.get('/available-slots', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { photographerId, date } = req.query as { photographerId?: string; date?: string };
  if (!photographerId || !date) {
    throw new AppError(400, 'photographerId and date are required');
  }

  // Get photographer availability config
  const photographer = await db.queryOne<{ availability: any }>(
    'SELECT availability FROM photographers WHERE id = $1',
    [photographerId]
  );

  if (!photographer) throw new AppError(404, 'Photographer not found');

  const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const schedule = photographer.availability || {};
  const daySchedule = schedule[dayOfWeek] || schedule.default;

  // Check busy dates
  const busyDates: string[] = schedule.busyDates || [];
  if (busyDates.includes(date)) {
    res.json({ success: true, data: { date, availableSlots: [] } });
    return;
  }

  // Get existing bookings for this photographer on the date
  const existingBookings = await db.query<{ start_time: string; end_time: string }>(
    `SELECT start_time, end_time FROM bookings
     WHERE photographer_id = $1
       AND start_time::date = $2::date
       AND status NOT IN ('cancelled')
     ORDER BY start_time`,
    [photographerId, date]
  );

  // Generate 1-hour slots from schedule or default 09:00-19:00
  const startHour = daySchedule?.startHour ?? 9;
  const endHour = daySchedule?.endHour ?? 19;
  const slotDuration = 60; // minutes

  const slots: { startTime: string; endTime: string; duration: number }[] = [];
  for (let h = startHour; h < endHour; h++) {
    const slotStart = `${String(h).padStart(2, '0')}:00`;
    const slotEnd = `${String(h + 1).padStart(2, '0')}:00`;
    const slotStartDt = new Date(`${date}T${slotStart}:00`);
    const slotEndDt = new Date(`${date}T${slotEnd}:00`);

    // Check conflicts with existing bookings
    const hasConflict = existingBookings.some(b => {
      const bStart = new Date(b.start_time);
      const bEnd = new Date(b.end_time);
      return slotStartDt < bEnd && slotEndDt > bStart;
    });

    if (!hasConflict) {
      slots.push({ startTime: slotStart, endTime: slotEnd, duration: slotDuration });
    }
  }

  res.json({ success: true, data: { date, availableSlots: slots } });
});

// ─── Check slot availability ────────────────────────────────────────────────
router.get('/check-availability', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { photographerId, date, startTime, endTime } = req.query as Record<string, string>;
  if (!photographerId || !date || !startTime || !endTime) {
    throw new AppError(400, 'photographerId, date, startTime, endTime are required');
  }

  const slotStart = new Date(`${date}T${startTime}`);
  const slotEnd = new Date(`${date}T${endTime}`);

  const conflicts = await db.query(
    `SELECT id, start_time, end_time, status, client_name
     FROM bookings
     WHERE photographer_id = $1
       AND start_time < $3 AND end_time > $2
       AND status NOT IN ('cancelled')`,
    [photographerId, slotStart, slotEnd]
  );

  res.json({
    success: true,
    data: {
      available: conflicts.length === 0,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
    },
  });
});

// ─── Bookings by date (admin/employee) ──────────────────────────────────────
router.get('/by-date', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { date } = req.query as { date?: string };
  if (!date) throw new AppError(400, 'date is required');

  const isAdmin = req.user.role === 'admin' || req.user.role === 'employee';

  let bookings;
  if (isAdmin) {
    bookings = await db.query(
      `SELECT b.*, s.name AS studio_name
       FROM bookings b
       LEFT JOIN studios s ON s.id = b.studio_id
       WHERE b.start_time::date = $1::date
       ORDER BY b.start_time`,
      [date]
    );
  } else if (req.user.role === 'photographer') {
    const photographer = await db.queryOne<{ id: string }>(
      'SELECT id FROM photographers WHERE user_id = $1', [req.user.id]
    );
    bookings = await db.query(
      `SELECT b.*, s.name AS studio_name
       FROM bookings b
       LEFT JOIN studios s ON s.id = b.studio_id
       WHERE b.photographer_id = $1 AND b.start_time::date = $2::date
       ORDER BY b.start_time`,
      [photographer?.id, date]
    );
  } else {
    bookings = await db.query(
      `SELECT b.*, s.name AS studio_name
       FROM bookings b
       LEFT JOIN studios s ON s.id = b.studio_id
       WHERE b.client_id = $1 AND b.start_time::date = $2::date
       ORDER BY b.start_time`,
      [req.user.id, date]
    );
  }

  res.json({ success: true, data: bookings });
});

// ─── Upcoming bookings ──────────────────────────────────────────────────────
router.get('/upcoming', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const limit = Math.min(parseInt(req.query['limit'] as string) || 10, 50);
  const isAdmin = req.user.role === 'admin' || req.user.role === 'employee';

  let whereClause: string;
  const params: any[] = [new Date()];

  if (isAdmin) {
    whereClause = 'b.start_time >= $1 AND b.status NOT IN (\'cancelled\', \'completed\')';
  } else if (req.user.role === 'photographer') {
    const photographer = await db.queryOne<{ id: string }>(
      'SELECT id FROM photographers WHERE user_id = $1', [req.user.id]
    );
    whereClause = 'b.photographer_id = $2 AND b.start_time >= $1 AND b.status NOT IN (\'cancelled\', \'completed\')';
    params.push(photographer?.id);
  } else {
    whereClause = 'b.client_id = $2 AND b.start_time >= $1 AND b.status NOT IN (\'cancelled\', \'completed\')';
    params.push(req.user.id);
  }

  params.push(limit);
  const bookings = await db.query(
    `SELECT b.*, s.name AS studio_name
     FROM bookings b
     LEFT JOIN studios s ON s.id = b.studio_id
     WHERE ${whereClause}
     ORDER BY b.start_time ASC
     LIMIT $${params.length}`,
    params
  );

  res.json({ success: true, data: bookings });
});

// ─── Booking stats (admin/employee) ─────────────────────────────────────────
router.get('/stats', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const isAdmin = req.user.role === 'admin' || req.user.role === 'employee';
  if (!isAdmin) throw new AppError(403, 'Only admin/employee can view stats');

  const [totals, byStatus, trends] = await Promise.all([
    db.queryOne<{ total: string; revenue: string; period_revenue: string }>(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM((price->>'totalPrice')::numeric), 0) AS revenue,
         COALESCE(SUM((price->>'totalPrice')::numeric) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0) AS period_revenue
       FROM bookings WHERE status != 'cancelled'`
    ),
    db.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) AS count FROM bookings GROUP BY status`
    ),
    db.query<{ date: string; count: string; revenue: string }>(
      `SELECT
         start_time::date AS date,
         COUNT(*) AS count,
         COALESCE(SUM((price->>'totalPrice')::numeric), 0) AS revenue
       FROM bookings
       WHERE start_time >= NOW() - INTERVAL '30 days' AND status != 'cancelled'
       GROUP BY start_time::date
       ORDER BY date`
    ),
  ]);

  const byStatusMap: Record<string, number> = {};
  for (const row of byStatus) {
    byStatusMap[row.status] = parseInt(row.count, 10);
  }

  res.json({
    success: true,
    data: {
      total: parseInt(totals?.total || '0', 10),
      byStatus: byStatusMap,
      revenue: {
        total: parseFloat(totals?.revenue || '0'),
        period: parseFloat(totals?.period_revenue || '0'),
      },
      trends: trends.map(t => ({
        date: t.date,
        count: parseInt(t.count, 10),
        revenue: parseFloat(t.revenue),
      })),
    },
  });
});

// ─── Search bookings (admin/employee) ───────────────────────────────────────
router.get('/search', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const isAdmin = req.user.role === 'admin' || req.user.role === 'employee';
  if (!isAdmin) throw new AppError(403, 'Only admin/employee can search bookings');

  const { q, status, from, to, page = '1', limit = '10' } = req.query as Record<string, string>;
  const pageNum = parseInt(page as string, 10);
  const limitNum = Math.min(parseInt(limit as string, 10) || 10, 100);
  const offset = (pageNum - 1) * limitNum;

  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (q) {
    conditions.push(`(b.client_name ILIKE $${idx} OR b.client_phone ILIKE $${idx} OR b.service_name ILIKE $${idx})`);
    params.push(`%${q}%`);
    idx++;
  }
  if (status) {
    conditions.push(`b.status = $${idx++}`);
    params.push(status);
  }
  if (from) {
    conditions.push(`b.start_time >= $${idx++}`);
    params.push(new Date(from));
  }
  if (to) {
    conditions.push(`b.start_time <= $${idx++}`);
    params.push(new Date(to));
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await db.queryOne<{ total: string }>(
    `SELECT COUNT(*) AS total FROM bookings b ${whereClause}`, params
  );
  const total = parseInt(countResult?.total || '0', 10);

  params.push(limitNum, offset);
  const bookings = await db.query(
    `SELECT b.*, s.name AS studio_name
     FROM bookings b
     LEFT JOIN studios s ON s.id = b.studio_id
     ${whereClause}
     ORDER BY b.start_time DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    params
  );

  res.json({
    success: true,
    data: bookings,
    pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
  });
});

// My bookings — ищет по client_id ИЛИ по телефону пользователя (для гостевых записей)
router.get('/my', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const userPhone = req.user.phone as string | undefined;
  const phoneDigits = userPhone ? userPhone.replace(/\D/g, '').slice(-10) : null;

  const bookings = await db.query<MyBookingRow>(
    `SELECT b.id, b.client_id, s.name AS studio_name, s.address AS studio_address,
            b.client_name, b.client_phone, b.service_name, b.service_category_slug,
            b.start_time, b.end_time, b.status, b.source, b.notes, b.created_at
     FROM bookings b
     LEFT JOIN studios s ON s.id = b.studio_id
     WHERE (b.client_id = $1
       ${phoneDigits ? `OR right(regexp_replace(b.client_phone, '\\D', '', 'g'), 10) = $2` : ''})
     ORDER BY b.start_time DESC
     LIMIT 50`,
    phoneDigits ? [req.user.id, phoneDigits] : [req.user.id],
  );

  // Привязываем гостевые записи к пользователю (backfill client_id)
  if (phoneDigits && bookings.length > 0) {
    const orphanIds = bookings
      .filter(b => !b.client_id)
      .map(b => b.id);
    if (orphanIds.length > 0) {
      db.query(
        `UPDATE bookings SET client_id = $1 WHERE id = ANY($2) AND client_id IS NULL`,
        [req.user.id, orphanIds],
      ).catch(() => { /* non-critical backfill */ });
    }
  }

  res.json({ success: true, data: bookings });
});

// List bookings (legacy)
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const { clientId, photographerId, status, page = 1, limit = 10 } = req.query;

  // Authorization: users can only see their own bookings unless admin
  if (req.user.role !== 'admin') {
    if (clientId && clientId !== req.user.id) {
      throw new AppError(403, 'You can only view your own bookings');
    }
    if (photographerId && photographerId !== req.user.id) {
      throw new AppError(403, 'You can only view your own bookings');
    }
    if (!clientId && !photographerId) {
      // If no filter, default to user's own bookings
      if (req.user.role === 'client') {
        // Will filter by clientId below
      } else if (req.user.role === 'photographer') {
        // Will filter by photographerId below
      }
    }
  }

  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);
  const offset = (pageNum - 1) * limitNum;

  let whereConditions: string[] = [];
  const queryParams: any[] = [];
  let paramIndex = 1;

  if (clientId) {
    whereConditions.push(`client_id = $${paramIndex++}`);
    queryParams.push(clientId);
  } else if (req.user.role === 'client') {
    whereConditions.push(`client_id = $${paramIndex++}`);
    queryParams.push(req.user.id);
  }

  if (photographerId) {
    whereConditions.push(`photographer_id = $${paramIndex++}`);
    queryParams.push(photographerId);
  } else if (req.user.role === 'photographer') {
    // Get photographer_id from user_id
    const photographer = await db.queryOne<{ id: string }>(
      'SELECT id FROM photographers WHERE user_id = $1',
      [req.user.id]
    );
    if (photographer) {
      whereConditions.push(`photographer_id = $${paramIndex++}`);
      queryParams.push(photographer.id);
    }
  }

  if (status) {
    whereConditions.push(`status = $${paramIndex++}`);
    queryParams.push(status);
  }

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  // Get total count
  const countResult = await db.queryOne<{ total: string }>(
    `SELECT COUNT(*) as total FROM bookings ${whereClause}`,
    queryParams
  );
  const total = parseInt(countResult?.total || '0', 10);
  const totalPages = Math.ceil(total / limitNum);

  // Get bookings
  const bookings = await db.query(
    `SELECT id, client_id, photographer_id, studio_id, service_id, start_time, end_time, status, client_name, client_phone, client_email, notes, price, created_at FROM bookings ${whereClause} ORDER BY start_time DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...queryParams, limitNum, offset]
  );

  const response: PaginatedResponse<any> = {
    success: true,
    data: bookings,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
    },
  };

  res.json(response);
});

// Get booking details
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const { id } = req.params;

  const booking = await db.queryOne('SELECT id, client_id, photographer_id, studio_id, service_id, start_time, end_time, status, client_name, client_phone, client_email, notes, price, created_at FROM bookings WHERE id = $1', [id]);

  if (!booking) {
    throw new AppError(404, 'Booking not found');
  }

  // Authorization: user must be client, photographer, or admin
  const isOwner = booking.client_id === req.user.id || booking.photographer_id === req.user.id;
  const isAdmin = req.user.role === 'admin';

  if (!isOwner && !isAdmin) {
    throw new AppError(403, 'Forbidden');
  }

  res.json({ success: true, data: booking });
});

// Create booking
router.post('/', idempotent(60), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const {
    photographerId,
    serviceId,
    serviceType,
    startTime,
    endTime,
    price,
    totalPrice,
    location,
    travelCost,
    locationAdditionalCost,
    notes,
    clientInfo,
    persons,
    comments,
  } = req.body;

  if (!serviceId || !startTime || !endTime) {
    throw new AppError(400, 'Missing required fields: serviceId, startTime, endTime');
  }

  // Для выездных услуг location обязателен
  if (serviceType === 'onLocation' && !location) {
    throw new AppError(400, 'Location is required for on-location services');
  }

  // Если photographerId указан, проверяем конфликты
  if (photographerId) {
    const conflicts = await db.query(
      `SELECT id FROM bookings
       WHERE photographer_id = $1
       AND (
         (start_time <= $2 AND end_time > $2)
         OR (start_time < $3 AND end_time >= $3)
         OR (start_time >= $2 AND end_time <= $3)
       )
       AND status != 'cancelled'`,
      [photographerId, new Date(startTime), new Date(endTime)]
    );

    if (conflicts.length > 0) {
      throw new AppError(400, 'Time slot is not available for this photographer');
    }
  }

  // Формируем объект price с учетом всех компонентов стоимости
  const priceData: any = {
    totalPrice: totalPrice || (price?.totalPrice || 0),
    currency: 'RUB',
    basePrice: price?.basePrice || 0,
  };

  // Добавляем стоимость выезда для выездных услуг
  if (serviceType === 'onLocation' && travelCost) {
    priceData.travelCost = travelCost;
  }

  // Добавляем доплату за локацию
  if (locationAdditionalCost) {
    priceData.locationAdditionalCost = locationAdditionalCost;
  }

  // Формируем metadata для хранения дополнительной информации
  const metadata: any = {
    serviceType: serviceType || 'studio',
    persons: persons || 1,
  };

  // Добавляем данные о локации для выездных услуг
  if (serviceType === 'onLocation' && location) {
    metadata.location = {
      address: location.address,
      city: location.city || 'Ростов-на-Дону',
      coordinates: location.coordinates || null,
    };
  }

  // Добавляем информацию о клиенте
  if (clientInfo) {
    metadata.clientInfo = clientInfo;
  }

  // Добавляем комментарии
  if (comments) {
    metadata.comments = comments;
  }

  // Вставляем booking
  // photographer_id может быть NULL для автоматического назначения
  const booking = await db.queryOne(
    `INSERT INTO bookings (client_id, photographer_id, service_id, start_time, end_time, price, notes, status)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     RETURNING *`,
    [
      req.user.id,
      photographerId || null,
      serviceId,
      new Date(startTime),
      new Date(endTime),
      JSON.stringify(priceData),
      notes || JSON.stringify(metadata),
      'pending',
    ]
  );

  // Автосоздание задачи — для бронирований "на завтра" или раньше
  if (booking) {
    const bookingDate = new Date(startTime);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 59);

    if (bookingDate <= tomorrow) {
      const clientName = clientInfo?.name || 'Клиент';
      createTaskFromBooking({
        bookingId: booking.id,
        clientId: req.user.id,
        clientName,
        title: `Подготовка к фотосессии — ${clientName}`,
        description: `Бронирование на ${bookingDate.toLocaleDateString('ru-RU')}. ${comments || ''}`.trim(),
        dueDate: bookingDate,
        createdBy: req.user.id,
      }).catch(err => logger.error('[Bookings] Auto-task creation error', { error: String(err) }));
    }
  }

  res.status(201).json({ success: true, data: booking });
});

// Update booking status
router.put('/:id/status', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ['confirmed', 'cancelled', 'completed'];
  if (!status || !validStatuses.includes(status)) {
    throw new AppError(400, 'Invalid status');
  }

  const booking = await db.queryOne('SELECT id, client_id, photographer_id, status, start_time FROM bookings WHERE id = $1', [id]);

  if (!booking) {
    throw new AppError(404, 'Booking not found');
  }

  // Authorization logic
  const isClient = booking.client_id === req.user.id;
  const isPhotographer = booking.photographer_id === req.user.id;
  const isAdmin = req.user.role === 'admin';

  let isAuthorized = false;
  if (status === 'confirmed' || status === 'completed') {
    isAuthorized = isPhotographer || isAdmin;
  } else if (status === 'cancelled') {
    isAuthorized = isClient || isPhotographer || isAdmin;
  }

  if (!isAuthorized) {
    throw new AppError(403, 'You do not have permission to change this status');
  }

  const updated = await db.queryOne(
    'UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [status, id]
  );

  // Notify client about booking status change
  if (updated?.client_id) {
    const statusNames: Record<string, string> = {
      confirmed: 'Подтверждена',
      cancelled: 'Отменена',
      completed: 'Завершена',
    };
    NotificationService.create({
      userId: updated.client_id,
      title: 'Статус записи обновлён',
      body: `Ваша запись — ${statusNames[status] || status}`,
      type: 'booking_update',
      data: { bookingId: updated.id, status },
    }).catch(err => logger.error('[Bookings] Notification error', { error: String(err) }));
  }

  res.json({ success: true, data: updated });
});

export default router;
