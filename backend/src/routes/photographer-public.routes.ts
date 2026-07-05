/**
 * Photographer Public Routes — Wave 3
 * POST /api/photographer/booking-request  — заявка на съёмку (без auth, rate-limited)
 * GET  /api/photographer/availability/:id — доступность фотографа по дате
 * POST /api/photographer/message          — сообщение фотографу (без auth, rate-limited)
 */

import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import db from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
import { NotificationService } from '../services/notification.service.js';
import { createRateLimitStore } from '../middleware/rate-limit-store.js';

const router = express.Router();

// Строгий лимит для публичных форм (без авторизации)
const publicFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Слишком много запросов. Подождите немного.',
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('phform:'),
});

// ─── POST /api/photographer/booking-request ─────────────────────────────────

router.post('/booking-request', publicFormLimiter, async (req: Request, res: Response): Promise<void> => {
  const { photographerId, name, phone, date, serviceType } = req.body;

  if (!photographerId || !name || !phone) {
    throw new AppError(400, 'Необходимо указать photographerId, name и phone');
  }

  const photographer = await db.queryOne<{ id: string; user_id: string; name: string }>(
    'SELECT id, user_id, name FROM photographers WHERE id = $1',
    [photographerId]
  );

  if (!photographer) {
    throw new AppError(404, 'Фотограф не найден');
  }

  // Создаём booking с status='pending', source='photographer_page'
  const startTime = date ? new Date(date) : new Date();
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // +1ч по умолчанию

  const booking = await db.queryOne<{ id: string }>(
    `INSERT INTO bookings (photographer_id, client_name, client_phone, service_name, start_time, end_time, status, source)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', 'photographer_page')
     RETURNING id`,
    [photographerId, name, phone, serviceType || null, startTime, endTime]
  );

  // Уведомление фотографу
  await NotificationService.create({
    userId: photographer.user_id,
    title: 'Новая заявка на съёмку',
    body: `${name} (${phone})${date ? ` — ${new Date(date).toLocaleDateString('ru-RU')}` : ''}`,
    type: 'booking_update',
    data: { bookingId: booking?.id, clientName: name, clientPhone: phone, date, serviceType },
  });

  res.status(201).json({
    success: true,
    message: 'Заявка принята! Фотограф свяжется с вами в ближайшее время.',
  });
});

// ─── GET /api/photographer/availability/:id ──────────────────────────────────

router.get('/availability/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { date } = req.query as { date?: string };

  const photographer = await db.queryOne<{ id: string; availability: any }>(
    'SELECT id, availability FROM photographers WHERE id = $1',
    [id]
  );

  if (!photographer) {
    throw new AppError(404, 'Фотограф не найден');
  }

  const availability = photographer.availability || {};

  // Если передана дата — проверяем конкретный день
  if (date) {
    const busyDates: string[] = availability.busyDates || [];
    const available = !busyDates.includes(date);
    res.json({
      success: true,
      available,
      reason: available ? undefined : 'Дата уже занята',
    });
    return;
  }

  // Иначе возвращаем полное расписание
  res.json({ success: true, data: availability });
});

// ─── POST /api/photographer/message ─────────────────────────────────────────

router.post('/message', publicFormLimiter, async (req: Request, res: Response): Promise<void> => {
  const { photographerId, name, contact, message } = req.body;

  if (!photographerId || !name || !message) {
    throw new AppError(400, 'Необходимо указать photographerId, name и message');
  }

  const photographer = await db.queryOne<{ id: string; user_id: string }>(
    'SELECT id, user_id FROM photographers WHERE id = $1',
    [photographerId]
  );

  if (!photographer) {
    throw new AppError(404, 'Фотограф не найден');
  }

  await NotificationService.create({
    userId: photographer.user_id,
    title: 'Новое сообщение от посетителя',
    body: `${name}${contact ? ` (${contact})` : ''}: ${message.slice(0, 120)}`,
    type: 'system',
    data: { photographerId, senderName: name, senderContact: contact, message },
  });

  res.json({
    success: true,
    message: 'Сообщение отправлено! Фотограф ответит вам в ближайшее время.',
  });
});

export default router;
