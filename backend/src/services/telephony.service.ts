/**
 * Telephony Service — управление звонками (Voximplant)
 * call_logs, call_entity_links, поиск клиентов по телефону
 */
import db from '../database/db.js';
import { enqueueCrmEvent, type InboxRowData } from './crm-event-queue.service.js';
import { broadcastToRoom } from '../websocket/broadcast-to-room.js';
import { createLogger } from '../utils/logger.js';
import type { TaskMetadata } from '../types/jsonb/task-metadata.js';
import type { CallTranscriptRawPayload } from '../types/jsonb/call-transcript-raw-payload.js';
import type {
  ServiceSurveyResponseCountRow,
  ServiceSurveyResponseFilters,
  ServiceSurveyResponseRow,
  ServiceSurveyRecordingRow,
} from '../types/views/service-survey-views.js';

const log = createLogger('telephony-service');

type TelephonyCallStatus = 'ringing' | 'active' | 'completed' | 'missed' | 'failed' | 'connecting';
type WorkTaskPriority = 'low' | 'normal' | 'high' | 'urgent';
type WorkTaskStatus = 'open' | 'assigned' | 'in_progress' | 'waiting' | 'completed' | 'cancelled' | 'handed_off';

export interface CallLogInput {
  voximplant_session_id?: string;
  direction: 'inbound' | 'outbound';
  caller_number: string;
  called_number?: string;
  client_user_id?: string;
  operator_user_id?: string;
  status?: string;
}

export interface CallLog {
  id: string;
  voximplant_session_id: string | null;
  direction: 'inbound' | 'outbound';
  caller_number: string;
  called_number: string | null;
  client_user_id: string | null;
  operator_user_id: string | null;
  client_name?: string;
  operator_name?: string;
  status: string;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  notes: string | null;
  created_at: string;
}

export interface CallTranscript {
  id: string;
  call_log_id: string;
  source: string;
  transcript_text: string;
  confidence: number | null;
  language_code: string | null;
  is_final: boolean;
  recording_url: string | null;
  raw_payload: CallTranscriptRawPayload | null;
  created_at: string;
}

export interface ClientLookupResult {
  id: string;
  display_name: string | null;
  phone: string;
  email: string | null;
  orders_count: number;
}

export interface InboundCallLogInput {
  voximplant_session_id: string;
  caller_number: string;
  called_number?: string;
  client_user_id?: string;
  status?: TelephonyCallStatus;
}

export interface MissedInboundCallInput {
  session_id: string;
  caller_number?: string;
  called_number?: string;
  reason?: string;
  failure_code?: number;
  failure_name?: string;
  duration_seconds?: number;
  scenario?: string;
  destination_user?: string;
  occurred_at?: string;
}

export interface MissedInboundCallResult {
  callLog: CallLog;
  client: ClientLookupResult | null;
  taskId: string | null;
  taskNumber: number | null;
  createdTask: boolean;
}

export interface CallTranscriptInput {
  call_log_id: string;
  source?: string;
  transcript_text: string;
  confidence?: number;
  language_code?: string;
  is_final?: boolean;
  recording_url?: string;
  raw_payload?: CallTranscriptRawPayload;
}

export interface ServiceSurveyResultInput {
  session_id: string;
  event: 'answered' | 'completed' | 'failed' | 'no_answer' | 'transcript' | 'recording';
  caller_number?: string;
  called_number?: string;
  duration_seconds?: number;
  reason?: string;
  failure_code?: number;
  failure_name?: string;
  occurred_at?: string;
  question?: string;
  transcript?: string;
  confidence?: number;
  language_code?: string;
  recording_url?: string;
}

export interface ServiceSurveyResult {
  callLog: CallLog | null;
  transcript: CallTranscript | null;
}

export interface RecentVoipFailureSummary {
  targetUser: string;
  windowMinutes: number;
  failureCount: number;
  lastFailureAt: string | null;
}

export interface VoipHealthFailureInput {
  targetUser: string;
  reason: string;
  message: string;
  windowMinutes?: number;
  failureCount?: number;
  lastFailureAt?: string | null;
  userActive?: boolean | null;
  checkedAt?: string;
}

export interface VoipHealthTaskResult {
  taskId: string;
  taskNumber: number;
  createdTask: boolean;
}

export interface VoipPhoneHealthSnapshot {
  targetUser: string;
  windowMinutes: number;
  recentFailureCount: number;
  lastFailureAt: string | null;
  openIncidentTaskId: string | null;
  openIncidentTaskNumber: number | null;
}

interface CountRow {
  cnt: string;
}

interface ClientPhoneLookupRow {
  id: string;
  display_name: string | null;
  phone: string;
  email: string | null;
}

interface CallEntityLinkRow {
  entity_type: string;
  entity_id: string;
}

interface OperatorAvailabilityRow {
  id: string;
  display_name: string | null;
  accept_calls: boolean;
  on_shift: boolean;
}

