import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import db from '../database/db.js';
import { config } from '../config/index.js';
import { broadcastToRoom } from '../websocket/broadcast-to-room.js';
import { createLogger } from '../utils/logger.js';
import * as telephonyService from './telephony.service.js';
import {
  startVoximplantServiceSurveyCall,
  type VoximplantServiceSurveyCallResult,
} from './voximplant.service.js';

const log = createLogger('service-survey-call-queue');
const SERVICE_SURVEY_QUEUE_LOCK_ID = 26051001;
const SERVICE_SURVEY_ACTIVE_WINDOW_MINUTES = 30;
const SERVICE_SURVEY_ACTIVE_STATUSES: readonly string[] = ['connecting', 'ringing', 'active'];
const SERVICE_SURVEY_TERMINAL_EVENTS = new Set(['completed', 'failed', 'no_answer']);

interface QueueCountRow {
  count: number | string;
}

interface ServiceSurveyEventFields {
  queuePosition?: number;
}

export interface EnqueueServiceSurveyCallInput {
  phone: string;
  orderId?: string;
  clientId?: string;
  operatorUserId: string;
}

export interface EnqueueServiceSurveyCallResult {
  callLog: telephonyService.CallLog;
  clientName: string | null;
  sessionId: string;
  status: string;
  question: string;
  queued: boolean;
  queuePosition: number;
}

export class ServiceSurveyCallStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceSurveyCallStartError';
  }
}

function isTerminalSurveyEvent(event: string): boolean {
  return SERVICE_SURVEY_TERMINAL_EVENTS.has(event);
}

function toCount(value: number | string | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number.parseInt(value, 10) || 0;
  return 0;
}

async function acquireQueueLock(client: PoolClient): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [SERVICE_SURVEY_QUEUE_LOCK_ID]);
}

async function findActiveServiceSurveyCall(client: PoolClient): Promise<telephonyService.CallLog | null> {
  const result = await client.query<telephonyService.CallLog>(
    `SELECT *
     FROM call_logs
     WHERE voximplant_session_id LIKE 'service-survey-%'
       AND status = ANY($1::text[])
       AND started_at >= NOW() - ($2::int * INTERVAL '1 minute')
     ORDER BY started_at ASC
     LIMIT 1`,
    [SERVICE_SURVEY_ACTIVE_STATUSES, SERVICE_SURVEY_ACTIVE_WINDOW_MINUTES],
  );
  return result.rows[0] || null;
}

async function insertQueuedServiceSurveyCall(
  client: PoolClient,
  input: EnqueueServiceSurveyCallInput,
  sessionId: string,
): Promise<telephonyService.CallLog> {
  const result = await client.query<telephonyService.CallLog>(
    `INSERT INTO call_logs (
       voximplant_session_id, direction, caller_number, called_number,
       client_user_id, operator_user_id, status
     )
     VALUES ($1, 'outbound', $2, $3, $4, $5, 'queued')
     RETURNING *`,
    [
      sessionId,
      config.voximplant.serviceSurvey.callerId,
      input.phone,
      input.clientId || null,
      input.operatorUserId,
    ],
  );

  const callLog = result.rows[0];
  if (!callLog) {
    throw new Error('Failed to create service survey call log');
  }

  if (input.orderId) {
    await client.query(
      `INSERT INTO call_entity_links (call_log_id, entity_type, entity_id)
       VALUES ($1, 'order', $2)
       ON CONFLICT DO NOTHING`,
      [callLog.id, input.orderId],
    );
  }

  return callLog;
}

async function promoteNextQueuedServiceSurveyCall(
  client: PoolClient,
): Promise<telephonyService.CallLog | null> {
  const active = await findActiveServiceSurveyCall(client);
  if (active) return null;

  const result = await client.query<telephonyService.CallLog>(
    `WITH next_call AS (
       SELECT id
       FROM call_logs
       WHERE voximplant_session_id LIKE 'service-survey-%'
         AND status = 'queued'
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE call_logs c
     SET status = 'connecting',
         started_at = NOW(),
         answered_at = NULL,
         ended_at = NULL
     FROM next_call
     WHERE c.id = next_call.id
     RETURNING c.*`,
  );

  return result.rows[0] || null;
}

async function getQueuedPosition(client: PoolClient, callLogId: string): Promise<number> {
  const result = await client.query<QueueCountRow>(
    `SELECT COUNT(*)::int AS count
     FROM call_logs queued
     JOIN call_logs current ON current.id = $1
     WHERE queued.voximplant_session_id LIKE 'service-survey-%'
       AND queued.status = 'queued'
       AND queued.created_at <= current.created_at`,
    [callLogId],
  );

  return toCount(result.rows[0]?.count);
}

function broadcastServiceSurveyEvent(
  callLog: telephonyService.CallLog,
  event: string,
  extras: ServiceSurveyEventFields = {},
): void {
  broadcastToRoom('telephony:call_event', 'employee:dashboard', {
    callId: callLog.id,
    event,
    status: callLog.status,
    scenario: 'service_survey',
    sessionId: callLog.voximplant_session_id,
    ...extras,
  });
}

