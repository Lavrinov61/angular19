import { createHash, timingSafeEqual } from 'crypto';
import type { Server as SocketIOServer } from 'socket.io';
import { pool } from '../database/db.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('native-notifier');

export const NATIVE_NOTIFIER_ALL_ROOM = 'native-notifier:all';
export const NATIVE_NOTIFIER_EVENT = 'native-notifier:notification';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT_ID_RE = /^[a-z0-9][a-z0-9_.:-]{1,80}$/i;

export interface NativeNotifierIdentity {
  agentId: string;
  studioId?: string;
  userId?: string;
  hostname?: string;
  platform?: string;
  version?: string;
}

export interface NativeNotifierHandshake {
  token: string;
  identity: NativeNotifierIdentity;
}

export interface NativeNotifierHandshakeAuth {
  agentType?: unknown;
  agentToken?: unknown;
  token?: unknown;
  agentId?: unknown;
  studioId?: unknown;
  userId?: unknown;
  hostname?: unknown;
  platform?: unknown;
  version?: unknown;
}

export interface NativeNotificationPayload {
  id: string;
  type: 'staff-chat:new-message' | 'staff-chat:mention' | 'test' | 'system';
  title: string;
  body: string;
  createdAt: string;
  urgency?: 'normal' | 'high';
  url?: string;
  staffChat?: {
    conversationId: string;
    messageId?: string;
    senderId: string;
    senderName: string;
  };
}

export interface NativeNotifierTargets {
  userIds?: readonly string[];
  studioIds?: readonly string[];
  agentIds?: readonly string[];
  all?: boolean;
}

interface StaffChatParticipantNotificationRow {
  user_id: string;
  studio_id: string | null;
}

export interface NativeStaffChatNotificationInput {
  conversationId: string;
  messageId?: string;
  senderId: string;
  senderName: string;
  previewText: string;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function constantTimeEquals(left: string, right: string): boolean {
  return timingSafeEqual(sha256(left), sha256(right));
}

function configuredAgentTokens(): string[] {
  const raw = process.env['NATIVE_NOTIFIER_AGENT_TOKENS']
    || process.env['NATIVE_NOTIFIER_AGENT_TOKEN']
    || '';
  return raw.split(',').map(token => token.trim()).filter(Boolean);
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  return trimmed;
}

function optionalUuid(value: unknown): string | undefined {
  const text = optionalString(value, 80);
  if (!text || !UUID_RE.test(text)) return undefined;
  return text;
}

function optionalAgentId(value: unknown): string | undefined {
  const text = optionalString(value, 80);
  if (!text || !AGENT_ID_RE.test(text)) return undefined;
  return text;
}

export function isNativeNotifierTokenValid(token: string): boolean {
  const tokens = configuredAgentTokens();
  if (tokens.length === 0) return false;
  return tokens.some(expected => constantTimeEquals(token, expected));
}

export function parseNativeNotifierHandshake(auth: NativeNotifierHandshakeAuth): NativeNotifierHandshake | null {
  if (auth['agentType'] !== 'native-notifier') return null;

  const token = optionalString(auth['agentToken'] ?? auth['token'], 512);
  const agentId = optionalAgentId(auth['agentId']);
  const studioId = optionalUuid(auth['studioId']);
  const userId = optionalUuid(auth['userId']);

  if (!token || !agentId || (!studioId && !userId)) return null;

  return {
    token,
    identity: {
      agentId,
      studioId,
      userId,
      hostname: optionalString(auth['hostname'], 120),
      platform: optionalString(auth['platform'], 40),
      version: optionalString(auth['version'], 40),
    },
  };
}

export function nativeNotifierAgentRoom(agentId: string): string {
  return `native-notifier:agent:${agentId}`;
}

export function nativeNotifierStudioRoom(studioId: string): string {
  return `native-notifier:studio:${studioId}`;
}

export function nativeNotifierUserRoom(userId: string): string {
  return `native-notifier:user:${userId}`;
}

export function getNativeNotifierRooms(targets: NativeNotifierTargets): string[] {
  const rooms = new Set<string>();
  if (targets.all) rooms.add(NATIVE_NOTIFIER_ALL_ROOM);

  for (const userId of targets.userIds ?? []) {
    if (UUID_RE.test(userId)) rooms.add(nativeNotifierUserRoom(userId));
  }
  for (const studioId of targets.studioIds ?? []) {
    if (UUID_RE.test(studioId)) rooms.add(nativeNotifierStudioRoom(studioId));
  }
  for (const agentId of targets.agentIds ?? []) {
    if (AGENT_ID_RE.test(agentId)) rooms.add(nativeNotifierAgentRoom(agentId));
  }

  return [...rooms];
}

export function emitNativeNotification(
  io: SocketIOServer,
  targets: NativeNotifierTargets,
  payload: NativeNotificationPayload,
): string[] {
  const rooms = getNativeNotifierRooms(targets);
  if (rooms.length === 0) return [];

  io.to(rooms).emit(NATIVE_NOTIFIER_EVENT, payload);
  return rooms;
}

function truncateForNotification(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 120) return normalized;
  return `${normalized.slice(0, 117)}...`;
}