interface WorkTaskTelephonyRow {
  id: string;
  task_number: number;
  title: string;
  description: string | null;
  status: WorkTaskStatus;
  priority: WorkTaskPriority;
  task_type: string;
  client_name: string | null;
  client_phone: string | null;
  client_channel: string | null;
  assigned_to: string | null;
  assigned_studio_id: string | null;
  metadata: TaskMetadata | null;
  created_at: string;
  updated_at: string;
}

type LinkedTaskRow = WorkTaskTelephonyRow;

interface RecentVoipFailureRow {
  failure_count: number | string;
  last_failure_at: string | null;
}

const VOIP_HEALTH_METADATA_SOURCE = 'telephony_voip_health';

function normalizeOptionalString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function formatTaskPreview(task: Pick<WorkTaskTelephonyRow, 'task_number' | 'title'>): string {
  return `#${task.task_number} ${task.title}`;
}

function priorityToInboxPriority(priority: WorkTaskPriority): number {
  if (priority === 'urgent') return 0;
  if (priority === 'high') return 1;
  if (priority === 'normal') return 2;
  return 3;
}

function appendCallNote(existing: string | null, note: string): string {
  return existing ? `${existing}\n${note}` : note;
}

function formatMissedCallNote(input: MissedInboundCallInput, occurredAt: string): string {
  const parts = [
    `reason=${input.reason || 'unknown'}`,
    input.failure_code !== undefined ? `code=${input.failure_code}` : null,
    input.failure_name ? `failure=${input.failure_name}` : null,
    input.destination_user ? `destination=${input.destination_user}` : null,
    input.scenario ? `scenario=${input.scenario}` : null,
  ].filter((part): part is string => Boolean(part));

  return `[${occurredAt}] Voximplant inbound missed: ${parts.join(', ')}`;
}

function formatMissedCallDescription(phone: string | null, reason: string | undefined): string {
  const reasonText = reason ? ` Причина Voximplant: ${reason}.` : '';
  return `Входящий звонок не дошел до телефона студии.${reasonText} Перезвонить клиенту как можно быстрее.${phone ? ` Номер: ${phone}.` : ''}`;
}

function formatVoipIncidentDescription(input: VoipHealthFailureInput, checkedAt: string): string {
  const details = [
    `Проверка: ${checkedAt}`,
    `Voximplant user: ${input.targetUser}`,
    `Причина: ${input.reason}`,
    input.failureCount !== undefined ? `Недозвонов за окно: ${input.failureCount}` : null,
    input.windowMinutes !== undefined ? `Окно: ${input.windowMinutes} мин` : null,
    input.lastFailureAt ? `Последний fail: ${input.lastFailureAt}` : null,
    input.userActive !== undefined && input.userActive !== null ? `Voximplant active: ${input.userActive ? 'yes' : 'no'}` : null,
    input.message,
  ].filter((part): part is string => Boolean(part));

  return details.join('\n');
}

function createTaskInboxPayload(task: WorkTaskTelephonyRow): Partial<InboxRowData> {
  return {
    client_name: task.client_name,
    client_phone: task.client_phone,
    preview: formatTaskPreview(task),
    status: task.status,
    priority: priorityToInboxPriority(task.priority),
    sort_time: new Date().toISOString(),
    channel: task.client_channel,
    assigned_to: task.assigned_to,
    assigned_to_name: null,
    unread: true,
    metadata: {
      taskNumber: task.task_number,
      taskType: task.task_type,
      source: task.metadata && 'source' in task.metadata ? task.metadata.source : undefined,
    },
  };
}

function enqueueTaskInboxEvent(task: WorkTaskTelephonyRow, eventType: 'task_created' | 'task_updated'): void {
  enqueueCrmEvent('task', task.id, eventType, createTaskInboxPayload(task))
    .catch((error: unknown) => log.warn('Failed to enqueue telephony task CRM event', {
      taskId: task.id,
      eventType,
      error: String(error),
    }));
}

/**
 * Поиск клиента по телефону
 */
export async function lookupClientByPhone(phone: string): Promise<ClientLookupResult | null> {
  // Нормализуем телефон — убираем всё кроме цифр
  const digits = phone.replace(/\D/g, '');
  // Ищем по последним 10 цифрам (без кода страны)
  const last10 = digits.slice(-10);

  const client = await db.queryOne<ClientPhoneLookupRow>(
    `SELECT id, display_name, phone, email FROM users
     WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone, '+', ''), '-', ''), ' ', ''), '(', '') LIKE '%' || $1
     LIMIT 1`,
    [last10]
  );

  if (!client) return null;

  const countResult = await db.queryOne<CountRow>(
    `SELECT COUNT(*) as cnt
     FROM photo_print_orders
     WHERE RIGHT(REGEXP_REPLACE(contact_phone, '\\D', '', 'g'), 10) = $1`,
    [last10]
  );

  return {
    ...client,
    orders_count: parseInt(countResult?.cnt || '0', 10),
  };
}

