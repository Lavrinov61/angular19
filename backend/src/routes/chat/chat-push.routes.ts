import { Router, Request, Response } from 'express';
import { pool } from '../../database/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import { authenticateToken, requireUser, type AuthRequest } from '../../middleware/auth.js';
import { getWebPushPublicKey } from '../../services/visitor-push.service.js';
import { getOwnedConversation } from './chat-ownership.js';

const router = Router();

interface ChatPushKeysBody {
  readonly p256dh?: unknown;
  readonly auth?: unknown;
}

interface ChatPushSubscriptionBody {
  readonly endpoint?: unknown;
  readonly keys?: unknown;
}

interface ChatPushSubscribeBody {
  readonly sessionId?: unknown;
  readonly subscription?: unknown;
  readonly userAgent?: unknown;
  readonly pageUrl?: unknown;
}

interface ChatPushUnsubscribeBody {
  readonly sessionId?: unknown;
  readonly endpoint?: unknown;
}

function isObjectBody(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSubscribeBody(value: unknown): value is ChatPushSubscribeBody {
  return isObjectBody(value);
}

function isSubscriptionBody(value: unknown): value is ChatPushSubscriptionBody {
  return isObjectBody(value);
}

function isKeysBody(value: unknown): value is ChatPushKeysBody {
  return isObjectBody(value);
}

function isUnsubscribeBody(value: unknown): value is ChatPushUnsubscribeBody {
  return isObjectBody(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Получить публичный VAPID ключ для push-уведомлений
 * GET /push/vapid-public-key
 */
router.get('/push/vapid-public-key', (_req: Request, res: Response): void => {
  const publicKey = getWebPushPublicKey();
  if (!publicKey) {
    res.status(503).json({
      success: false,
      error: 'Web push is not configured'
    });
    return;
  }

  res.json({
    success: true,
    publicKey,
  });
});

/**
 * Подписка на push-уведомления для авторизованного чата
 * POST /push/subscribe
 */
router.post('/push/subscribe', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const rawBody: unknown = req.body;
  const body = isSubscribeBody(rawBody) ? rawBody : {};
  const sessionId = readString(body?.['sessionId']);
  const subscription = isSubscriptionBody(body?.['subscription']) ? body.subscription : null;
  const endpoint = readString(subscription?.['endpoint']);
  const keys = isKeysBody(subscription?.['keys']) ? subscription.keys : null;
  const p256dh = readString(keys?.['p256dh']);
  const auth = readString(keys?.['auth']);
  const userAgent = readString(body?.['userAgent']) ?? req.get('user-agent') ?? null;
  const pageUrl = readString(body?.['pageUrl']);

  if (!sessionId || !endpoint || !keys) {
    throw new AppError(400, 'sessionId and subscription are required');
  }

  if (!p256dh || !auth) {
    throw new AppError(400, 'Invalid subscription keys');
  }

  const conversation = await getOwnedConversation(req.user.id, sessionId);
  const subscriptionOwnerId = conversation.contact_id;

  if (pageUrl) {
    await pool.query(
      `UPDATE conversations SET page_url = COALESCE($2, page_url) WHERE id = $1`,
      [sessionId, pageUrl],
    );
  }

  // Удаляем старые подписки для этого endpoint из других сессий
  await pool.query(
    `DELETE FROM visitor_push_subscriptions WHERE endpoint = $1 AND session_id <> $2`,
    [endpoint, sessionId],
  );

  const keysPayload = JSON.stringify({ p256dh, auth });

  await pool.query(
    `INSERT INTO visitor_push_subscriptions
      (session_id, visitor_id, endpoint, keys, user_agent, created_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, NOW(), NOW())
     ON CONFLICT (session_id, endpoint) DO UPDATE SET
       keys = EXCLUDED.keys,
       user_agent = EXCLUDED.user_agent,
       updated_at = NOW()`,
    [sessionId, subscriptionOwnerId, endpoint, keysPayload, userAgent],
  );

  res.json({ success: true });
});

/**
 * Отписка от push-уведомлений авторизованного чата
 * DELETE /push/unsubscribe
 */
router.delete('/push/unsubscribe', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);
  const rawBody: unknown = req.body;
  const body = isUnsubscribeBody(rawBody) ? rawBody : {};
  const sessionId = readString(body?.['sessionId']);
  const endpoint = readString(body?.['endpoint']);

  if (!sessionId || !endpoint) {
    throw new AppError(400, 'sessionId and endpoint are required');
  }

  await getOwnedConversation(req.user.id, sessionId);

  await pool.query(
    `DELETE FROM visitor_push_subscriptions WHERE session_id = $1 AND endpoint = $2`,
    [sessionId, endpoint],
  );

  res.json({ success: true });
});

export default router;
