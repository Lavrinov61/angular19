import { Router } from 'express';
import { authenticateToken, requireUser, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { pool } from '../database/db.js';
import db from '../database/db.js';

const router = Router();

// Get photographer schedules
router.get('/photographer/:id', async (req, res) => {
  const { id } = req.params;
  const { start_date, end_date } = req.query;

  let query = `
    SELECT
      id, photographer_id, day_of_week, start_time, end_time,
      is_available, break_start, break_end, max_bookings,
      effective_from, effective_until, created_at, updated_at
    FROM schedules
    WHERE photographer_id = $1
  `;

  const params: any[] = [id];

  if (start_date && end_date) {
    query += ` AND (
      (effective_from IS NULL OR effective_from <= $2) AND
      (effective_until IS NULL OR effective_until >= $3)
    )`;
    params.push(end_date, start_date);
  }

  query += ` ORDER BY day_of_week, start_time`;

  const result = await pool.query(query, params);

  res.json({
    schedules: result.rows,
    photographer_id: id,
  });
});

// Create schedule (photographer only)
router.post('/', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const photographerId = req.user.id;

  // Check if user is photographer
  const photographerCheck = await pool.query(
    'SELECT user_id FROM photographers WHERE user_id = $1',
    [photographerId]
  );

  if (photographerCheck.rows.length === 0) {
    throw new AppError(403, 'Only photographers can create schedules');
  }

  const {
    day_of_week,
    start_time,
    end_time,
    is_available = true,
    break_start,
    break_end,
    max_bookings,
    effective_from,
    effective_until,
  } = req.body;

  // Validate required fields
  if (day_of_week === undefined || !start_time || !end_time) {
    throw new AppError(400, 'day_of_week, start_time, and end_time are required');
  }

  const result = await pool.query(
    `INSERT INTO schedules (
      photographer_id, day_of_week, start_time, end_time,
      is_available, break_start, break_end, max_bookings,
      effective_from, effective_until
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      photographerId,
      day_of_week,
      start_time,
      end_time,
      is_available,
      break_start || null,
      break_end || null,
      max_bookings || null,
      effective_from || null,
      effective_until || null,
    ]
  );

  res.status(201).json(result.rows[0]);
});

// Update schedule
router.put('/:id', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const photographerId = req.user.id;
  const { id } = req.params;

  // Check if schedule belongs to photographer
  const scheduleCheck = await pool.query(
    'SELECT photographer_id FROM schedules WHERE id = $1',
    [id]
  );

  if (scheduleCheck.rows.length === 0) {
    throw new AppError(404, 'Schedule not found');
  }

  if (scheduleCheck.rows[0].photographer_id !== photographerId && req.user.role !== 'admin') {
    throw new AppError(403, 'Forbidden');
  }

  const {
    day_of_week,
    start_time,
    end_time,
    is_available,
    break_start,
    break_end,
    max_bookings,
    effective_from,
    effective_until,
  } = req.body;

  const result = await pool.query(
    `UPDATE schedules SET
      day_of_week = COALESCE($1, day_of_week),
      start_time = COALESCE($2, start_time),
      end_time = COALESCE($3, end_time),
      is_available = COALESCE($4, is_available),
      break_start = COALESCE($5, break_start),
      break_end = COALESCE($6, break_end),
      max_bookings = COALESCE($7, max_bookings),
      effective_from = COALESCE($8, effective_from),
      effective_until = COALESCE($9, effective_until),
      updated_at = NOW()
    WHERE id = $10
    RETURNING *`,
    [
      day_of_week,
      start_time,
      end_time,
      is_available,
      break_start,
      break_end,
      max_bookings,
      effective_from,
      effective_until,
      id,
    ]
  );

  res.json(result.rows[0]);
});

// Delete schedule
router.delete('/:id', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const photographerId = req.user.id;
  const { id } = req.params;

  // Check if schedule belongs to photographer
  const scheduleCheck = await pool.query(
    'SELECT photographer_id FROM schedules WHERE id = $1',
    [id]
  );

  if (scheduleCheck.rows.length === 0) {
    throw new AppError(404, 'Schedule not found');
  }

  if (scheduleCheck.rows[0].photographer_id !== photographerId && req.user.role !== 'admin') {
    throw new AppError(403, 'Forbidden');
  }

  await pool.query('DELETE FROM schedules WHERE id = $1', [id]);

  res.json({ message: 'Schedule deleted successfully' });
});

// Get schedule preferences
router.get('/preferences/:photographerId', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  const { photographerId } = req.params;

  const prefs = await db.queryOne<{
    photographer_id: string;
    auto_accept_bookings: boolean;
    buffer_time_minutes: number;
    max_daily_bookings: number;
    advance_booking_days: number;
    same_day_booking_enabled: boolean;
  }>(
    `SELECT photographer_id, auto_accept_bookings, buffer_time_minutes,
            max_daily_bookings, advance_booking_days, same_day_booking_enabled
     FROM schedule_preferences WHERE photographer_id = $1`,
    [photographerId]
  );

  // Возвращаем сохранённые настройки или дефолтные
  res.json(prefs ?? {
    photographer_id: photographerId,
    auto_accept_bookings: false,
    buffer_time_minutes: 30,
    max_daily_bookings: 5,
    advance_booking_days: 30,
    same_day_booking_enabled: false,
  });
});

// Save schedule preferences
router.put('/preferences/:photographerId', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const { photographerId: paramPhotographerId } = req.params;

  if (req.user.id !== paramPhotographerId && req.user.role !== 'admin') {
    throw new AppError(403, 'Forbidden');
  }

  const {
    auto_accept_bookings = false,
    buffer_time_minutes = 30,
    max_daily_bookings = 5,
    advance_booking_days = 30,
    same_day_booking_enabled = false,
  } = req.body as Record<string, any>;

  const updated = await db.queryOne(
    `INSERT INTO schedule_preferences
       (photographer_id, auto_accept_bookings, buffer_time_minutes,
        max_daily_bookings, advance_booking_days, same_day_booking_enabled)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (photographer_id) DO UPDATE SET
       auto_accept_bookings    = EXCLUDED.auto_accept_bookings,
       buffer_time_minutes     = EXCLUDED.buffer_time_minutes,
       max_daily_bookings      = EXCLUDED.max_daily_bookings,
       advance_booking_days    = EXCLUDED.advance_booking_days,
       same_day_booking_enabled = EXCLUDED.same_day_booking_enabled,
       updated_at              = NOW()
     RETURNING *`,
    [
      paramPhotographerId,
      auto_accept_bookings,
      buffer_time_minutes,
      max_daily_bookings,
      advance_booking_days,
      same_day_booking_enabled,
    ]
  );

  res.json(updated);
});

// Get schedule stats
router.get('/stats/:photographerId', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  const { photographerId } = req.params;

  const result = await pool.query(
    `SELECT
      COUNT(*) as total_slots,
      COUNT(*) FILTER (WHERE is_available = true) as available_slots,
      COUNT(*) FILTER (WHERE is_available = false) as unavailable_slots,
      COUNT(DISTINCT day_of_week) as days_configured
    FROM schedules
    WHERE photographer_id = $1`,
    [photographerId]
  );

  res.json(result.rows[0]);
});

// Generate schedule (auto-generate for a time period)
router.post('/generate', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const photographerId = req.user.id;
  const {
    start_date,
    end_date,
    default_start_time = '09:00',
    default_end_time = '18:00',
    work_days = [1, 2, 3, 4, 5], // Monday to Friday
  } = req.body;

  if (!start_date || !end_date) {
    throw new AppError(400, 'start_date and end_date are required');
  }

  // Generate schedules for work days
  const schedules = [];
  for (const day of work_days) {
    const result = await pool.query(
      `INSERT INTO schedules (
        photographer_id, day_of_week, start_time, end_time,
        is_available, effective_from, effective_until
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (photographer_id, day_of_week, effective_from, effective_until)
      DO UPDATE SET
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time,
        is_available = EXCLUDED.is_available,
        updated_at = NOW()
      RETURNING *`,
      [
        photographerId,
        day,
        default_start_time,
        default_end_time,
        true,
        start_date,
        end_date,
      ]
    );
    schedules.push(result.rows[0]);
  }

  res.status(201).json({
    message: 'Schedules generated successfully',
    schedules,
  });
});

// Check for schedule conflicts
router.post('/conflicts', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  const { photographer_id, booking_date, start_time, end_time } = req.body;

  if (!photographer_id || !booking_date || !start_time || !end_time) {
    throw new AppError(400, 'photographer_id, booking_date, start_time, and end_time are required');
  }

  // Check for existing bookings at the same time
  const conflicts = await pool.query(
    `SELECT
      b.id, b.booking_date, b.start_time, b.end_time,
      u.display_name as client_name
    FROM bookings b
    JOIN users u ON b.user_id = u.id
    WHERE b.photographer_id = $1
      AND b.booking_date = $2
      AND b.status NOT IN ('cancelled', 'rejected')
      AND (
        (b.start_time <= $3 AND b.end_time > $3) OR
        (b.start_time < $4 AND b.end_time >= $4) OR
        (b.start_time >= $3 AND b.end_time <= $4)
      )`,
    [photographer_id, booking_date, start_time, end_time]
  );

  res.json({
    has_conflicts: conflicts.rows.length > 0,
    conflicts: conflicts.rows,
  });
});

export default router;