/**
 * Создать запись звонка
 */
export async function createCallLog(data: CallLogInput): Promise<CallLog> {
  const result = await db.queryOne<CallLog>(
    `INSERT INTO call_logs (voximplant_session_id, direction, caller_number, called_number,
       client_user_id, operator_user_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.voximplant_session_id || null,
      data.direction,
      data.caller_number,
      data.called_number || null,
      data.client_user_id || null,
      data.operator_user_id || null,
      data.status || 'ringing',
    ]
  );
  return result!;
}

/**
 * Получить запись звонка по Voximplant session/call ID.
 */
export async function getCallLogBySession(sessionId: string): Promise<CallLog | null> {
  return db.queryOne<CallLog>(
    `SELECT * FROM call_logs WHERE voximplant_session_id = $1 LIMIT 1`,
    [sessionId],
  );
}

/**
 * Создать или обновить входящий звонок без дублей при повторном webhook.
 */
export async function createOrUpdateInboundCallLog(data: InboundCallLogInput): Promise<CallLog> {
  const result = await db.queryOne<CallLog>(
    `INSERT INTO call_logs (
       voximplant_session_id, direction, caller_number, called_number, client_user_id, status
     )
     VALUES ($1, 'inbound', $2, $3, $4, $5)
     ON CONFLICT (voximplant_session_id) DO UPDATE SET
       caller_number = COALESCE(EXCLUDED.caller_number, call_logs.caller_number),
       called_number = COALESCE(EXCLUDED.called_number, call_logs.called_number),
       client_user_id = COALESCE(EXCLUDED.client_user_id, call_logs.client_user_id),
       status = CASE
         WHEN call_logs.status IN ('completed', 'missed') THEN call_logs.status
         ELSE COALESCE(EXCLUDED.status, call_logs.status)
       END
     RETURNING *`,
    [
      data.voximplant_session_id,
      data.caller_number,
      data.called_number || null,
      data.client_user_id || null,
      data.status || 'ringing',
    ],
  );

  if (!result) {
    throw new Error('Failed to create inbound call log');
  }

  return result;
}

/**
 * Обновить запись звонка
 */
export async function updateCallLog(
  id: string,
  updates: Partial<Pick<CallLog, 'status' | 'answered_at' | 'ended_at' | 'duration_seconds' | 'operator_user_id' | 'recording_url' | 'notes'>>
): Promise<CallLog | null> {
  const allowed = ['status', 'answered_at', 'ended_at', 'duration_seconds', 'operator_user_id', 'recording_url', 'notes'] as const;
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const key of allowed) {
    if (key in updates && updates[key] !== undefined) {
      setClauses.push(`${key} = $${paramIndex}`);
      values.push(updates[key]);
      paramIndex++;
    }
  }

  if (setClauses.length === 0) return null;

  values.push(id);
  return db.queryOne<CallLog>(
    `UPDATE call_logs SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );
}

/**
 * Обновить по Voximplant session ID
 */
export async function updateCallLogBySession(
  sessionId: string,
  updates: Partial<Pick<CallLog, 'status' | 'answered_at' | 'ended_at' | 'duration_seconds' | 'operator_user_id' | 'recording_url' | 'notes'>>
): Promise<CallLog | null> {
  const allowed = ['status', 'answered_at', 'ended_at', 'duration_seconds', 'operator_user_id', 'recording_url', 'notes'] as const;
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const key of allowed) {
    if (key in updates && updates[key] !== undefined) {
      setClauses.push(`${key} = $${paramIndex}`);
      values.push(updates[key]);
      paramIndex++;
    }
  }

  if (setClauses.length === 0) return null;

  values.push(sessionId);
  return db.queryOne<CallLog>(
    `UPDATE call_logs SET ${setClauses.join(', ')} WHERE voximplant_session_id = $${paramIndex} RETURNING *`,
    values
  );
}

export async function createCallTranscript(input: CallTranscriptInput): Promise<CallTranscript> {
  const result = await db.queryOne<CallTranscript>(
    `INSERT INTO call_transcripts (
       call_log_id, source, transcript_text, confidence, language_code, is_final, recording_url, raw_payload
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING *`,
    [
      input.call_log_id,
      input.source || 'voximplant_asr',
      input.transcript_text,
      input.confidence ?? null,
      input.language_code || null,
      input.is_final ?? true,
      input.recording_url || null,
      input.raw_payload ? JSON.stringify(input.raw_payload) : null,
    ],
  );

  if (!result) {
    throw new Error('Failed to create call transcript');
  }

  return result;
}

