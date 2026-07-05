import db from '../database/db.js';
import { createTaskFromBooking } from './task-auto.service.js';
import { createLogger } from '../utils/logger.js';
import {
  notifyBookingCreated,
  notifyBookingCancelled,
  notifyBookingRescheduled,
  type BookingNotifyData,
} from './booking-notify.service.js';
import type {
  BookingConflictLookup,
  BookingCountLookup,
  BookingInsertResult,
  BookingOccupiedSlotLookup,
  BookingShiftLookup,
  BookingStudioNameLookup,
  BookingStatusLookup,
  BookingUserIdLookup,
  BookingWorkingHoursLookup,
  ClientSearchLookup,
  ScheduleExceptionLookup,
  StudioStatusLookup,
} from '../types/views/booking-views.js';

const logger = createLogger('booking-autonomous.service');

function hasPgErrorCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === code;
}

function getUserLookupPhoneDigits(phone: string): string | null {
  const digits = phone.replace(/\D/g, '').slice(-10);
  return digits.length === 10 ? digits : null;
}

/**
 * Читает статус студии на конкретную дату записи.
 * status_until означает последний закрытый день включительно; даты после него доступны.
 */
async function selectStudioEffectiveStatus(
  studioId: string,
  bookingDate: string,
): Promise<StudioStatusLookup | null> {
  return db.queryOne<StudioStatusLookup>(
    `SELECT name,
       CASE WHEN status_until IS NOT NULL AND status_until < $2::date
            THEN 'open' ELSE status END AS status,
       CASE WHEN status_until IS NOT NULL AND status_until < $2::date
            THEN NULL ELSE status_message END AS status_message
     FROM studios WHERE id = $1`,
    [studioId, bookingDate],
  );
}

// ===== Types =====

export interface BookingSlot {
  time: string;     // "09:00"
  endTime: string;  // "09:30"
  available: boolean;
}

export interface SlotsResponse {
  date: string;
  studioId: string;
  studioName?: string;
  slots: BookingSlot[];
  closedReason?: string;
}

export interface CreateBookingInput {
  studioId: string;
  date: string;        // YYYY-MM-DD
  time: string;        // HH:MM
  duration?: number;   // минуты, default 30
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  serviceName?: string;
  serviceCategorySlug?: string; // slug из service_categories (напр. 'marketplace-photo')
  source: 'crm' | 'website' | 'telegram' | 'phone' | 'walk_in';
  notes?: string;
  createdBy?: string;  // user_id оператора
  partnerPromoCode?: string;
}

export interface BookingRecord {
  id: string;
  studio_id: string;
  studio_name?: string;
  client_name: string;
  client_phone: string;
  client_email?: string | null;
  service_name: string | null;
  start_time: string;
  end_time: string;
  status: string;
  source: string;
  notes: string | null;
  created_at: string;
}

export interface BookingFilters {
  studioId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  clientPhone?: string;
  limit?: number;
  offset?: number;
}

export interface ScheduleDayOverview {
  date: string;
  hasShift: boolean;
  shiftEmployeeName?: string;
  shiftStart?: string;
  shiftEnd?: string;
  totalSlots: number;
  bookedSlots: number;
  bookings: BookingRecord[];
}

// ===== Service =====

// Маркетплейс-услуги доступны только вечером 18:00–19:30
const MARKETPLACE_CATEGORIES = new Set(['marketplace-photo', 'infographics', 'smm-content', 'selling-pack']);
const MARKETPLACE_START_MIN = 18 * 60;       // 1080
const MARKETPLACE_END_MIN   = 19 * 60 + 30;  // 1170

/**
 * Проверка исключений расписания (закрытия, праздники, сокращённые дни).
 */
async function getScheduleException(
  studioId: string,
  date: string,
): Promise<ScheduleExceptionLookup | null> {
  return db.queryOne<ScheduleExceptionLookup>(
    `SELECT is_closed, open_time::text, close_time::text, reason
     FROM studio_schedule_exceptions
     WHERE studio_id = $1 AND exception_date = $2`,
    [studioId, date],
  );
}

