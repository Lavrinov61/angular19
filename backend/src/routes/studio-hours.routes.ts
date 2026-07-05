import express, { Response } from 'express';
import db from '../database/db.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = express.Router();

// ============================================================================
// GET /api/studio-hours — Расписание всех студий
// ============================================================================
router.get('/', authenticateToken, async (_req: AuthRequest, res: Response): Promise<void> => {
  const studios = await db.query<{
    id: string;
    name: string;
    location_code: string;
    hours: Array<{ day_of_week: number; start_time: string; end_time: string; is_open: boolean }>;
  }>(
    `SELECT s.id, s.name, s.location_code,
            json_agg(
              json_build_object(
                'id', wh.id,
                'day_of_week', wh.day_of_week,
                'start_time', wh.start_time::text,
                'end_time', wh.end_time::text,
                'is_open', wh.is_open
              ) ORDER BY wh.day_of_week
            ) AS hours
     FROM studios s
     LEFT JOIN studio_working_hours wh ON wh.studio_id = s.id
     GROUP BY s.id, s.name, s.location_code
     ORDER BY s.name`,
    [],
  );

  res.json({ success: true, data: studios });
});

// ============================================================================
// GET /api/studio-hours/:studioId — Расписание конкретной студии
// ============================================================================
router.get('/:studioId', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const { studioId } = req.params;

  const studio = await db.queryOne<{ id: string; name: string; location_code: string }>(
    `SELECT id, name, location_code FROM studios WHERE id = $1`,
    [studioId],
  );

  if (!studio) {
    throw new AppError(404, 'Студия не найдена');
  }

  const hours = await db.query<{
    id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    is_open: boolean;
  }>(
    `SELECT id, day_of_week, start_time::text, end_time::text, is_open
     FROM studio_working_hours
     WHERE studio_id = $1
     ORDER BY day_of_week`,
    [studioId],
  );

  res.json({ success: true, data: { ...studio, hours } });
});

// ============================================================================
// PUT /api/studio-hours/:studioId — Обновить расписание студии
// ============================================================================
router.put('/:studioId', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || req.user.role !== 'admin') {
    throw new AppError(403, 'Требуются права администратора');
  }

  const { studioId } = req.params;
  const { hours } = req.body as {
    hours: Array<{
      day_of_week: number;
      start_time: string;
      end_time: string;
      is_open: boolean;
    }>;
  };

  if (!Array.isArray(hours) || hours.length === 0) {
    throw new AppError(400, 'Поле hours обязательно — массив расписания по дням');
  }

  // Валидация
  for (const h of hours) {
    if (h.day_of_week < 0 || h.day_of_week > 6) {
      throw new AppError(400, `Неверный day_of_week: ${h.day_of_week}. Допустимо 0–6`);
    }
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(h.start_time) || !/^\d{2}:\d{2}(:\d{2})?$/.test(h.end_time)) {
      throw new AppError(400, 'Формат времени: HH:MM');
    }
  }

  const studio = await db.queryOne<{ id: string }>(
    `SELECT id FROM studios WHERE id = $1`,
    [studioId],
  );
  if (!studio) {
    throw new AppError(404, 'Студия не найдена');
  }

  // Upsert расписания
  for (const h of hours) {
    await db.query(
      `INSERT INTO studio_working_hours (studio_id, day_of_week, start_time, end_time, is_open, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (studio_id, day_of_week) DO UPDATE SET
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         is_open = EXCLUDED.is_open,
         updated_at = NOW()`,
      [studioId, h.day_of_week, h.start_time, h.end_time, h.is_open],
    );
  }

  const updated = await db.query(
    `SELECT id, day_of_week, start_time::text, end_time::text, is_open
     FROM studio_working_hours WHERE studio_id = $1 ORDER BY day_of_week`,
    [studioId],
  );

  res.json({ success: true, data: updated });
});

export default router;