function formatServiceSurveyNote(input: ServiceSurveyResultInput, occurredAt: string): string | null {
  if (input.event === 'recording') {
    return null;
  }

  if (input.event === 'answered') {
    return `[${occurredAt}] Service survey answered`;
  }

  if (input.event === 'completed' || input.event === 'transcript') {
    const parts = [
      input.question ? `question="${input.question}"` : null,
      input.transcript ? `transcript="${input.transcript}"` : 'transcript=empty',
      input.recording_url ? `recording=${input.recording_url}` : null,
    ].filter((part): part is string => Boolean(part));

    return `[${occurredAt}] Service survey ${input.event}: ${parts.join(', ')}`;
  }

  const parts = [
    input.reason ? `reason=${input.reason}` : null,
    input.failure_code !== undefined ? `code=${input.failure_code}` : null,
    input.failure_name ? `failure=${input.failure_name}` : null,
  ].filter((part): part is string => Boolean(part));

  return `[${occurredAt}] Service survey ${input.event}: ${parts.join(', ') || 'unknown'}`;
}

function buildServiceSurveyRawPayload(
  input: ServiceSurveyResultInput,
  occurredAt: string,
): CallTranscriptRawPayload {
  const payload: CallTranscriptRawPayload = {
    event: input.event,
    sessionId: input.session_id,
    occurredAt,
  };
  if (input.caller_number) payload.callerNumber = input.caller_number;
  if (input.called_number) payload.calledNumber = input.called_number;
  if (input.reason) payload.reason = input.reason;
  if (input.failure_code !== undefined) payload.failureCode = input.failure_code;
  if (input.failure_name) payload.failureName = input.failure_name;
  if (input.duration_seconds !== undefined) payload.durationSeconds = input.duration_seconds;
  if (input.question) payload.question = input.question;
  if (input.confidence !== undefined) payload.confidence = input.confidence;
  if (input.language_code) payload.languageCode = input.language_code;
  if (input.recording_url) payload.recordingUrl = input.recording_url;
  return payload;
}

function isCallLogSessionUniqueViolation(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && 'constraint' in error
    && error.code === '23505'
    && error.constraint === 'call_logs_voximplant_session_id_key';
}

export async function recordServiceSurveyResult(input: ServiceSurveyResultInput): Promise<ServiceSurveyResult> {
  const occurredAt = input.occurred_at || new Date().toISOString();
  let callLog = await getCallLogBySession(input.session_id);

  if (!callLog && (input.caller_number || input.called_number)) {
    const client = input.called_number ? await lookupClientByPhone(input.called_number) : null;
    try {
      callLog = await createCallLog({
        voximplant_session_id: input.session_id,
        direction: 'outbound',
        caller_number: normalizeOptionalString(input.caller_number) || 'unknown',
        called_number: normalizeOptionalString(input.called_number) || undefined,
        client_user_id: client?.id,
        status: input.event === 'answered' ? 'active' : 'connecting',
      });
    } catch (error) {
      if (!isCallLogSessionUniqueViolation(error)) {
        throw error;
      }
      log.warn('Service survey call log already exists during create race', {
        sessionId: input.session_id,
        event: input.event,
      });
      callLog = await getCallLogBySession(input.session_id);
    }
  }

  if (!callLog) {
    log.warn('Service survey result received without matching call log', {
      sessionId: input.session_id,
      event: input.event,
    });
    return { callLog: null, transcript: null };
  }

  let transcript: CallTranscript | null = null;
  if (input.transcript?.trim()) {
    const transcriptInput: CallTranscriptInput = {
      call_log_id: callLog.id,
      transcript_text: input.transcript.trim(),
      is_final: true,
      raw_payload: buildServiceSurveyRawPayload(input, occurredAt),
    };
    if (input.confidence !== undefined) transcriptInput.confidence = input.confidence;
    if (input.language_code) transcriptInput.language_code = input.language_code;
    if (input.recording_url) transcriptInput.recording_url = input.recording_url;
    transcript = await createCallTranscript(transcriptInput);
  }

  const updates: Partial<Pick<CallLog, 'status' | 'answered_at' | 'ended_at' | 'duration_seconds' | 'recording_url' | 'notes'>> = {};
  if (input.event === 'answered') {
    updates.status = 'active';
    updates.answered_at = occurredAt;
  } else if (input.event === 'completed') {
    updates.status = 'completed';
    updates.ended_at = occurredAt;
  } else if (input.event === 'failed') {
    updates.status = 'failed';
    updates.ended_at = occurredAt;
  } else if (input.event === 'no_answer') {
    updates.status = 'missed';
    updates.ended_at = occurredAt;
  }

  if (input.duration_seconds !== undefined) {
    updates.duration_seconds = input.duration_seconds;
  }
  if (input.recording_url) {
    updates.recording_url = input.recording_url;
  }

  const note = formatServiceSurveyNote(input, occurredAt);
  if (note) {
    updates.notes = appendCallNote(callLog.notes, note);
  }

  const updatedCallLog = await updateCallLogBySession(input.session_id, updates);
  return {
    callLog: updatedCallLog || callLog,
    transcript,
  };
}