async function startPromotedServiceSurveyCall(
  callLog: telephonyService.CallLog,
  options: { throwOnFailure: boolean },
): Promise<telephonyService.CallLog | null> {
  if (!callLog.voximplant_session_id || !callLog.called_number) {
    const failed = await telephonyService.updateCallLog(callLog.id, {
      status: 'failed',
      ended_at: new Date().toISOString(),
      notes: 'Voximplant service survey start failed: missing session or destination',
    });
    broadcastServiceSurveyEvent(failed || callLog, 'failed');
    if (options.throwOnFailure) {
      throw new ServiceSurveyCallStartError('missing session or destination');
    }
    return null;
  }

  let started: VoximplantServiceSurveyCallResult;
  try {
    started = await startVoximplantServiceSurveyCall({
      destinationPhone: callLog.called_number,
      sessionId: callLog.voximplant_session_id,
      callerId: config.voximplant.serviceSurvey.callerId,
      maxAnswerMs: config.voximplant.serviceSurvey.maxAnswerMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await telephonyService.updateCallLog(callLog.id, {
      status: 'failed',
      ended_at: new Date().toISOString(),
      notes: `Voximplant service survey start failed: ${message}`,
    });
    broadcastServiceSurveyEvent(failed || callLog, 'failed');
    if (options.throwOnFailure) {
      throw new ServiceSurveyCallStartError(message);
    }
    return null;
  }

  if (!started.success) {
    const failed = await telephonyService.updateCallLog(callLog.id, {
      status: 'failed',
      ended_at: new Date().toISOString(),
      notes: `Voximplant service survey start failed: ${started.error || 'unknown'}`,
    });
    broadcastServiceSurveyEvent(failed || callLog, 'failed');
    if (options.throwOnFailure) {
      throw new ServiceSurveyCallStartError(started.error || 'Voximplant service survey failed');
    }
    return null;
  }

  broadcastServiceSurveyEvent(callLog, 'started');
  return callLog;
}

export async function enqueueServiceSurveyCall(
  input: EnqueueServiceSurveyCallInput,
): Promise<EnqueueServiceSurveyCallResult> {
  const client = input.clientId ? null : await telephonyService.lookupClientByPhone(input.phone);
  const resolvedClientId = input.clientId || client?.id;
  const sessionId = `service-survey-${randomUUID()}`;
  const question = config.voximplant.serviceSurvey.question;

  const queued = await db.transaction(async (pgClient: PoolClient) => {
    await acquireQueueLock(pgClient);
    const callLog = await insertQueuedServiceSurveyCall(
      pgClient,
      { ...input, clientId: resolvedClientId },
      sessionId,
    );
    const active = await findActiveServiceSurveyCall(pgClient);

    if (!active) {
      const promoted = await promoteNextQueuedServiceSurveyCall(pgClient);
      if (!promoted) {
        return {
          callLog,
          promotedCallLog: null,
          queuePosition: await getQueuedPosition(pgClient, callLog.id),
        };
      }

      return {
        callLog: promoted.id === callLog.id ? promoted : callLog,
        promotedCallLog: promoted,
        queuePosition: promoted.id === callLog.id ? 0 : await getQueuedPosition(pgClient, callLog.id),
      };
    }

    return {
      callLog,
      promotedCallLog: null,
      queuePosition: await getQueuedPosition(pgClient, callLog.id),
    };
  });

  if (queued.promotedCallLog) {
    const currentCallWasPromoted = queued.promotedCallLog.id === queued.callLog.id;
    const started = await startPromotedServiceSurveyCall(queued.promotedCallLog, {
      throwOnFailure: currentCallWasPromoted,
    });

    if (!started) {
      scheduleNextQueuedServiceSurveyCall('failed');
    }

    const callLog = currentCallWasPromoted ? (started || queued.promotedCallLog) : queued.callLog;
    return {
      callLog,
      clientName: client?.display_name || null,
      sessionId,
      status: callLog.status,
      question,
      queued: !currentCallWasPromoted,
      queuePosition: currentCallWasPromoted ? 0 : queued.queuePosition,
    };
  }

  broadcastServiceSurveyEvent(queued.callLog, 'queued', {
    queuePosition: queued.queuePosition,
  });

  return {
    callLog: queued.callLog,
    clientName: client?.display_name || null,
    sessionId,
    status: queued.callLog.status,
    question,
    queued: true,
    queuePosition: queued.queuePosition,
  };
}

export async function startNextQueuedServiceSurveyCall(): Promise<telephonyService.CallLog | null> {
  const promoted = await db.transaction(async (pgClient: PoolClient) => {
    await acquireQueueLock(pgClient);
    return promoteNextQueuedServiceSurveyCall(pgClient);
  });

  if (!promoted) return null;

  const started = await startPromotedServiceSurveyCall(promoted, { throwOnFailure: false });
  if (started) return started;

  return startNextQueuedServiceSurveyCall();
}

export function scheduleNextQueuedServiceSurveyCall(event: string): void {
  if (!isTerminalSurveyEvent(event)) return;

  startNextQueuedServiceSurveyCall().catch((error: unknown) => {
    log.error('Failed to start next queued service survey call', { error: String(error) });
  });
}
