import { Router, Request, Response } from 'express';
import { pool } from '../../database/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import { findOrCreateContact } from '../../services/contact.service.js';
import { broadcastChatMessage } from '../../services/chat-broadcast.service.js';

import { createLogger } from '../../utils/logger.js';
const router = Router();

const logger = createLogger('chat-external.routes');
/**
 * Принять сообщение из внешнего канала (Telegram, Max)
 * POST /channel-message
 */
router.post('/channel-message', async (req: Request, res: Response): Promise<void> => {
  const { channel, externalChatId, externalUserId, userName, messageText, messageType = 'text', attachmentUrl } = req.body;

  if (!channel || !externalChatId || !messageText) {
    throw new AppError(400, 'channel, externalChatId, and messageText are required');
  }

  const validChannels = ['telegram', 'max', 'whatsapp', 'vk'];
  if (!validChannels.includes(channel)) {
    throw new AppError(400, 'Invalid channel. Allowed: telegram, max, whatsapp, vk');
  }

  // Find or create session
  let sessionId: string;
  const existing = await pool.query(
    `SELECT id FROM conversations
     WHERE channel = $1 AND metadata->>'externalChatId' = $2
     AND status NOT IN ('closed')
     ORDER BY created_at DESC LIMIT 1`,
    [channel, externalChatId]
  );

  if (existing.rows.length > 0) {
    sessionId = existing.rows[0].id;
  } else {
    // Create contact before conversation
    const contact = await findOrCreateContact({
      phone: null,
      displayName: userName,
      source: channel,
      externalUserId,
      channel,
    });

    const newSession = await pool.query(
      `INSERT INTO conversations
        (visitor_id, visitor_name, channel, status, metadata, contact_id)
       VALUES ($1, $2, $3, 'open', $4, $5)
       RETURNING id`,
      [
        `${channel}:${externalUserId}`,
        userName || null,
        channel,
        JSON.stringify({ externalChatId, externalUserId, channel }),
        contact.id,
      ]
    );
    sessionId = newSession.rows[0].id;
  }

  // Insert message
  const msgResult = await pool.query(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_name, message_type, content, attachment_url)
     VALUES ($1, 'visitor', $2, $3, $4, $5)
     RETURNING id, created_at`,
    [sessionId, userName || null, messageType, messageText, attachmentUrl || null]
  );

  // Update last_message_at
  await pool.query(
    `UPDATE conversations SET last_message_at = NOW() WHERE id = $1`,
    [sessionId]
  );

  // Notify operators via WebSocket (enriched broadcast)
  {
    broadcastChatMessage({
      sessionId,
      message: {
        visitorId: `${channel}:${externalUserId}`,
        content: messageText,
        message_type: messageType,
        created_at: msgResult.rows[0].created_at,
      },
      session: {
        visitor_name: userName || null,
        visitor_phone: null,
        channel,
        status: 'open',
        assigned_operator_id: null,
      },
    }).catch(err => logger.error('[chat-external] broadcastChatMessage failed', { error: String(err) }));
  }

  res.json({ success: true, data: { sessionId, messageId: msgResult.rows[0].id } });
});

export default router;