const serviceSurveyResponsesFromClause = `
  FROM call_logs c
  LEFT JOIN users cu ON c.client_user_id = cu.id
  LEFT JOIN users ou ON c.operator_user_id = ou.id
  LEFT JOIN LATERAL (
    SELECT
      ct.id,
      ct.transcript_text,
      ct.confidence,
      ct.language_code,
      ct.recording_url,
      ct.created_at
    FROM call_transcripts ct
    WHERE ct.call_log_id = c.id
    ORDER BY ct.created_at DESC
    LIMIT 1
  ) latest_transcript ON TRUE
  LEFT JOIN LATERAL (
    SELECT cel.entity_id AS order_id
    FROM call_entity_links cel
    WHERE cel.call_log_id = c.id
      AND cel.entity_type = 'order'
    LIMIT 1
  ) order_link ON TRUE`;

export async function getServiceSurveyResponses(
  filters: ServiceSurveyResponseFilters,
): Promise<{ items: ServiceSurveyResponseRow[]; total: number }> {
  const where = [`c.voximplant_session_id LIKE 'service-survey-%'`];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (filters.status) {
    where.push(`c.status = $${paramIndex}`);
    values.push(filters.status);
    paramIndex++;
  }

  if (filters.from) {
    where.push(`c.started_at >= $${paramIndex}::date`);
    values.push(filters.from);
    paramIndex++;
  }

  if (filters.to) {
    where.push(`c.started_at < ($${paramIndex}::date + INTERVAL '1 day')`);
    values.push(filters.to);
    paramIndex++;
  }

  if (filters.q) {
    where.push(`(
      c.called_number ILIKE $${paramIndex}
      OR c.caller_number ILIKE $${paramIndex}
      OR c.notes ILIKE $${paramIndex}
      OR cu.display_name ILIKE $${paramIndex}
      OR ou.display_name ILIKE $${paramIndex}
      OR latest_transcript.transcript_text ILIKE $${paramIndex}
      OR order_link.order_id ILIKE $${paramIndex}
    )`);
    values.push(`%${filters.q}%`);
    paramIndex++;
  }

  const whereClause = `WHERE ${where.join(' AND ')}`;
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const countResult = await db.queryOne<ServiceSurveyResponseCountRow>(
    `SELECT COUNT(*)::text AS total
     ${serviceSurveyResponsesFromClause}
     ${whereClause}`,
    values,
  );

  const items = await db.query<ServiceSurveyResponseRow>(
    `SELECT
       c.id AS call_id,
       c.voximplant_session_id AS session_id,
       c.status,
       c.caller_number,
       c.called_number,
       c.client_user_id,
       cu.display_name AS client_name,
       c.operator_user_id,
       ou.display_name AS operator_name,
       c.started_at,
       c.answered_at,
       c.ended_at,
       c.duration_seconds,
       c.recording_url AS call_recording_url,
       c.notes,
       order_link.order_id,
       latest_transcript.id AS transcript_id,
       latest_transcript.transcript_text,
       latest_transcript.confidence::float8 AS confidence,
       latest_transcript.language_code,
       latest_transcript.recording_url AS transcript_recording_url,
       latest_transcript.created_at AS transcript_created_at
     ${serviceSurveyResponsesFromClause}
     ${whereClause}
     ORDER BY COALESCE(latest_transcript.created_at, c.ended_at, c.started_at) DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...values, limit, offset],
  );

  return {
    items,
    total: Number.parseInt(countResult?.total || '0', 10),
  };
}

export async function getServiceSurveyRecording(callId: string): Promise<ServiceSurveyRecordingRow | null> {
  return db.queryOne<ServiceSurveyRecordingRow>(
    `SELECT
       c.id AS call_id,
       COALESCE(latest_transcript.recording_url, c.recording_url) AS recording_url
     ${serviceSurveyResponsesFromClause}
     WHERE c.id = $1
       AND c.voximplant_session_id LIKE 'service-survey-%'
     LIMIT 1`,
    [callId],
  );
}

/**
 * Привязать звонок к сущности (задача/заказ/бронирование)
 */
export async function linkCallToEntity(callId: string, entityType: string, entityId: string): Promise<void> {
  await db.query(
    `INSERT INTO call_entity_links (call_log_id, entity_type, entity_id)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [callId, entityType, entityId]
  );
}

async function findLinkedCallbackTask(callLogId: string): Promise<LinkedTaskRow | null> {
  return db.queryOne<LinkedTaskRow>(
    `SELECT wt.id, wt.task_number, wt.title, wt.description, wt.status, wt.priority, wt.task_type,
            wt.client_name, wt.client_phone, wt.client_channel, wt.assigned_to, wt.assigned_studio_id,
            wt.metadata, wt.created_at, wt.updated_at
     FROM call_entity_links cel
     JOIN work_tasks wt ON wt.id::text = cel.entity_id
     WHERE cel.call_log_id = $1
       AND cel.entity_type = 'task'
       AND wt.task_type = 'callback'
     ORDER BY wt.created_at DESC
     LIMIT 1`,
    [callLogId],
  );
}