/**
 * Доступные слоты на основе employee_shifts и существующих записей.
 * @param serviceCategorySlug — если маркетплейс-категория, слоты ограничиваются 18:00–19:30
 */
export async function getAvailableSlots(
  studioId: string,
  date: string,
  serviceCategorySlug?: string,
): Promise<SlotsResponse> {
  const SLOT_DURATION = 30; // минуты

  // Check studio status for the requested date, not for the current calendar day.
  const studioInfo = await selectStudioEffectiveStatus(studioId, date);
  if (studioInfo?.status === 'closed' || studioInfo?.status === 'maintenance') {
    return { date, studioId, studioName: studioInfo.name, slots: [], closedReason: studioInfo.status_message || undefined };
  }

  // Check schedule exceptions (closures, holidays)
  const exception = await getScheduleException(studioId, date);
  if (exception?.is_closed) {
    return { date, studioId, studioName: studioInfo?.name, slots: [], closedReason: exception.reason || undefined };
  }

  // 1. Проверяем: есть ли смена на эту дату для этой студии
  const shifts = await db.query<BookingShiftLookup>(
    `SELECT es.start_time::text, es.end_time::text, u.display_name as employee_name
     FROM employee_shifts es
     LEFT JOIN users u ON u.id = es.employee_id
     WHERE es.studio_id = $1 AND es.shift_date = $2 AND es.status != 'cancelled'
     ORDER BY es.start_time
     LIMIT 1`,
    [studioId, date],
  );

  // Получаем название студии
  const studio = await db.queryOne<BookingStudioNameLookup>(
    `SELECT name FROM studios WHERE id = $1`,
    [studioId],
  );

  // Fallback: если нет смены — используем рабочие часы студии
  let shiftStartTime: string;
  let shiftEndTime: string;

  if (shifts.length === 0) {
    // Ищем рабочие часы студии для данного дня недели (0=Пн, ..., 6=Вс)
    const dateObj = new Date(date + 'T00:00:00');
    // JS getDay(): 0=Вс, 1=Пн, ..., 6=Сб → наш формат: 0=Пн, ..., 6=Вс
    const jsDayOfWeek = dateObj.getUTCDay(); // 0=Вс
    const dayOfWeek = jsDayOfWeek === 0 ? 6 : jsDayOfWeek - 1; // 0=Пн, ..., 6=Вс

    const workingHours = await db.queryOne<BookingWorkingHoursLookup>(
      `SELECT start_time::text, end_time::text, is_open
       FROM studio_working_hours
       WHERE studio_id = $1 AND day_of_week = $2`,
      [studioId, dayOfWeek],
    );

    if (!workingHours || !workingHours.is_open) {
      return { date, studioId, studioName: studio?.name, slots: [] };
    }

    shiftStartTime = workingHours.start_time;
    shiftEndTime = workingHours.end_time;
  } else {
    shiftStartTime = shifts[0].start_time;
    shiftEndTime = shifts[0].end_time;
  }

  // 2. Генерируем слоты в пределах смены/рабочих часов
  const [startH, startM] = shiftStartTime.split(':').map(Number);
  const [endH, endM] = shiftEndTime.split(':').map(Number);
  let shiftStartMin = startH * 60 + startM;
  let shiftEndMin = endH * 60 + endM;

  // Маркетплейс-услуги: ограничиваем слоты диапазоном 18:00–19:30
  if (serviceCategorySlug && MARKETPLACE_CATEGORIES.has(serviceCategorySlug)) {
    shiftStartMin = Math.max(shiftStartMin, MARKETPLACE_START_MIN);
    shiftEndMin = Math.min(shiftEndMin, MARKETPLACE_END_MIN);
    if (shiftStartMin >= shiftEndMin) {
      return { date, studioId, studioName: studio?.name, slots: [] };
    }
  }

  const allSlots: BookingSlot[] = [];
  for (let min = shiftStartMin; min + SLOT_DURATION <= shiftEndMin; min += SLOT_DURATION) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    const endMin = min + SLOT_DURATION;
    const eh = Math.floor(endMin / 60);
    const em = endMin % 60;

    allSlots.push({
      time: `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`,
      endTime: `${eh.toString().padStart(2, '0')}:${em.toString().padStart(2, '0')}`,
      available: true,
    });
  }

  // 3. Проверяем занятые слоты
  const occupied = await db.query<BookingOccupiedSlotLookup>(
    `SELECT start_time::text, end_time::text
     FROM bookings
     WHERE studio_id = $1 AND start_time::date = $2 AND status NOT IN ('cancelled')`,
    [studioId, date],
  );

  // Помечаем пересекающиеся слоты
  for (const booking of occupied) {
    const bookStart = new Date(booking.start_time);
    const bookEnd = new Date(booking.end_time);

    for (const slot of allSlots) {
      const slotStart = new Date(`${date}T${slot.time}:00`);
      const slotEnd = new Date(`${date}T${slot.endTime}:00`);

      if (slotStart < bookEnd && slotEnd > bookStart) {
        slot.available = false;
      }
    }
  }

  return { date, studioId, studioName: studio?.name, slots: allSlots };
}

