import { Router } from 'express';
import { authenticateToken, requireUser, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { pool } from '../database/db.js';
import { getVapidPublicKey, saveSubscription, removeSubscription } from '../services/web-push-notify.service.js';

const router = Router();

// Get notifications for current user
router.get('/', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const userId = req.user.id;
  const { limit = 20, offset = 0, unread_only = 'false' } = req.query;

  let query = `
    SELECT
      id, user_id, type, title, body,
      data, read, created_at
    FROM notifications
    WHERE user_id = $1
  `;

  const params: any[] = [userId];

  if (unread_only === 'true') {
    query += ` AND read = false`;
  }

  query += ` ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
  params.push(limit, offset);

  const result = await pool.query(query, params);

  res.json({
    notifications: result.rows,
    total: result.rowCount,
  });
});

// Get notification settings
router.get('/settings', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const userId = req.user.id;

  const result = await pool.query(
    `SELECT
      email_notifications, push_notifications,
      sms_notifications, notification_frequency
    FROM user_settings
    WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    // Return default settings
    res.json({
      email_notifications: true,
      push_notifications: true,
      sms_notifications: false,
      notification_frequency: 'instant',
    });
    return;
  }

  res.json(result.rows[0]);
});

// Update notification settings
router.put('/settings', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const userId = req.user.id;
  const {
    email_notifications,
    push_notifications,
    sms_notifications,
    notification_frequency,
  } = req.body;

  const result = await pool.query(
    `INSERT INTO user_settings (
      user_id, email_notifications, push_notifications,
      sms_notifications, notification_frequency
    ) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_id) DO UPDATE SET
      email_notifications = EXCLUDED.email_notifications,
      push_notifications = EXCLUDED.push_notifications,
      sms_notifications = EXCLUDED.sms_notifications,
      notification_frequency = EXCLUDED.notification_frequency,
      updated_at = NOW()
    RETURNING *`,
    [
      userId,
      email_notifications ?? true,
      push_notifications ?? true,
      sms_notifications ?? false,
      notification_frequency ?? 'instant',
    ]
  );

  res.json(result.rows[0]);
});

// Mark notification as read
router.put('/:id/read', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const userId = req.user.id;
  const { id } = req.params;

  const result = await pool.query(
    `UPDATE notifications
     SET read = true, updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [id, userId]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Notification not found');
  }

  res.json(result.rows[0]);
});

// Mark all notifications as read
router.put('/read-all', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const userId = req.user.id;

  await pool.query(
    `UPDATE notifications
     SET read = true, updated_at = NOW()
     WHERE user_id = $1 AND read = false`,
    [userId]
  );

  res.json({ message: 'All notifications marked as read' });
});

// Delete notification
router.delete('/:id', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const userId = req.user.id;
  const { id } = req.params;

  const result = await pool.query(
    `DELETE FROM notifications
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [id, userId]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'Notification not found');
  }

  res.json({ message: 'Notification deleted successfully' });
});

// Create notification (admin only)
router.post('/', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  // Check if user is admin
  if (req.user.role !== 'admin') {
    throw new AppError(403, 'Forbidden');
  }

  const { user_id, type, title, body, data } = req.body;

  const result = await pool.query(
    `INSERT INTO notifications (
      user_id, type, title, body, data
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING *`,
    [user_id, type, title, body, data || null]
  );

  res.status(201).json(result.rows[0]);
});

// Get notification statistics
router.get('/stats', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const userId = req.user.id;

  const result = await pool.query(
    `SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE read = false) as unread,
      COUNT(*) FILTER (WHERE read = true) as read
    FROM notifications
    WHERE user_id = $1`,
    [userId]
  );

  res.json(result.rows[0]);
});

// Get VAPID public key for push subscription
router.get('/push/vapid-key', (_req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

// Subscribe to push notifications (Web Push via VAPID)
router.post('/push/subscribe', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const userId = req.user.id;
  const { subscription } = req.body;

  if (!subscription || !subscription.endpoint) {
    throw new AppError(400, 'Invalid subscription data');
  }

  await saveSubscription(userId, subscription, req.headers['user-agent']);
  res.json({ message: 'Subscribed to push notifications' });
});

// Unsubscribe from push notifications
router.delete('/push/unsubscribe', authenticateToken, async (req: AuthRequest, res) => {
  requireUser(req, res);
  const userId = req.user.id;
  const { endpoint } = req.body;

  await removeSubscription(userId, endpoint);
  res.json({ message: 'Unsubscribed from push notifications' });
});

export default router;