async function createMissedCallbackTask(
  callLog: CallLog,
  client: ClientLookupResult | null,
  input: MissedInboundCallInput,
): Promise<WorkTaskTelephonyRow> {
  const phone = normalizeOptionalString(input.caller_number) || normalizeOptionalString(callLog.caller_number);
  const title = phone ? `Перезвонить клиенту ${phone}` : 'Перезвонить по пропущенному входящему';
  const metadata: TaskMetadata = {
    source: 'voximplant_inbound',
    voximplantSessionId: input.session_id,
    callLogId: callLog.id,
    calledNumber: normalizeOptionalString(input.called_number || callLog.called_number || undefined) || undefined,
    reason: normalizeOptionalString(input.reason) || undefined,
    failureCode: input.failure_code,
    failureName: normalizeOptionalString(input.failure_name) || undefined,
    destinationUser: normalizeOptionalString(input.destination_user) || undefined,
    scenario: normalizeOptionalString(input.scenario) || undefined,
  };

  const task = await db.queryOne<WorkTaskTelephonyRow>(
    `INSERT INTO work_tasks (
       task_type, title, description, client_name, client_phone, client_channel, priority, metadata
     )
     VALUES ('callback', $1, $2, $3, $4, 'phone', 'urgent', $5)
     RETURNING id, task_number, title, description, status, priority, task_type,
               client_name, client_phone, client_channel, assigned_to, assigned_studio_id,
               metadata, created_at, updated_at`,
    [
      title,
      formatMissedCallDescription(phone, input.reason),
      client?.display_name || null,
      phone,
      JSON.stringify(metadata),
    ],
  );

  if (!task) {
    throw new Error('Failed to create missed call callback task');
  }

  await linkCallToEntity(callLog.id, 'task', task.id);
  broadcastToRoom('task:created', 'employee:dashboard', task);
  enqueueTaskInboxEvent(task, 'task_created');
  return task;
}

/**
 * Зафиксировать недозвон и создать задачу на обратный звонок.
 */
export async function recordMissedInboundCall(input: MissedInboundCallInput): Promise<MissedInboundCallResult> {
  const occurredAt = input.occurred_at || new Date().toISOString();
  const callerNumber = normalizeOptionalString(input.caller_number);
  const client = callerNumber ? await lookupClientByPhone(callerNumber) : null;
  const note = formatMissedCallNote(input, occurredAt);

  let callLog = await getCallLogBySession(input.session_id);

  if (!callLog) {
    callLog = await createOrUpdateInboundCallLog({
      voximplant_session_id: input.session_id,
      caller_number: callerNumber || 'unknown',
      called_number: normalizeOptionalString(input.called_number) || undefined,
      client_user_id: client?.id,
      status: 'missed',
    });
  }

  if (callLog.status === 'completed' || callLog.status === 'active') {
    return {
      callLog,
      client,
      taskId: null,
      taskNumber: null,
      createdTask: false,
    };
  }

  const updatedCallLog = await updateCallLogBySession(input.session_id, {
    status: 'missed',
    ended_at: occurredAt,
    duration_seconds: input.duration_seconds,
    notes: appendCallNote(callLog.notes, note),
  });
  callLog = updatedCallLog || callLog;

  const existingTask = await findLinkedCallbackTask(callLog.id);
  if (existingTask) {
    return {
      callLog,
      client,
      taskId: existingTask.id,
      taskNumber: existingTask.task_number,
      createdTask: false,
    };
  }

  const task = await createMissedCallbackTask(callLog, client, input);
  return {
    callLog,
    client,
    taskId: task.id,
    taskNumber: task.task_number,
    createdTask: true,
  };
}

async function findOpenVoipHealthTask(targetUser: string): Promise<WorkTaskTelephonyRow | null> {
  return db.queryOne<WorkTaskTelephonyRow>(
    `SELECT id, task_number, title, description, status, priority, task_type,
            client_name, client_phone, client_channel, assigned_to, assigned_studio_id,
            metadata, created_at, updated_at
     FROM work_tasks
     WHERE task_type = 'internal'
       AND status NOT IN ('completed', 'cancelled')
       AND metadata @> $1::jsonb
     ORDER BY created_at DESC
     LIMIT 1`,
    [JSON.stringify({ source: VOIP_HEALTH_METADATA_SOURCE, targetUser })],
  );
}

/**
 * Сводка последних недозвонов на конкретный Voximplant user.
 */
export async function getRecentVoipFailureSummary(
  targetUser: string,
  windowMinutes: number,
): Promise<RecentVoipFailureSummary> {
  const row = await db.queryOne<RecentVoipFailureRow>(
    `SELECT COUNT(*)::int AS failure_count, MAX(ended_at) AS last_failure_at
     FROM call_logs
     WHERE direction = 'inbound'
       AND status = 'missed'
       AND started_at >= NOW() - ($1::int * INTERVAL '1 minute')
       AND (
         notes ILIKE '%' || $2 || '%'
         OR notes ILIKE '%operator_unavailable%'
         OR notes ILIKE '%outgoing_failed%'
         OR notes ILIKE '%outgoing_timeout%'
         OR notes ILIKE '%voip_phone_unavailable%'
       )`,
    [windowMinutes, targetUser],
  );

  return {
    targetUser,
    windowMinutes,
    failureCount: Number(row?.failure_count || 0),
    lastFailureAt: row?.last_failure_at || null,
  };
}