/**
 * Создать запись с атомарной проверкой конфликтов.
 * Защита от race condition: EXCLUDE constraint bookings_no_overlap на уровне БД.
 */
export async function createBooking(data: CreateBookingInput): Promise<{
  success: boolean;
  bookingId?: string;
  error?: string;
}> {
  const duration = data.duration || 30;
  const startDate = new Date(`${data.date}T${data.time}:00+03:00`); // Europe/Moscow
  const startTime = startDate.toISOString();
  const endDate = new Date(startDate.getTime() + duration * 60 * 1000);
  const endTime = endDate.toISOString();

  // Check studio status for the booking date, not for the current calendar day.
  const studioStatus = await selectStudioEffectiveStatus(data.studioId, data.date);
  if (studioStatus?.status === 'closed' || studioStatus?.status === 'maintenance') {
    return { success: false, error: studioStatus.status_message || 'Этот адрес на перерыве. Попробуйте другой адрес или другую дату!' };
  }

  // Check schedule exceptions (closures for specific dates)
  const closureException = await getScheduleException(data.studioId, data.date);
  if (closureException?.is_closed) {
    return { success: false, error: closureException.reason || 'В этот день перерыв. Выберите другой день!' };
  }

  // Привязка к пользователю по телефону (если есть аккаунт)
  const phoneDigits = getUserLookupPhoneDigits(data.clientPhone);
  const existingUser = phoneDigits
    ? await db.queryOne<BookingUserIdLookup>(
        `SELECT id FROM users WHERE phone LIKE '%' || $1 AND is_active = true LIMIT 1`,
        [phoneDigits],
      )
    : null;

  // Атомарный INSERT с EXCLUDE constraint (bookings_no_overlap)
  // При конфликте PostgreSQL бросит exclusion_violation (23P01)
  let result: BookingInsertResult | null;
  try {
    result = await db.queryOne<BookingInsertResult>(
      `INSERT INTO bookings (studio_id, client_id, client_name, client_phone, client_email,
         service_name, service_category_slug, start_time, end_time, status, source, notes, partner_promo_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'confirmed', $10, $11, $12)
       RETURNING id`,
      [data.studioId, existingUser?.id ?? null, data.clientName, data.clientPhone,
       data.clientEmail || null, data.serviceName || null, data.serviceCategorySlug || null,
       startTime, endTime, data.source, data.notes || null, data.partnerPromoCode || null],
    );
  } catch (err: unknown) {
    // exclusion_violation = 23P01 (EXCLUDE constraint сработал)
    if (hasPgErrorCode(err, '23P01')) {
      return { success: false, error: 'Слот занят' };
    }
    throw err;
  }

  if (!result) {
    return { success: false, error: 'Ошибка создания записи' };
  }

  // Получаем название студии для уведомлений
  const studio = await db.queryOne<BookingStudioNameLookup>(
    `SELECT name FROM studios WHERE id = $1`,
    [data.studioId],
  );

  // Уведомление клиенту (non-blocking)
  notifyBookingCreated({
    id: result.id,
    client_name: data.clientName,
    client_phone: data.clientPhone,
    client_email: data.clientEmail,
    start_time: startTime,
    end_time: endTime,
    service_name: data.serviceName,
    studio_id: data.studioId,
  }, studio?.name || 'Студия').catch(err => logger.warn('[BookingAutonomous] Notify failed', { error: String(err) }));

  // Автосоздание задачи если запись в ближайшие 24 часа
  const bookingStart = new Date(startTime);
  const now = new Date();
  const hoursUntilBooking = (bookingStart.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hoursUntilBooking <= 24 && hoursUntilBooking > 0) {
    try {
      await createTaskFromBooking({
        bookingId: result.id,
        clientName: data.clientName,
        clientPhone: data.clientPhone,
        title: `Запись: ${data.serviceName || 'Фотоуслуги'} — ${data.clientName}`,
        description: `${data.date} ${data.time}, ${data.clientPhone}`,
        studioId: data.studioId,
        dueDate: bookingStart,
        createdBy: data.createdBy,
      });
    } catch (err) {
      logger.warn('[BookingAutonomous] Task creation failed (non-critical):', { error: String(err) });
    }
  }

  return { success: true, bookingId: result.id };
}