export async function notifyNativeStaffChatParticipants(
  io: SocketIOServer,
  input: NativeStaffChatNotificationInput,
): Promise<string[]> {
  const params: unknown[] = [input.conversationId, input.senderId];
  const { rows } = await pool.query<StaffChatParticipantNotificationRow>(
    `SELECT DISTINCT
            p.user_id,
            COALESCE(open_pos.studio_id, current_shift.studio_id) AS studio_id
       FROM staff_conversation_participants p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN LATERAL (
         SELECT ps.studio_id
           FROM pos_shifts ps
          WHERE ps.employee_id = p.user_id
            AND ps.status = 'open'
          ORDER BY ps.opened_at DESC NULLS LAST
          LIMIT 1
       ) open_pos ON true
       LEFT JOIN LATERAL (
         SELECT es.studio_id
           FROM employee_shifts es
          WHERE es.employee_id = p.user_id
            AND es.shift_date = CURRENT_DATE
            AND es.status IN ('active', 'scheduled')
          ORDER BY
            CASE WHEN es.status = 'active' THEN 0 ELSE 1 END,
            es.checked_in_at DESC NULLS LAST,
            es.start_time ASC
          LIMIT 1
       ) current_shift ON true
      WHERE p.conversation_id = $1
        AND p.user_id != $2
        AND p.left_at IS NULL
        AND u.is_active = true
        AND (p.muted_until IS NULL OR p.muted_until < NOW())`,
    params,
  );

  const userIds = rows.map(row => row.user_id);
  const studioIds = rows
    .map(row => row.studio_id)
    .filter((studioId): studioId is string => typeof studioId === 'string' && UUID_RE.test(studioId));

  if (userIds.length === 0 && studioIds.length === 0) return [];

  const rooms = emitNativeNotification(io, { userIds, studioIds }, {
    id: input.messageId ? `staff-chat:${input.messageId}` : `staff-chat:${input.conversationId}:${Date.now()}`,
    type: 'staff-chat:new-message',
    title: input.senderName,
    body: truncateForNotification(input.previewText),
    url: '/employee/team',
    createdAt: new Date().toISOString(),
    urgency: 'high',
    staffChat: {
      conversationId: input.conversationId,
      messageId: input.messageId,
      senderId: input.senderId,
      senderName: input.senderName,
    },
  });

  log.info('Native staff-chat notification emitted', {
    conversationId: input.conversationId,
    messageId: input.messageId,
    roomCount: rooms.length,
    userCount: userIds.length,
    studioCount: new Set(studioIds).size,
  });

  return rooms;
}
