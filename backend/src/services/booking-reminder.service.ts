import db from '../database/db.js';
import { sendBookingReminder, type BookingNotifyData } from './booking-notify.service.js';

import { createLogger } from '../utils/logger.js';
const INTERVAL_MS = 5 * 60 * 1000; // 5 минут
let intervalHandle: ReturnType<typeof setInterval> | null = null;

const logger = createLogger('booking-reminder.service');
interface ReminderBooking extends BookingNotifyData {
  studio_name: string;
}

/**
 * Обработать напоминания для записей
 */
async function processBookingReminders(): Promise<void> {
  try {
    // 1. Напоминания за 24 часа
    const reminders24h = await db.query<ReminderBooking>(
      `SELECT b.id, b.client_name, b.client_phone, b.client_email,
              b.start_time, b.end_time, b.service_name, b.studio_id,
              s.name as studio_name
       FROM bookings b
       LEFT JOIN studios s ON s.id = b.studio_id
       WHERE b.status = 'confirmed'
         AND b.reminder_24h_sent_at IS NULL
         AND b.start_time BETWEEN NOW() + INTERVAL '23 hours' AND NOW() + INTERVAL '25 hours'`,
    );

    for (const booking of reminders24h) {
      try {
        await sendBookingReminder(booking, '24h', booking.studio_name || 'Студия');
      } catch (err) {
        logger.error(`[BookingReminder] 24h failed for ${booking.id}:`, { error: String(err) });
      }
    }

    // 2. Напоминания за 1 час
    const reminders1h = await db.query<ReminderBooking>(
      `SELECT b.id, b.client_name, b.client_phone, b.client_email,
              b.start_time, b.end_time, b.service_name, b.studio_id,
              s.name as studio_name
       FROM bookings b
       LEFT JOIN studios s ON s.id = b.studio_id
       WHERE b.status = 'confirmed'
         AND b.reminder_1h_sent_at IS NULL
         AND b.start_time BETWEEN NOW() + INTERVAL '50 minutes' AND NOW() + INTERVAL '70 minutes'`,
    );

    for (const booking of reminders1h) {
      try {
        await sendBookingReminder(booking, '1h', booking.studio_name || 'Студия');
      } catch (err) {
        logger.error(`[BookingReminder] 1h failed for ${booking.id}:`, { error: String(err) });
      }
    }

    if (reminders24h.length > 0 || reminders1h.length > 0) {
      logger.info(`[BookingReminder] Processed: ${reminders24h.length} x 24h, ${reminders1h.length} x 1h`);
    }
  } catch (err) {
    logger.error('[BookingReminder] Processing error:', { error: String(err) });
  }
}

/**
 * Запуск cron-планировщика напоминаний
 */
export function startBookingReminderScheduler(): void {
  if (intervalHandle) {
    logger.warn('[BookingReminder] Scheduler already running');
    return;
  }

  logger.info(`[BookingReminder] Scheduler started (interval: ${INTERVAL_MS / 1000}s)`);

  // Первый запуск через 30 секунд после старта сервера
  setTimeout(() => {
    processBookingReminders();
  }, 30_000);

  intervalHandle = setInterval(processBookingReminders, INTERVAL_MS);
}

/**
 * Остановка планировщика
 */
export function stopBookingReminderScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('[BookingReminder] Scheduler stopped');
  }
}