/**
 * Получить список записей с фильтрами
 */
export async function getBookings(filters: BookingFilters): Promise<{
  bookings: BookingRecord[];
  total: number;
}> {
  const conditions: string[] = ['1=1'];
  const params: (string | number)[] = [];
  let paramIdx = 1;

  if (filters.studioId) {
    conditions.push(`b.studio_id = $${paramIdx++}`);
    params.push(filters.studioId);
  }
  if (filters.dateFrom) {
    conditions.push(`b.start_time::date >= $${paramIdx++}`);
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push(`b.start_time::date <= $${paramIdx++}`);
    params.push(filters.dateTo);
  }
  if (filters.status) {
    conditions.push(`b.status = $${paramIdx++}`);
    params.push(filters.status);
  }
  if (filters.clientPhone) {
    conditions.push(`b.client_phone LIKE $${paramIdx++}`);
    params.push(`%${filters.clientPhone}%`);
  }

  const where = conditions.join(' AND ');

  const countResult = await db.queryOne<BookingCountLookup>(
    `SELECT COUNT(*) FROM bookings b WHERE ${where}`,
    params,
  );
  const total = parseInt(countResult?.count || '0', 10);

  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const bookings = await db.query<BookingRecord>(
    `SELECT b.id, b.studio_id, s.name as studio_name, b.client_name, b.client_phone, b.client_email,
            b.service_name, b.start_time, b.end_time, b.status, b.source, b.notes, b.created_at
     FROM bookings b
     LEFT JOIN studios s ON s.id = b.studio_id
     WHERE ${where}
     ORDER BY b.start_time ASC
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset],
  );

  return { bookings, total };
}

/**
 * Получить одну запись по ID
 */
export async function getBookingById(bookingId: string): Promise<BookingRecord | null> {
  return db.queryOne<BookingRecord>(
    `SELECT b.id, b.studio_id, s.name as studio_name, b.client_name, b.client_phone, b.client_email,
            b.service_name, b.start_time, b.end_time, b.status, b.source, b.notes, b.created_at
     FROM bookings b
     LEFT JOIN studios s ON s.id = b.studio_id
     WHERE b.id = $1`,
    [bookingId],
  );
}

/**
 * Обновить статус записи
 */
export async function updateBookingStatus(
  bookingId: string,
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no-show',
  changedBy?: string,
): Promise<BookingRecord | null> {
  // Capture old status for history
  const prev = await db.queryOne<BookingStatusLookup>(
    `SELECT status FROM bookings WHERE id = $1`,
    [bookingId],
  );
  const oldStatus = prev?.status ?? null;

  const result = await db.queryOne<BookingRecord>(
    `UPDATE bookings SET status = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING id, studio_id, client_name, client_phone, client_email, service_name, start_time, end_time, status, source, notes, created_at`,
    [bookingId, status],
  );

  // Record status change in history
  if (result) {
    await db.query(
      `INSERT INTO booking_status_history (booking_id, old_status, new_status, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [bookingId, oldStatus, status, changedBy ?? null],
    );
  }

  // При отмене — отменяем связанную задачу + уведомляем клиента
  if (status === 'cancelled' && result) {
    try {
      await db.query(
        `UPDATE work_tasks SET status = 'cancelled', updated_at = NOW()
         WHERE booking_id = $1 AND status NOT IN ('completed', 'cancelled')`,
        [bookingId],
      );
    } catch (err) {
      logger.warn('[BookingAutonomous] Task cancellation failed:', { error: String(err) });
    }

    // Получаем email и studio_name для уведомления
    const full = await db.queryOne<BookingNotifyData & { studio_name: string }>(
      `SELECT b.id, b.client_name, b.client_phone, b.client_email, b.start_time, b.end_time,
              b.service_name, b.studio_id, s.name as studio_name
       FROM bookings b LEFT JOIN studios s ON s.id = b.studio_id
       WHERE b.id = $1`,
      [bookingId],
    );
    if (full) {
      notifyBookingCancelled(full, full.studio_name || 'Студия').catch(err => logger.warn('[BookingAutonomous] Cancel notify failed', { error: String(err) }));
    }
  }

  return result;
}

