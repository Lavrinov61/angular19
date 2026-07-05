/**
 * Broadcast Routes — mass messaging to messenger conversations
 *
 * POST /api/admin/broadcast — send a message to all active conversations
 * Protected: authenticateToken + requirePermission('settings:manage')
 */

import { Router, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import db from '../database/db.js';
import { enqueueOutbound } from '../services/connectors/pipeline/outbound-worker.js';
import { MESSENGER_CHANNELS, type MessengerChannelType } from '../services/connectors/core/types.js';
import { logAudit } from '../services/audit.service.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const log = createLogger('broadcast.routes');

const MAX_RECIPIENTS = 2000;
const BROADCAST_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

const VALID_CHANNELS = new Set<string>(MESSENGER_CHANNELS);

interface BroadcastRecipient {
  id: string;
  channel: string;
  external_chat_id: string;
}

/**
 * POST / — Execute a broadcast
 */
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user?.id;
  const userName = req.user?.display_name || req.user?.email || 'unknown';

  const {
    channels,
    message,
    minLastActivity,
    dryRun = false,
  } = req.body as {
    channels?: string[];
    message?: string;
    minLastActivity?: string;
    dryRun?: boolean;
  };

  // --- Validation ---
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ success: false, error: 'message is required' });
    return;
  }

  if (message.length > 4096) {
    res.status(400).json({ success: false, error: 'message must be <= 4096 characters' });
    return;
  }

  const targetChannels: string[] = channels && Array.isArray(channels) && channels.length > 0
    ? channels.filter(ch => VALID_CHANNELS.has(ch))
    : [...MESSENGER_CHANNELS];

  if (targetChannels.length === 0) {
    res.status(400).json({ success: false, error: 'No valid channels specified' });
    return;
  }

  // --- Rate limit: 1 broadcast per hour ---
  if (!dryRun) {
    const recent = await db.queryOne<{ id: string }>(
      `SELECT id FROM broadcast_log
       WHERE dry_run = false AND created_at > NOW() - interval '1 hour'
       ORDER BY created_at DESC LIMIT 1`,
    );
    if (recent) {
      res.status(429).json({
        success: false,
        error: 'Broadcast rate limit: 1 per hour. Try again later.',
      });
      return;
    }
  }

  // --- Build recipient query ---
  const conditions: string[] = [
    'external_chat_id IS NOT NULL',
    `channel = ANY($1::text[])`,
    `status NOT IN ('closed')`,
  ];
  const params: unknown[] = [targetChannels];

  if (minLastActivity) {
    const date = new Date(minLastActivity);
    if (isNaN(date.getTime())) {
      res.status(400).json({ success: false, error: 'Invalid minLastActivity date' });
      return;
    }
    conditions.push(`last_message_at >= $${params.length + 1}`);
    params.push(date.toISOString());
  }

  // Deduplicate by (channel, external_chat_id) — pick the most recent conversation
  const sql = `
    SELECT DISTINCT ON (channel, external_chat_id)
      id, channel, external_chat_id
    FROM conversations
    WHERE ${conditions.join(' AND ')}
    ORDER BY channel, external_chat_id, last_message_at DESC NULLS LAST
    LIMIT ${MAX_RECIPIENTS + 1}
  `;

  const recipients = await db.query<BroadcastRecipient>(sql, params);

  if (recipients.length > MAX_RECIPIENTS) {
    res.status(400).json({
      success: false,
      error: `Too many recipients (${recipients.length}+). Max: ${MAX_RECIPIENTS}. Use minLastActivity to narrow.`,
    });
    return;
  }

  const total = recipients.length;

  // --- Log the broadcast ---
  await db.query(
    `INSERT INTO broadcast_log (user_id, user_name, channels, message, total, queued, dry_run, min_last_activity)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId || null,
      userName,
      targetChannels,
      message.trim(),
      total,
      dryRun ? 0 : total,
      dryRun,
      minLastActivity || null,
    ],
  );

  // --- Dry run: return count only ---
  if (dryRun) {
    const channelBreakdown: Record<string, number> = {};
    for (const r of recipients) {
      channelBreakdown[r.channel] = (channelBreakdown[r.channel] || 0) + 1;
    }

    res.json({
      success: true,
      dryRun: true,
      total,
      channels: channelBreakdown,
    });
    return;
  }

  // --- Enqueue messages (BullMQ worker limiter handles throttling: 30 msg/sec) ---
  let queued = 0;

  for (const recipient of recipients) {
    try {
      await enqueueOutbound({
        channel: recipient.channel as MessengerChannelType,
        externalChatId: recipient.external_chat_id,
        content: message.trim(),
        conversationId: recipient.id,
        maxAttempts: 3,
      });
      queued++;
    } catch (err) {
      log.error('Failed to enqueue broadcast message', {
        conversationId: recipient.id,
        channel: recipient.channel,
        error: String(err),
      });
    }

    // Yield control periodically to avoid blocking the event loop
    if (queued % 100 === 0 && queued > 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  // --- Audit ---
  logAudit({
    userId: userId || undefined,
    userName,
    action: 'broadcast_send',
    entityType: 'broadcast',
    details: {
      channels: targetChannels,
      total,
      queued,
      minLastActivity: minLastActivity || null,
      messagePreview: message.trim().slice(0, 100),
    },
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  log.info('Broadcast enqueued', { userId, total, queued, channels: targetChannels });

  res.json({
    success: true,
    dryRun: false,
    total,
    queued,
  });
});

/**
 * GET /history — recent broadcast log
 */
router.get('/history', async (_req: AuthRequest, res: Response): Promise<void> => {
  const rows = await db.query<{
    id: string;
    user_name: string;
    channels: string[];
    message: string;
    total: number;
    queued: number;
    dry_run: boolean;
    created_at: string;
  }>(
    `SELECT id, user_name, channels, LEFT(message, 200) as message,
            total, queued, dry_run, created_at
     FROM broadcast_log
     ORDER BY created_at DESC
     LIMIT 50`,
  );

  res.json({ success: true, data: rows });
});

export default router;
