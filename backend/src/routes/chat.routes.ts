import { Router, Response } from 'express';
import { pool } from '../database/db.js';
import { AuthRequest, authenticateToken } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

/**
 * Get chat messages for a booking
 * GET /api/chat/bookings/:bookingId/messages
 */
router.get('/bookings/:bookingId/messages', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { bookingId } = req.params;
  const { limit = 50, offset = 0 } = req.query;

  const result = await pool.query(
    `SELECT
      id, booking_id, sender_id, sender_name, sender_role,
      message, timestamp, read
    FROM chat_messages
    WHERE booking_id = $1
    ORDER BY timestamp DESC
    LIMIT $2 OFFSET $3`,
    [bookingId, limit, offset]
  );

  res.json({
    success: true,
    data: result.rows.reverse(), // Reverse to show oldest first
    pagination: {
      limit: Number(limit),
      offset: Number(offset),
      total: result.rows.length
    }
  });
});

/**
 * Send a chat message (HTTP fallback)
 * POST /api/chat/bookings/:bookingId/messages
 */
router.post('/bookings/:bookingId/messages', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const { bookingId } = req.params;
  const { message, senderName, senderRole } = req.body;
  const senderId = req.user.id;

  if (!message || !senderName || !senderRole) {
    throw new AppError(400, 'Missing required fields: message, senderName, senderRole');
  }

  const result = await pool.query(
    `INSERT INTO chat_messages
      (booking_id, sender_id, sender_name, sender_role, message, timestamp, read)
    VALUES ($1, $2, $3, $4, $5, NOW(), false)
    RETURNING *`,
    [bookingId, senderId, senderName, senderRole, message]
  );

  res.json({
    success: true,
    data: result.rows[0]
  });
});

/**
 * Mark messages as read
 * PUT /api/chat/bookings/:bookingId/messages/read
 */
router.put('/bookings/:bookingId/messages/read', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const { bookingId } = req.params;
  const { messageIds } = req.body;

  if (!messageIds || !Array.isArray(messageIds)) {
    throw new AppError(400, 'messageIds must be an array');
  }

  await pool.query(
    `UPDATE chat_messages
    SET read = true
    WHERE booking_id = $1 AND id = ANY($2)`,
    [bookingId, messageIds]
  );

  res.json({
    success: true,
    message: 'Messages marked as read'
  });
});

/**
 * Get unread message count for user
 * GET /api/chat/unread-count
 */
router.get('/unread-count', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const userId = req.user.id;

  const result = await pool.query(
    `SELECT COUNT(*) as count
    FROM chat_messages cm
    JOIN bookings b ON cm.booking_id = b.id
    WHERE (b.user_id = $1 OR b.photographer_id = $1)
      AND cm.sender_id != $1
      AND cm.read = false`,
    [userId]
  );

  res.json({
    success: true,
    data: {
      unreadCount: parseInt(result.rows[0].count)
    }
  });
});

/**
 * Get user's chat list (all bookings with messages)
 * GET /api/chat/conversations
 */
router.get('/conversations', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const userId = req.user.id;

  const result = await pool.query(
    `SELECT DISTINCT
      b.id as booking_id,
      b.service_type,
      b.date as booking_date,
      b.status as booking_status,
      u.display_name as client_name,
      p.display_name as photographer_name,
      (
        SELECT message
        FROM chat_messages
        WHERE booking_id = b.id
        ORDER BY timestamp DESC
        LIMIT 1
      ) as last_message,
      (
        SELECT timestamp
        FROM chat_messages
        WHERE booking_id = b.id
        ORDER BY timestamp DESC
        LIMIT 1
      ) as last_message_time,
      (
        SELECT COUNT(*)
        FROM chat_messages
        WHERE booking_id = b.id
          AND sender_id != $1
          AND read = false
      ) as unread_count
    FROM bookings b
    JOIN users u ON b.user_id = u.id
    JOIN photographers p ON b.photographer_id = p.id
    WHERE (b.user_id = $1 OR b.photographer_id = $1)
      AND EXISTS (SELECT 1 FROM chat_messages WHERE booking_id = b.id)
    ORDER BY last_message_time DESC NULLS LAST`,
    [userId]
  );

  res.json({
    success: true,
    data: result.rows
  });
});

export default router;
