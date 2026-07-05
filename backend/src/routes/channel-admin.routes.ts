/**
 * Channel Admin Routes (Omnichannel v2)
 *
 * Manages channel adapters: status, toggle, dead letters, health.
 * Protected: authenticateToken + requirePermission('settings:manage')
 */

import { Router, Request, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { getAllBreakers } from '../utils/circuit-breaker.js';
import { createLogger } from '../utils/logger.js';
import {
  getAllAdapters,
  getAdapter,
  isChannelDisabled,
  setChannelDisabled,
} from '../services/connectors/core/adapter-registry.js';
import { getAllChannelMetrics, getChannelMetrics } from '../services/channel-metrics.service.js';
import { logAudit } from '../services/audit.service.js';
import { enqueueOutbound, outboundQueue } from '../services/connectors/pipeline/outbound-worker.js';
import { getAggregatedHealth, getChannelHealthDetail, invalidateHealthCache } from '../services/channel-health.service.js';
import db from '../database/db.js';
import type { ChannelType } from '../services/connectors/core/types.js';

const router = Router();
const logger = createLogger('channel-admin.routes');

const CHANNELS = ['telegram', 'vk', 'max', 'whatsapp', 'instagram'] as const;

const VALID_CHANNELS: readonly string[] = [...CHANNELS];
function isValidChannel(ch: string): ch is ChannelType {
  return VALID_CHANNELS.includes(ch);
}

function queueDepth(counts: { waiting: number; active: number; delayed: number } | undefined): number {
  if (!counts) return 0;
  return counts.waiting + counts.active + counts.delayed;
}

/**
 * GET / — List all channels with status + health
 */
router.get('/', async (req: Request, res: Response) => {
  const [metrics, healthData] = await Promise.all([
    getAllChannelMetrics(),
    getAggregatedHealth(),
  ]);
  const breakers = getAllBreakers();
  const healthMap = new Map(healthData.map(h => [h.channel, h]));

  const channels = await Promise.all(CHANNELS.map(async (ch) => {
    const adapter = getAdapter(ch);
    const breaker = breakers.get(ch);
    const disabled = await isChannelDisabled(ch);
    const hd = healthMap.get(ch);

    let outboundDepth = queueDepth(hd?.queues?.outbound);
    if (!hd?.queues) {
      try {
        const counts = await outboundQueue.getJobCounts('waiting', 'active', 'delayed');
        outboundDepth = (counts['waiting'] || 0) + (counts['active'] || 0) + (counts['delayed'] || 0);
      } catch (err) {
        logger.warn('Failed to get queue depth', {
          error: err instanceof Error ? err.message : String(err),
          channel: ch
        });
      }
    }

    return {
      channel: ch,
      connectorEnabled: !!adapter,
      disabled,
      health: hd?.health ?? 'healthy',
      summary: hd?.summary ?? '',
      circuitBreaker: {
        state: breaker?.getState() || 'CLOSED',
        failures: breaker?.getFailures() || 0,
        lastError: breaker?.getLastError() || null,
        lastSuccessAt: breaker?.getLastSuccessAt() || null,
        lastFailureAt: breaker?.getLastFailureAt() || null,
      },
      queueDepth: outboundDepth,
      inbound: hd?.inbound ?? null,
      queues: hd?.queues ?? null,
      telegram: hd?.telegram ?? null,
      media: hd?.media ?? null,
      metrics24h: metrics[ch] || { sent: 0, received: 0, delivered: 0, failed: 0, avgDeliveryMs: 0 },
    };
  }));

  res.json({ success: true, data: channels });
});

/**
 * GET /:channel/stats — Detailed stats for a channel (7 days)
 */
router.get('/:channel/stats', async (req: Request, res: Response) => {
  const channel = req.params['channel'];
  if (!CHANNELS.includes(channel as typeof CHANNELS[number])) {
    res.status(400).json({ success: false, error: 'Invalid channel' });
    return;
  }

  const days: Array<{ date: string; metrics: Awaited<ReturnType<typeof getChannelMetrics>> }> = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const metrics = await getChannelMetrics(channel, d);
    days.push({ date: d.toISOString().slice(0, 10), metrics });
  }

  // Last 10 errors from outbound_queue (v2)
  const errors = await db.query<{ id: string; content: string; last_error: string; attempts: number; created_at: string }>(
    `SELECT id, content, last_error, attempts, created_at FROM outbound_queue
     WHERE channel = $1 AND status IN ('failed', 'dead_letter')
     ORDER BY created_at DESC LIMIT 10`,
    [channel],
  );

  res.json({ success: true, data: { channel, days, recentErrors: errors } });
});

/**
 * POST /:channel/toggle — Enable/disable a channel at runtime
 */
router.post('/:channel/toggle', async (req: AuthRequest, res: Response) => {
  const channel = req.params['channel'];
  if (!CHANNELS.includes(channel as typeof CHANNELS[number])) {
    res.status(400).json({ success: false, error: 'Invalid channel' });
    return;
  }

  const body: { enabled: boolean } = req.body;
  const disabled = !body.enabled;
  await setChannelDisabled(channel, disabled);

  // Audit
  const userId = req.user?.id || 'system';
  logAudit({
    action: disabled ? 'channel_disabled' : 'channel_enabled',
    userId,
    entityType: 'channel',
    entityId: channel,
    details: { channel, disabled },
  });

  // Invalidate health cache on toggle
  await invalidateHealthCache();

  // Socket.IO broadcast
  const app = req.app;
  const socketServer = app.socketServer;
  if (socketServer) {
    socketServer.getIO().to('admin:channels').emit('channel:status-changed', {
      channel,
      disabled,
      timestamp: new Date().toISOString(),
    });

    // Broadcast health change
    const updatedHealth = await getChannelHealthDetail(channel);
    if (updatedHealth) {
      socketServer.getIO().to('admin:channels').emit('channel:health-changed', {
        channel,
        health: updatedHealth.health,
        summary: updatedHealth.summary,
        timestamp: new Date().toISOString(),
      });
    }
  }

  res.json({ success: true, data: { channel, disabled } });
});

