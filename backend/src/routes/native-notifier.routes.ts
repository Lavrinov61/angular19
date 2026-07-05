import { Router, type Response } from 'express';
import { authenticateToken, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  NATIVE_NOTIFIER_ALL_ROOM,
  emitNativeNotification,
  getNativeNotifierRooms,
  type NativeNotificationPayload,
  type NativeNotifierTargets,
} from '../services/native-notifier.service.js';

const router = Router();

router.use(authenticateToken, requirePermission('settings:manage'));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT_ID_RE = /^[a-z0-9][a-z0-9_.:-]{1,80}$/i;

interface NativeNotifierTestBody {
  studio_id?: unknown;
  studioId?: unknown;
  user_id?: unknown;
  userId?: unknown;
  agent_id?: unknown;
  agentId?: unknown;
  title?: unknown;
  body?: unknown;
}

function getString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  return trimmed;
}

function getUuid(value: unknown): string | undefined {
  const text = getString(value, 80);
  if (!text || !UUID_RE.test(text)) return undefined;
  return text;
}

function getAgentId(value: unknown): string | undefined {
  const text = getString(value, 80);
  if (!text || !AGENT_ID_RE.test(text)) return undefined;
  return text;
}

function getRequestBody(req: AuthRequest): NativeNotifierTestBody {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null) return {};
  return body;
}

function getTargetsFromBody(body: NativeNotifierTestBody): NativeNotifierTargets {
  const studioId = getUuid(body.studio_id ?? body.studioId);
  const userId = getUuid(body.user_id ?? body.userId);
  const agentId = getAgentId(body.agent_id ?? body.agentId);

  return {
    studioIds: studioId ? [studioId] : undefined,
    userIds: userId ? [userId] : undefined,
    agentIds: agentId ? [agentId] : undefined,
  };
}

async function countSocketsInRooms(req: AuthRequest, rooms: string[]): Promise<Array<{ room: string; sockets: number }>> {
  const io = req.app.socketServer?.getIO();
  if (!io) throw new AppError(503, 'Socket server is not ready');

  const counts: Array<{ room: string; sockets: number }> = [];
  for (const room of rooms) {
    const sockets = await io.in(room).allSockets();
    counts.push({ room, sockets: sockets.size });
  }
  return counts;
}

router.get('/status', async (req: AuthRequest, res: Response): Promise<void> => {
  const studioId = getUuid(req.query['studio_id'] ?? req.query['studioId']);
  const userId = getUuid(req.query['user_id'] ?? req.query['userId']);
  const agentId = getAgentId(req.query['agent_id'] ?? req.query['agentId']);

  const rooms = getNativeNotifierRooms({
    studioIds: studioId ? [studioId] : undefined,
    userIds: userId ? [userId] : undefined,
    agentIds: agentId ? [agentId] : undefined,
    all: !studioId && !userId && !agentId,
  });

  const counts = await countSocketsInRooms(req, rooms.length > 0 ? rooms : [NATIVE_NOTIFIER_ALL_ROOM]);
  const uniqueRoomsWithAgents = counts.filter(item => item.sockets > 0).length;

  res.json({
    success: true,
    data: {
      rooms: counts,
      uniqueRoomsWithAgents,
    },
  });
});

router.post('/test', async (req: AuthRequest, res: Response): Promise<void> => {
  const io = req.app.socketServer?.getIO();
  if (!io) throw new AppError(503, 'Socket server is not ready');

  const body = getRequestBody(req);
  const targets = getTargetsFromBody(body);
  const rooms = getNativeNotifierRooms(targets);
  if (rooms.length === 0) {
    throw new AppError(400, 'studio_id, user_id or agent_id is required');
  }

  const title = getString(body.title, 80) ?? 'Тест уведомлений';
  const text = getString(body.body, 240) ?? 'Агент уведомлений подключен через внутреннюю сеть';
  const payload: NativeNotificationPayload = {
    id: `test:${Date.now()}`,
    type: 'test',
    title,
    body: text,
    createdAt: new Date().toISOString(),
    urgency: 'high',
    url: '/employee/team',
  };

  const emittedRooms = emitNativeNotification(io, targets, payload);
  const counts = await countSocketsInRooms(req, emittedRooms);

  res.json({
    success: true,
    data: {
      emittedRooms,
      rooms: counts,
    },
  });
});

export default router;