/**
 * Обзор расписания на неделю
 */
export async function getScheduleOverview(
  studioId: string,
  weekStart: string,
): Promise<ScheduleDayOverview[]> {
  const SLOT_DURATION = 30;
  const days: ScheduleDayOverview[] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];

    // Смена
    const shift = await db.queryOne<BookingShiftLookup>(
      `SELECT es.start_time::text, es.end_time::text, u.display_name as employee_name
       FROM employee_shifts es
       LEFT JOIN users u ON u.id = es.employee_id
       WHERE es.studio_id = $1 AND es.shift_date = $2 AND es.status != 'cancelled'
       LIMIT 1`,
      [studioId, dateStr],
    );

    let scheduleStartTime: string | undefined;
    let scheduleEndTime: string | undefined;
    let scheduleEmployeeName: string | undefined;

    const studioStatus = await selectStudioEffectiveStatus(studioId, dateStr);
    const closureException = await getScheduleException(studioId, dateStr);
    const isClosed = studioStatus?.status === 'closed' || studioStatus?.status === 'maintenance' || closureException?.is_closed;

    if (!isClosed && shift) {
      scheduleStartTime = shift.start_time;
      scheduleEndTime = shift.end_time;
      scheduleEmployeeName = shift.employee_name ?? undefined;
    } else if (!isClosed) {
      const dateObj = new Date(`${dateStr}T00:00:00`);
      const jsDayOfWeek = dateObj.getUTCDay();
      const dayOfWeek = jsDayOfWeek === 0 ? 6 : jsDayOfWeek - 1;
      const workingHours = await db.queryOne<BookingWorkingHoursLookup>(
        `SELECT start_time::text, end_time::text, is_open
         FROM studio_working_hours
         WHERE studio_id = $1 AND day_of_week = $2`,
        [studioId, dayOfWeek],
      );

      if (workingHours?.is_open) {
        scheduleStartTime = workingHours.start_time;
        scheduleEndTime = workingHours.end_time;
        scheduleEmployeeName = 'По часам студии';
      }
    }

    // Подсчёт слотов
    let totalSlots = 0;
    if (scheduleStartTime && scheduleEndTime) {
      const [startH, startM] = scheduleStartTime.split(':').map(Number);
      const [endH, endM] = scheduleEndTime.split(':').map(Number);
      const shiftMinutes = (endH * 60 + endM) - (startH * 60 + startM);
      totalSlots = Math.floor(shiftMinutes / SLOT_DURATION);
    }

    // Записи
    const bookings = await db.query<BookingRecord>(
      `SELECT b.id, b.studio_id, s.name as studio_name, b.client_name, b.client_phone,
              b.service_name, b.start_time, b.end_time, b.status, b.source, b.notes, b.created_at
       FROM bookings b
       LEFT JOIN studios s ON s.id = b.studio_id
       WHERE b.studio_id = $1 AND b.start_time::date = $2 AND b.status NOT IN ('cancelled')
       ORDER BY b.start_time`,
      [studioId, dateStr],
    );

    days.push({
      date: dateStr,
      hasShift: Boolean(scheduleStartTime && scheduleEndTime),
      shiftEmployeeName: scheduleEmployeeName,
      shiftStart: scheduleStartTime,
      shiftEnd: scheduleEndTime,
      totalSlots,
      bookedSlots: bookings.length,
      bookings,
    });
  }

  return days;
}