/**
 * Текущий снимок здоровья входящей линии для UI/API.
 */
export async function getVoipPhoneHealthSnapshot(
  targetUser: string,
  windowMinutes: number,
): Promise<VoipPhoneHealthSnapshot> {
  const [recent, openIncident] = await Promise.all([
    getRecentVoipFailureSummary(targetUser, windowMinutes),
    findOpenVoipHealthTask(targetUser),
  ]);

  return {
    targetUser,
    windowMinutes,
    recentFailureCount: recent.failureCount,
    lastFailureAt: recent.lastFailureAt,
    openIncidentTaskId: openIncident?.id || null,
    openIncidentTaskNumber: openIncident?.task_number || null,
  };
}

/**
 * Создать или обновить внутреннюю срочную задачу по VoIP fail.
 */
export async function recordVoipHealthFailure(input: VoipHealthFailureInput): Promise<VoipHealthTaskResult> {
  const checkedAt = input.checkedAt || new Date().toISOString();
  const existing = await findOpenVoipHealthTask(input.targetUser);
  const metadata: TaskMetadata = {
    source: 'telephony_voip_health',
    targetUser: input.targetUser,
    reason: input.reason,
    firstFailedAt: existing?.metadata && 'firstFailedAt' in existing.metadata ? existing.metadata.firstFailedAt : checkedAt,
    lastFailedAt: checkedAt,
    checkedAt,
    windowMinutes: input.windowMinutes,
    failureCount: input.failureCount,
    lastFailureAt: input.lastFailureAt,
    userActive: input.userActive,
  };
  const description = formatVoipIncidentDescription(input, checkedAt);

  if (existing) {
    const updated = await db.queryOne<WorkTaskTelephonyRow>(
      `UPDATE work_tasks
       SET description = $1,
           priority = 'urgent',
           metadata = $2,
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, task_number, title, description, status, priority, task_type,
                 client_name, client_phone, client_channel, assigned_to, assigned_studio_id,
                 metadata, created_at, updated_at`,
      [description, JSON.stringify(metadata), existing.id],
    );

    const task = updated || existing;
    broadcastToRoom('task:updated', 'employee:dashboard', task);
    enqueueTaskInboxEvent(task, 'task_updated');

    return {
      taskId: task.id,
      taskNumber: task.task_number,
      createdTask: false,
    };
  }

  const task = await db.queryOne<WorkTaskTelephonyRow>(
    `INSERT INTO work_tasks (
       task_type, title, description, client_channel, priority, metadata
     )
     VALUES ('internal', 'Проверить VoIP-телефон Соборный', $1, 'phone', 'urgent', $2)
     RETURNING id, task_number, title, description, status, priority, task_type,
               client_name, client_phone, client_channel, assigned_to, assigned_studio_id,
               metadata, created_at, updated_at`,
    [description, JSON.stringify(metadata)],
  );

  if (!task) {
    throw new Error('Failed to create VoIP health incident task');
  }

  broadcastToRoom('task:created', 'employee:dashboard', task);
  enqueueTaskInboxEvent(task, 'task_created');

  return {
    taskId: task.id,
    taskNumber: task.task_number,
    createdTask: true,
  };
}

/**
 * Автоматически закрыть внутренний инцидент, когда контрольная проверка снова зеленая.
 */
export async function recordVoipHealthRecovery(targetUser: string, checkedAt = new Date().toISOString()): Promise<boolean> {
  const existing = await findOpenVoipHealthTask(targetUser);
  if (!existing) return false;

  const recoveredMetadata: TaskMetadata = existing.metadata
    && 'source' in existing.metadata
    && existing.metadata.source === 'telephony_voip_health'
    ? { ...existing.metadata, checkedAt, recoveredAt: checkedAt }
    : existing.metadata || {};

  const updated = await db.queryOne<WorkTaskTelephonyRow>(
    `UPDATE work_tasks
     SET status = 'completed',
         completed_at = NOW(),
         description = $1,
         metadata = $2,
         updated_at = NOW()
     WHERE id = $3
     RETURNING id, task_number, title, description, status, priority, task_type,
               client_name, client_phone, client_channel, assigned_to, assigned_studio_id,
               metadata, created_at, updated_at`,
    [
      appendCallNote(existing.description, `[${checkedAt}] Автопроверка: VoIP user ${targetUser} снова доступен.`),
      JSON.stringify(recoveredMetadata),
      existing.id,
    ],
  );

  if (updated) {
    broadcastToRoom('task:updated', 'employee:dashboard', updated);
    enqueueCrmEvent('task', updated.id, 'task_completed', undefined, true)
      .catch((error: unknown) => log.warn('Failed to remove recovered VoIP incident from inbox', {
        taskId: updated.id,
        error: String(error),
      }));
  }

  return true;
}

