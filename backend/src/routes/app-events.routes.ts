import { Router, Request, Response } from 'express';
import { authenticateToken, requireUser, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import db from '../database/db.js';

const router = Router();

/**
 * POST /api/app-events/batch — принимает массив событий из мобильного приложения.
 * Без JWT — события от неавторизованных пользователей тоже важны.
 */
router.post('/batch', async (req: Request, res: Response): Promise<void> => {
  const { events } = req.body;

  if (!Array.isArray(events) || events.length === 0) throw new AppError(400, 'events array required');
  if (events.length > 500) throw new AppError(400, 'Max 500 events per batch');

  // Build batch INSERT with parameterized values
  const values: any[] = [];
  const placeholders: string[] = [];
  let paramIndex = 1;

  for (const event of events) {
    if (!event.event_name || !event.visitor_id || !event.session_id) {
      continue; // Skip invalid events
    }

    placeholders.push(
      `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7})`
    );

    values.push(
      event.event_name,
      event.screen || null,
      JSON.stringify(event.properties || {}),
      event.user_id || null,
      event.visitor_id,
      event.session_id,
      event.app_version || null,
      event.timestamp ? new Date(event.timestamp) : new Date(),
    );

    paramIndex += 8;
  }

  if (placeholders.length === 0) {
    res.json({ success: true, count: 0 });
    return;
  }

  await db.query(
    `INSERT INTO app_events (event_name, screen, properties, user_id, visitor_id, session_id, app_version, created_at)
     VALUES ${placeholders.join(', ')}`,
    values
  );

  res.json({ success: true, count: placeholders.length });
});

/**
 * GET /api/app-events/stats — статистика событий (для отладки, требует JWT)
 */
router.get('/stats', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req, res);

  const { days = '7' } = req.query;
  const daysNum = Math.min(parseInt(String(days), 10) || 7, 90);

  const stats = await db.query(
    `SELECT
       event_name,
       COUNT(*) as count,
       COUNT(DISTINCT visitor_id) as unique_visitors,
       COUNT(DISTINCT session_id) as sessions
     FROM app_events
     WHERE created_at > NOW() - $1::interval
     GROUP BY event_name
     ORDER BY count DESC`,
    [`${daysNum} days`]
  );

  const totals = await db.queryOne(
    `SELECT
       COUNT(*) as total_events,
       COUNT(DISTINCT visitor_id) as total_visitors,
       COUNT(DISTINCT session_id) as total_sessions
     FROM app_events
     WHERE created_at > NOW() - $1::interval`,
    [`${daysNum} days`]
  );

  res.json({ success: true, days: daysNum, totals, events: stats });
});

export default router;