/**
 * Перенести запись на другое время/дату
 */
export async function rescheduleBooking(
  bookingId: string,
  newDate: string,
  newTime: string,
  newStudioId?: string,
): Promise<{
  success: boolean;
  booking?: BookingRecord;
  error?: string;
}> {
  // Получаем текущую запись
  const current = await db.queryOne<BookingRecord & { studio_name: string }>(
    `SELECT b.id, b.studio_id, s.name as studio_name, b.client_name, b.client_phone, b.client_email,
            b.service_name, b.start_time, b.end_time, b.status, b.source, b.notes, b.created_at
     FROM bookings b LEFT JOIN studios s ON s.id = b.studio_id
     WHERE b.id = $1`,
    [bookingId],
  );

  if (!current) {
    return { success: false, error: 'Запись не найдена' };
  }

  if (current.status === 'cancelled' || current.status === 'completed') {
    return { success: false, error: 'Нельзя перенести завершённую или отменённую запись' };
  }

  const studioId = newStudioId || current.studio_id;

  // Вычисляем длительность из текущей записи
  const durationMs = new Date(current.end_time).getTime() - new Date(current.start_time).getTime();
  const newStartTime = `${newDate}T${newTime}:00`;
  const newEndTime = new Date(new Date(newStartTime).getTime() + durationMs).toISOString();

  // Check studio status for the target booking date.
  const studioStatus = await selectStudioEffectiveStatus(studioId, newDate);
  if (studioStatus?.status === 'closed' || studioStatus?.status === 'maintenance') {
    return { success: false, error: studioStatus.status_message || 'В выбранную дату точка закрыта. Выберите другой день!' };
  }

  // Check schedule exceptions (closures)
  const closureException = await getScheduleException(studioId, newDate);
  if (closureException?.is_closed) {
    return { success: false, error: closureException.reason || 'В этот день перерыв. Выберите другой день!' };
  }

  // Проверяем конфликт (исключая текущую запись)
  const conflict = await db.queryOne<BookingConflictLookup>(
    `SELECT id FROM bookings
     WHERE studio_id = $1 AND id != $2 AND status != 'cancelled'
       AND tstzrange(start_time, end_time) && tstzrange($3::timestamptz, $4::timestamptz)`,
    [studioId, bookingId, newStartTime, newEndTime],
  );

  if (conflict) {
    return { success: false, error: 'Новый слот занят' };
  }

  // UPDATE
  const updated = await db.queryOne<BookingRecord>(
    `UPDATE bookings SET studio_id = $2, start_time = $3, end_time = $4, updated_at = NOW()
     WHERE id = $1
     RETURNING id, studio_id, client_name, client_phone, client_email, service_name, start_time, end_time, status, source, notes, created_at`,
    [bookingId, studioId, newStartTime, newEndTime],
  );

  if (!updated) {
    return { success: false, error: 'Ошибка обновления записи' };
  }

  // Получаем название новой студии
  const newStudio = newStudioId
    ? await db.queryOne<BookingStudioNameLookup>(`SELECT name FROM studios WHERE id = $1`, [studioId])
    : null;
  const newStudioName = newStudio?.name || current.studio_name || 'Студия';

  // Уведомление о переносе (non-blocking)
  const oldDateStr = new Date(current.start_time).toLocaleDateString('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Moscow',
  });
  const oldTimeStr = new Date(current.start_time).toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
  });

  notifyBookingRescheduled({
    id: updated.id,
    client_name: updated.client_name,
    client_phone: updated.client_phone,
    client_email: updated.client_email,
    start_time: newStartTime,
    end_time: newEndTime,
    service_name: updated.service_name,
    studio_id: studioId,
  }, oldDateStr, oldTimeStr, newStudioName).catch(err => logger.warn('[BookingAutonomous] Reschedule notify failed', { error: String(err) }));

  return { success: true, booking: updated };
}