/**
 * История звонков с фильтрами
 */
export async function getCallHistory(filters: {
  phone?: string;
  operator_id?: string;
  client_id?: string;
  direction?: string;
  limit?: number;
  offset?: number;
}): Promise<{ calls: CallLog[]; total: number }> {
  const where: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (filters.phone) {
    const digits = filters.phone.replace(/\D/g, '').slice(-10);
    where.push(`(c.caller_number LIKE '%' || $${paramIndex} OR c.called_number LIKE '%' || $${paramIndex})`);
    values.push(digits);
    paramIndex++;
  }
  if (filters.operator_id) {
    where.push(`c.operator_user_id = $${paramIndex}`);
    values.push(filters.operator_id);
    paramIndex++;
  }
  if (filters.client_id) {
    where.push(`c.client_user_id = $${paramIndex}`);
    values.push(filters.client_id);
    paramIndex++;
  }
  if (filters.direction) {
    where.push(`c.direction = $${paramIndex}`);
    values.push(filters.direction);
    paramIndex++;
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const countResult = await db.queryOne<CountRow>(
    `SELECT COUNT(*) as cnt FROM call_logs c ${whereClause}`,
    values
  );

  const calls = await db.query<CallLog>(
    `SELECT c.*,
       cu.display_name as client_name,
       ou.display_name as operator_name
     FROM call_logs c
     LEFT JOIN users cu ON c.client_user_id = cu.id
     LEFT JOIN users ou ON c.operator_user_id = ou.id
     ${whereClause}
     ORDER BY c.started_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...values, limit, offset]
  );

  return {
    calls,
    total: parseInt(countResult?.cnt || '0', 10),
  };
}

/**
 * Получить звонок по ID с привязанными сущностями
 */
export async function getCallById(callId: string): Promise<(CallLog & { links: { entity_type: string; entity_id: string }[] }) | null> {
  const call = await db.queryOne<CallLog>(
    `SELECT c.*,
       cu.display_name as client_name,
       ou.display_name as operator_name
     FROM call_logs c
     LEFT JOIN users cu ON c.client_user_id = cu.id
     LEFT JOIN users ou ON c.operator_user_id = ou.id
     WHERE c.id = $1`,
    [callId]
  );

  if (!call) return null;

  const links = await db.query<CallEntityLinkRow>(
    `SELECT entity_type, entity_id FROM call_entity_links WHERE call_log_id = $1`,
    [callId]
  );

  return { ...call, links };
}

/**
 * Переключить звонок на другого оператора (Voximplant Management API)
 * Проверяет что оператор на смене или accept_calls = true
 */
export async function transferCall(callId: string, toEmployeeId: string): Promise<void> {
  // Проверяем что цель звонка доступна (на смене или принимает звонки)
  const operator = await db.queryOne<OperatorAvailabilityRow>(
    `SELECT u.id, u.display_name, u.accept_calls,
       CASE WHEN ps.id IS NOT NULL THEN true ELSE false END as on_shift
     FROM users u
     LEFT JOIN pos_shifts ps ON ps.employee_id = u.id AND ps.status = 'open'
     WHERE u.id = $1`,
    [toEmployeeId]
  );

  if (!operator) throw new Error('Оператор не найден');
  if (!operator.on_shift && !operator.accept_calls) {
    throw new Error('Оператор недоступен (не на смене и не принимает звонки)');
  }

  // Обновляем оператора в call_log
  await db.query(
    `UPDATE call_logs SET operator_user_id = $1 WHERE id = $2`,
    [toEmployeeId, callId]
  );

  // NOTE: Прямой вызов Voximplant Management API для переключения звонка
  // требует реализации voxapi.transferCall(sessionId, voximplantUser)
  // Это зависит от конфигурации VoxEngine сценария на стороне Voximplant.
  // Текущая реализация: обновляем БД, фронтенд реагирует через Socket.IO.
}

/**
 * Получить список доступных операторов (на смене или accept_calls = true)
 */
export async function getAvailableOperators(): Promise<{
  id: string;
  display_name: string | null;
  role: string;
  on_shift: boolean;
  accept_calls: boolean;
}[]> {
  return db.query(
    `SELECT u.id, u.display_name, u.role, u.accept_calls,
       CASE WHEN ps.id IS NOT NULL THEN true ELSE false END as on_shift
     FROM users u
     LEFT JOIN pos_shifts ps ON ps.employee_id = u.id AND ps.status = 'open'
     WHERE u.role IN ('admin', 'manager', 'employee')
       AND (ps.id IS NOT NULL OR u.accept_calls = true)
     ORDER BY on_shift DESC, u.display_name ASC`
  );
}