/**
 * GET /:channel/health — Full health detail for a single channel
 */
router.get('/:channel/health', async (req: Request, res: Response) => {
  const channel = req.params['channel'];
  if (!isValidChannel(channel)) {
    res.status(400).json({ success: false, error: 'Invalid channel' });
    return;
  }

  const detail = await getChannelHealthDetail(channel);
  if (!detail) {
    res.status(404).json({ success: false, error: 'Channel health not found' });
    return;
  }

  res.json({ success: true, data: detail });
});

/**
 * GET /dead-letters — Paginated dead letter list (from outbound_queue v2)
 */
router.get('/dead-letters', async (req: Request, res: Response) => {
  const page = parseInt(req.query['page'] as never as string || '1', 10);
  const limit = Math.min(parseInt(req.query['limit'] as never as string || '20', 10), 100);
  const channelFilter = req.query['channel'] as never as string || null;
  const offset = (page - 1) * limit;

  let whereClause = "WHERE status = 'dead_letter'";
  const params: unknown[] = [limit, offset];

  if (channelFilter) {
    whereClause += ` AND channel = $3`;
    params.push(channelFilter);
  }

  const [rows, countResult] = await Promise.all([
    db.query<{
      id: string; channel: string; content: string; last_error: string;
      attempts: number; created_at: string; conversation_id: string; external_chat_id: string;
      message_type: string; attachment_url: string | null; source_message_id: string;
    }>(
      `SELECT id, channel, content, last_error, attempts, created_at, conversation_id,
              external_chat_id, message_type, attachment_url, source_message_id
       FROM outbound_queue ${whereClause}
       ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      params,
    ),
    db.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM outbound_queue ${whereClause.replace('$3', `$${params.length}`)}`,
      channelFilter ? [channelFilter] : [],
    ),
  ]);

  res.json({
    success: true,
    data: rows,
    pagination: {
      page,
      limit,
      total: parseInt(countResult?.count || '0', 10),
    },
  });
});

/**
 * POST /dead-letters/:id/retry — Retry a single dead letter
 */
router.post('/dead-letters/:id/retry', async (req: Request, res: Response) => {
  const id = req.params['id'];

  const row = await db.queryOne<{
    channel: string; external_chat_id: string; content: string;
    message_type: string; attachment_url: string | null;
    source_message_id: string; conversation_id: string;
  }>(
    `SELECT channel, external_chat_id, content, message_type, attachment_url, source_message_id, conversation_id
     FROM outbound_queue WHERE id = $1 AND status = 'dead_letter'`,
    [id],
  );

  if (!row) {
    res.status(404).json({ success: false, error: 'Dead letter not found' });
    return;
  }

  if (isValidChannel(row.channel)) {
    // Reset status to pending for re-processing
    await db.query(
      `UPDATE outbound_queue SET status = 'pending', attempts = 0, next_retry_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id],
    );

    // Schedule immediate processing via BullMQ
    await outboundQueue.add('send', { queueItemId: id }, {
      attempts: 1,
      removeOnComplete: { count: 5000 },
      removeOnFail: { count: 10000 },
    });
  }

  res.json({ success: true });
});

/**
 * POST /dead-letters/retry-batch — Batch retry dead letters
 */
router.post('/dead-letters/retry-batch', async (req: Request, res: Response) => {
  const { channel: channelFilter, limit: maxRetry } = req.body as never as { channel?: string; limit?: number };
  const retryLimit = Math.min(maxRetry || 50, 200);

  let whereClause = "WHERE status = 'dead_letter'";
  const params: unknown[] = [retryLimit];
  if (channelFilter) {
    whereClause += ' AND channel = $2';
    params.push(channelFilter);
  }

  const rows = await db.query<{ id: string }>(
    `UPDATE outbound_queue SET status = 'pending', attempts = 0, next_retry_at = NOW(), updated_at = NOW()
     WHERE id IN (
       SELECT id FROM outbound_queue ${whereClause}
       ORDER BY created_at ASC LIMIT $1
     )
     RETURNING id`,
    params,
  );

  // Schedule BullMQ jobs for each retried item
  for (const row of rows) {
    await outboundQueue.add('send', { queueItemId: row.id }, {
      attempts: 1,
      removeOnComplete: { count: 5000 },
      removeOnFail: { count: 10000 },
    });
  }

  res.json({ success: true, data: { retried: rows.length } });
});

/**
 * GET /health — Health check for all channels
 */
router.get('/health', async (_req: Request, res: Response) => {
  const breakers = getAllBreakers();
  const health: Record<string, { state: string; enabled: boolean; disabled: boolean }> = {};

  for (const ch of CHANNELS) {
    const adapter = getAdapter(ch);
    const breaker = breakers.get(ch);
    const disabled = await isChannelDisabled(ch);
    health[ch] = {
      state: breaker?.getState() || 'CLOSED',
      enabled: !!adapter,
      disabled,
    };
  }

  const allHealthy = Object.values(health).every(h => h.state === 'CLOSED' && h.enabled && !h.disabled);
  res.status(allHealthy ? 200 : 503).json({ success: true, status: allHealthy ? 'healthy' : 'degraded', channels: health });
});

export default router;