/**
 * Получить список студий
 */
export async function getStudios(): Promise<Array<{
  id: string;
  name: string;
  location_code: string;
  address: string;
  status: string;
  status_message: string | null;
}>> {
  return db.query(
    `SELECT id, name, location_code, address,
       CASE WHEN status_until IS NOT NULL AND status_until < CURRENT_DATE THEN 'open' ELSE status END AS status,
       CASE WHEN status_until IS NOT NULL AND status_until < CURRENT_DATE THEN NULL ELSE status_message END AS status_message,
       status_until::text AS status_until
     FROM studios WHERE location_code IS NOT NULL ORDER BY name`,
  );
}

// ===== Client Search =====

export interface ClientSearchResult {
  name: string;
  phone: string;
  email: string | null;
  lastVisit: string | null;
  bookingsCount: number;
}

/**
 * Поиск клиентов по номеру телефона (bookings + photo_print_orders)
 */
export async function searchClients(phoneDigits: string): Promise<ClientSearchResult[]> {
  const results = await db.query<ClientSearchLookup>(
    `WITH client_data AS (
       SELECT client_name AS name, client_phone AS phone, client_email AS email,
              MAX(start_time) AS last_visit, COUNT(*) AS visit_count
       FROM bookings
       WHERE client_phone LIKE '%' || $1 || '%' AND client_phone IS NOT NULL
       GROUP BY client_name, client_phone, client_email
       UNION ALL
       SELECT contact_name AS name, contact_phone AS phone, contact_email AS email,
              MAX(created_at) AS last_visit, COUNT(*) AS visit_count
       FROM photo_print_orders
       WHERE contact_phone LIKE '%' || $1 || '%' AND contact_phone IS NOT NULL
       GROUP BY contact_name, contact_phone, contact_email
     )
     SELECT name, phone, email,
            MAX(last_visit)::text AS last_visit,
            SUM(visit_count)::int AS visit_count
     FROM client_data
     WHERE name IS NOT NULL AND name != ''
     GROUP BY name, phone, email
     ORDER BY MAX(last_visit) DESC
     LIMIT 10`,
    [phoneDigits],
  );

  return results.map(r => ({
    name: r.name,
    phone: r.phone,
    email: r.email,
    lastVisit: r.last_visit || null,
    bookingsCount: parseInt(r.visit_count, 10) || 0,
  }));
}
