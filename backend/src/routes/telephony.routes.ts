/**
 * Telephony Routes — API для Voximplant телефонии
 *
 * POST /incoming-call     — VoxEngine webhook: входящий звонок
 * POST /call              — Click-to-call (JWT)
 * POST /call-event        — VoxEngine webhook: события звонка
 * POST /voice-otp/event  — VoxEngine webhook: события voice OTP звонка
 * POST /service-survey/call — Запуск звонка-опроса после услуги (JWT)
 * POST /service-survey/result — VoxEngine webhook: запись/расшифровка опроса
 * POST /service-survey/turn — VoxEngine webhook: ход разговорного опроса (реплика+озвучка)
 * GET  /service-survey/responses — Расшифровки звонков-опросов (JWT)
 * GET  /service-survey/responses/:callId/recording — Запись звонка-опроса (JWT)
 * GET  /calls             — История звонков (JWT)
 * GET  /calls/:id         — Детали звонка (JWT)
 * POST /calls/:id/link    — Привязать звонок к сущности (JWT)
 * POST /calls/:id/recording — Загрузить запись звонка (JWT)
 */
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticateToken, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { verifyVoximplantWebhook } from '../middleware/voximplant-webhook-auth.js';
import {
  telephonyIncomingCallsTotal,
  telephonyMissedCallsTotal,
  telephonyCallEventsTotal,
  telephonyServiceSurveyTotal,
  asrEmptyTranscriptTotal,
  voiceOtpCallsTotal,
} from '../services/metrics.service.js';
import * as telephonyService from '../services/telephony.service.js';
import { getStudiosEffectiveStatus } from '../services/studio-status.service.js';
import { recordPhoneOtpEventSafely } from '../services/phone-otp-event.service.js';
import { startVoximplantStudioClickToCall } from '../services/voximplant.service.js';
import { createOpenAiRealtimeClientSecret } from '../services/openai-realtime.service.js';
import { createUploadLimiter } from '../middleware/upload-limiter.js';
import { broadcastToRoom } from '../websocket/broadcast-to-room.js';
import {
  getTelephonyVoipHealthSnapshot,
  runTelephonyVoipHealthCheckOnce,
} from '../services/telephony-voip-health-monitor.service.js';
import {
  enqueueServiceSurveyCall,
  scheduleNextQueuedServiceSurveyCall,
  ServiceSurveyCallStartError,
  type EnqueueServiceSurveyCallResult,
} from '../services/service-survey-call-queue.service.js';
import { runSurveyTurn } from '../services/service-survey-turn.service.js';
import { runServiceSurveyRealtimeTool } from '../services/service-survey-realtime-tools.service.js';
import { fetchWithTimeout } from '../utils/fetch-timeout.js';
import { createLogger } from '../utils/logger.js';
import { maskPhone } from '../utils/mask-phone.js';
import type { PhoneOtpEventDetailsJsonb } from '../types/jsonb/phone-otp-event-jsonb.js';

const router = Router();
const log = createLogger('telephony-routes');
const LOCAL_RECORDING_PREFIX = '/uploads/recordings/';
const LOCAL_RECORDING_DIR = path.resolve(process.cwd(), 'uploads', 'recordings');
const RECORDING_PROXY_TIMEOUT_MS = 30_000;
const RECORDING_PROXY_MAX_REDIRECTS = 5;
const RECORDING_RESPONSE_HEADERS = [
  'accept-ranges',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'last-modified',
] as const;

type CallEventUpdates = Partial<Pick<telephonyService.CallLog, 'status' | 'answered_at' | 'ended_at' | 'duration_seconds' | 'operator_user_id' | 'recording_url' | 'notes'>>;

function firstQueryString(value: unknown): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== 'string') return undefined;
  const trimmed = candidate.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized.endsWith('.internal');
}

function isBlockedIpAddress(address: string): boolean {
  const normalized = normalizeHostname(address);
  const mappedIpv4 = normalized.match(/(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedIpv4?.[1]) {
    return isBlockedIpAddress(mappedIpv4[1]);
  }

  const version = isIP(normalized);
  if (version === 4) {
    const parts = normalized.split('.').map(part => Number.parseInt(part, 10));
    const first = parts[0] ?? 0;
    const second = parts[1] ?? 0;
    return first === 0
      || first === 10
      || first === 127
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 198 && (second === 18 || second === 19))
      || first >= 224;
  }

  if (version === 6) {
    if (normalized === '::' || normalized === '::1') return true;
    const firstHextet = Number.parseInt(normalized.split(':')[0] || '0', 16);
    if (!Number.isFinite(firstHextet)) return true;
    return (firstHextet & 0xfe00) === 0xfc00
      || (firstHextet & 0xffc0) === 0xfe80
      || (firstHextet & 0xff00) === 0xff00;
  }

  return false;
}

async function assertPublicRecordingHost(hostname: string): Promise<void> {
  const normalized = normalizeHostname(hostname);
  if (isBlockedHostname(normalized) || isBlockedIpAddress(normalized)) {
    throw new AppError(400, 'Неподдерживаемый адрес записи');
  }

  let records: { address: string }[];
  try {
    records = await lookup(normalized, { all: true, verbatim: false });
  } catch (error) {
    log.warn('Recording host lookup failed', {
      host: normalized,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new AppError(502, 'Не удалось проверить адрес записи');
  }

  if (!records.length || records.some(record => isBlockedIpAddress(record.address))) {
    throw new AppError(400, 'Неподдерживаемый адрес записи');
  }
}

async function parseExternalRecordingUrl(recordingUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(recordingUrl);
  } catch {
    throw new AppError(400, 'Некорректный адрес записи');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError(400, 'Неподдерживаемый адрес записи');
  }
  if (parsed.username || parsed.password) {
    throw new AppError(400, 'Неподдерживаемый адрес записи');
  }

  await assertPublicRecordingHost(parsed.hostname);
  return parsed;
}

function resolveLocalRecordingPath(recordingUrl: string): string | null {
  if (!recordingUrl.startsWith(LOCAL_RECORDING_PREFIX)) return null;

  let pathname: string;
  try {
    pathname = new URL(recordingUrl, 'http://local').pathname;
  } catch {
    return null;
  }

  if (!pathname.startsWith(LOCAL_RECORDING_PREFIX)) return null;

  let fileName: string;
  try {
    fileName = decodeURIComponent(pathname.slice(LOCAL_RECORDING_PREFIX.length));
  } catch {
    return null;
  }

  if (!fileName || fileName.includes('/') || fileName.includes('\\')) return null;
  const filePath = path.resolve(LOCAL_RECORDING_DIR, fileName);
  if (!filePath.startsWith(`${LOCAL_RECORDING_DIR}${path.sep}`)) return null;
  return filePath;
}

async function fetchExternalRecordingResponse(
  recordingUrl: string,
  requestHeaders: Headers,
): Promise<globalThis.Response> {
  let currentUrl = await parseExternalRecordingUrl(recordingUrl);

  for (let redirectCount = 0; redirectCount <= RECORDING_PROXY_MAX_REDIRECTS; redirectCount++) {
    let response: globalThis.Response;
    try {
      response = await fetchWithTimeout(currentUrl.toString(), {
        method: 'GET',
        headers: requestHeaders,
        redirect: 'manual',
        timeout: RECORDING_PROXY_TIMEOUT_MS,
      });
    } catch (error) {
      log.warn('Recording fetch failed', {
        host: normalizeHostname(currentUrl.hostname),
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError(502, 'Не удалось получить запись звонка');
    }

    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location) return response;
    currentUrl = await parseExternalRecordingUrl(new URL(location, currentUrl).toString());
  }

  throw new AppError(502, 'Слишком много перенаправлений при получении записи');
}

function setUpstreamAudioHeaders(upstream: globalThis.Response, res: Response): void {
  for (const header of RECORDING_RESPONSE_HEADERS) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }
  if (!upstream.headers.has('content-type')) {
    res.setHeader('Content-Type', 'audio/mpeg');
  }
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Content-Disposition', 'inline');
}

function waitForResponseDrain(res: Response): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    function cleanup(): void {
      res.off('drain', handleDrain);
      res.off('error', handleError);
    }
    function handleDrain(): void {
      cleanup();
      resolve();
    }
    function handleError(error: Error): void {
      cleanup();
      reject(error);
    }
    res.once('drain', handleDrain);
    res.once('error', handleError);
  });
}

async function pipeRecordingBody(body: ReadableStream<Uint8Array>, res: Response): Promise<void> {
  const reader = body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!res.write(chunk.value)) {
        await waitForResponseDrain(res);
      }
    }
    res.end();
  } catch (error) {
    if (!res.headersSent) throw error;
    const streamError = error instanceof Error ? error : new Error(String(error));
    log.warn('Recording stream failed', { error: streamError.message });
    res.destroy(streamError);
  } finally {
    reader.releaseLock();
  }
}

async function streamExternalRecording(recordingUrl: string, req: Request, res: Response): Promise<void> {
  const requestHeaders = new Headers();
  const range = req.headers.range;
  if (typeof range === 'string') {
    requestHeaders.set('Range', range);
  }

  const upstream = await fetchExternalRecordingResponse(recordingUrl, requestHeaders);
  if (!upstream.ok && upstream.status !== 416) {
    log.warn('Recording upstream returned non-success status', { status: upstream.status });
    throw new AppError(upstream.status === 404 ? 404 : 502, 'Не удалось получить запись звонка');
  }

  res.status(upstream.status);
  setUpstreamAudioHeaders(upstream, res);
  if (!upstream.body) {
    res.end();
    return;
  }

  await pipeRecordingBody(upstream.body, res);
}

function blankBodyValueToUndefined(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}

const optionalBodyNumber = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}, z.number().int().nonnegative().optional());

const optionalBodyFloat = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}, z.number().nonnegative().optional());

const optionalBodyIdentifier = z.preprocess(
  blankBodyValueToUndefined,
  z.union([z.string().trim().min(1), z.number().finite()]).optional(),
);

function optionalBodyString(maxLength: number): z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown> {
  return z.preprocess(
    blankBodyValueToUndefined,
    z.string().trim().min(1).max(maxLength).optional(),
  );
}

const incomingCallWebhookSchema = z.object({
  caller_number: z.string().trim().min(1),
  called_number: z.string().trim().min(1).optional(),
  session_id: z.string().trim().min(1),
}).passthrough();

const callEventWebhookSchema = z.object({
  session_id: z.string().trim().min(1),
  event: z.enum(['answered', 'ended', 'missed', 'failed']),
  operator_user_id: z.string().trim().min(1).optional(),
  duration_seconds: optionalBodyNumber,
  caller_number: z.string().trim().min(1).optional(),
  called_number: z.string().trim().min(1).optional(),
  reason: z.string().trim().min(1).optional(),
  failure_code: optionalBodyNumber,
  failure_name: z.string().trim().min(1).optional(),
  scenario: z.string().trim().min(1).optional(),
  destination_user: z.string().trim().min(1).optional(),
  occurred_at: z.string().trim().min(1).optional(),
}).passthrough();

const voiceOtpEventWebhookSchema = z.object({
  type: z.literal('voice_otp_event'),
  event: z.enum([
    'started',
    'ringing',
    'audio_started',
    'first_audio_packet',
    'connected',
    'playback_ready',
    'playback_started',
    'playback_finished',
    'hangup_requested',
    'timeout',
    'failed',
    'disconnected',
    'terminate',
    'invalid_custom_data',
  ]),
  sessionId: optionalBodyIdentifier,
  callId: optionalBodyIdentifier,
  destination: optionalBodyString(100),
  callerId: optionalBodyString(100),
  eventCode: optionalBodyNumber,
  sipCode: optionalBodyNumber,
  internalCode: optionalBodyNumber,
  duration: optionalBodyFloat,
  successful: z.boolean().optional(),
  reason: optionalBodyString(500),
  timestamp: optionalBodyString(100),
  details: z.unknown().optional(),
}).passthrough();

const startCallSchema = z.object({
  phone: z.string().trim().min(1),
}).strict();

const serviceSurveyCallSchema = z.object({
  phone: z.string().trim().min(1),
  order_id: z.string().uuid().optional(),
  client_id: z.string().uuid().optional(),
}).strict();

const serviceSurveyResultWebhookSchema = z.object({
  session_id: z.string().trim().min(1),
  event: z.enum(['answered', 'completed', 'failed', 'no_answer', 'transcript', 'recording']),
  caller_number: z.string().trim().min(1).optional(),
  called_number: z.string().trim().min(1).optional(),
  duration_seconds: optionalBodyNumber,
  reason: z.string().trim().min(1).optional(),
  failure_code: optionalBodyNumber,
  failure_name: z.string().trim().min(1).optional(),
  occurred_at: z.string().trim().min(1).optional(),
  question: z.string().trim().min(1).optional(),
  transcript: z.string().trim().min(1).optional(),
  confidence: optionalBodyFloat,
  language_code: z.string().trim().min(1).optional(),
  recording_url: z.string().trim().min(1).optional(),
}).passthrough();

// Разговорный опрос: один ход диалога. VoxEngine присылает накопленную историю
// реплик и индекс хода; backend возвращает следующую реплику бота + URL её озвучки.
// Лимиты согласованы с maxTurns (короткие голосовые реплики): history <= 16 (8 ходов
// бот+клиент), text <= 1000 символов, turn_index <= 50 — режем раздувание запроса/abuse.
const serviceSurveyTurnSchema = z.object({
  session_id: z.string().trim().min(1).max(200),
  turn_index: z.coerce.number().int().min(0).max(50),
  history: z.array(z.object({
    role: z.enum(['bot', 'client']),
    text: z.string().trim().min(1).max(1000),
  })).max(16).default([]),
}).strict();

const serviceSurveyToolSchema = z.object({
  session_id: z.string().trim().min(1).max(200),
  tool_name: z.string().trim().min(1).max(120),
  arguments: z.string().max(12000).default('{}'),
  caller_number: z.string().trim().min(1).max(100).optional(),
  called_number: z.string().trim().min(1).max(100).optional(),
}).strict();

const serviceSurveyResponsesQuerySchema = z.object({
  q: z.preprocess(firstQueryString, z.string().max(200).optional()),
  status: z.preprocess(
    firstQueryString,
    z.enum(['queued', 'connecting', 'ringing', 'active', 'completed', 'missed', 'failed']).optional(),
  ),
  from: z.preprocess(firstQueryString, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  to: z.preprocess(firstQueryString, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  limit: z.preprocess((value) => {
    const candidate = firstQueryString(value);
    if (!candidate) return undefined;
    const parsed = Number.parseInt(candidate, 10);
    return Number.isFinite(parsed) ? parsed : value;
  }, z.number().int().min(1).max(100).optional()),
  offset: z.preprocess((value) => {
    const candidate = firstQueryString(value);
    if (!candidate) return undefined;
    const parsed = Number.parseInt(candidate, 10);
    return Number.isFinite(parsed) ? parsed : value;
  }, z.number().int().min(0).optional()),
}).strict();

const callHistoryQuerySchema = z.object({
  phone: z.preprocess(firstQueryString, z.string().optional()),
  operator_id: z.preprocess(firstQueryString, z.string().optional()),
  client_id: z.preprocess(firstQueryString, z.string().optional()),
  direction: z.preprocess(firstQueryString, z.enum(['inbound', 'outbound']).optional()),
  limit: z.preprocess((value) => {
    const candidate = firstQueryString(value);
    if (!candidate) return undefined;
    const parsed = Number.parseInt(candidate, 10);
    return Number.isFinite(parsed) ? parsed : value;
  }, z.number().int().min(1).max(200).optional()),
  offset: z.preprocess((value) => {
    const candidate = firstQueryString(value);
    if (!candidate) return undefined;
    const parsed = Number.parseInt(candidate, 10);
    return Number.isFinite(parsed) ? parsed : value;
  }, z.number().int().min(0).optional()),
}).strict();

const openAiRealtimeTokenSchema = z.object({
  model: z.string().trim().min(1).max(200).optional(),
  voice: z.string().trim().min(1).max(100).optional(),
  instructions: z.string().trim().min(1).max(12000).optional(),
  outputModalities: z.array(z.enum(['audio', 'text'])).min(1).max(2).optional(),
  ttlSeconds: z.number().int().min(10).max(7200).optional(),
}).strict().refine(
  value => !value.voice || value.outputModalities === undefined || value.outputModalities.includes('audio'),
  {
    path: ['outputModalities'],
    message: 'audio modality is required when voice is provided',
  },
);

type SanitizedVoiceOtpLogValue = string | number | boolean | string[];

interface VoiceOtpEventDetailsInput {
  code?: unknown;
  reason?: unknown;
  internalCode?: unknown;
  duration?: unknown;
  cost?: unknown;
  successful?: unknown;
  headerNames?: unknown;
  error?: unknown;
}

interface SanitizedVoiceOtpEventDetails {
  code?: SanitizedVoiceOtpLogValue;
  reason?: SanitizedVoiceOtpLogValue;
  internalCode?: SanitizedVoiceOtpLogValue;
  duration?: SanitizedVoiceOtpLogValue;
  cost?: SanitizedVoiceOtpLogValue;
  successful?: SanitizedVoiceOtpLogValue;
  headerNames?: SanitizedVoiceOtpLogValue;
  error?: SanitizedVoiceOtpLogValue;
}

// Multer для загрузки записей
const recordingStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(process.cwd(), 'uploads', 'recordings');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.webm';
    cb(null, `call-${Date.now()}${ext}`);
  },
});
const uploadRecording = multer({
  storage: recordingStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['audio/webm', 'audio/ogg', 'audio/mp3', 'audio/mpeg', 'audio/wav'];
    cb(null, allowed.includes(file.mimetype));
  },
});

function isVoiceOtpEventDetailsInput(value: unknown): value is VoiceOtpEventDetailsInput {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeLogText(value: string): string {
  return value.replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone]');
}

function timingSafeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function hasTrustedVoximplantLegacySecret(req: Request): boolean {
  const expected = config.voximplant.webhook.secret;
  if (!expected) return false;
  const provided = req.get('x-svf-voximplant-secret') || req.get('x-voximplant-secret');
  return typeof provided === 'string' && timingSafeEqualText(provided, expected);
}

function sanitizeVoiceOtpLogValue(value: unknown): SanitizedVoiceOtpLogValue | undefined {
  if (typeof value === 'string') return sanitizeLogText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .slice(0, 30)
      .map(sanitizeLogText);
  }
  return undefined;
}

function assignSanitizedVoiceOtpLogValue(
  target: SanitizedVoiceOtpEventDetails,
  key: keyof SanitizedVoiceOtpEventDetails,
  value: unknown,
): void {
  const sanitized = sanitizeVoiceOtpLogValue(value);
  if (sanitized !== undefined) {
    target[key] = sanitized;
  }
}

function sanitizeVoiceOtpEventDetails(details: unknown): SanitizedVoiceOtpEventDetails | undefined {
  if (!isVoiceOtpEventDetailsInput(details)) return undefined;

  const sanitized: SanitizedVoiceOtpEventDetails = {};
  assignSanitizedVoiceOtpLogValue(sanitized, 'code', details.code);
  assignSanitizedVoiceOtpLogValue(sanitized, 'reason', details.reason);
  assignSanitizedVoiceOtpLogValue(sanitized, 'internalCode', details.internalCode);
  assignSanitizedVoiceOtpLogValue(sanitized, 'duration', details.duration);
  assignSanitizedVoiceOtpLogValue(sanitized, 'cost', details.cost);
  assignSanitizedVoiceOtpLogValue(sanitized, 'successful', details.successful);
  assignSanitizedVoiceOtpLogValue(sanitized, 'headerNames', details.headerNames);
  assignSanitizedVoiceOtpLogValue(sanitized, 'error', details.error);

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function stringifyVoiceOtpWebhookIdentifier(value: string | number | undefined): string | undefined {
  return value !== undefined ? String(value) : undefined;
}

function assignDefinedPhoneOtpDetail(
  target: PhoneOtpEventDetailsJsonb,
  key: string,
  value: unknown,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

async function recordVoiceOtpWebhookDiagnosticEvent(
  eventData: z.infer<typeof voiceOtpEventWebhookSchema>,
  sanitizedEventDetails: SanitizedVoiceOtpEventDetails | undefined,
): Promise<void> {
  if (!eventData.destination) return;

  const sessionId = stringifyVoiceOtpWebhookIdentifier(eventData.sessionId);
  const callId = stringifyVoiceOtpWebhookIdentifier(eventData.callId);
  const diagnosticDetails: PhoneOtpEventDetailsJsonb = {
    event: eventData.event,
  };

  assignDefinedPhoneOtpDetail(diagnosticDetails, 'sessionId', sessionId);
  assignDefinedPhoneOtpDetail(diagnosticDetails, 'callId', callId);
  assignDefinedPhoneOtpDetail(diagnosticDetails, 'eventCode', eventData.eventCode);
  assignDefinedPhoneOtpDetail(diagnosticDetails, 'sipCode', eventData.sipCode);
  assignDefinedPhoneOtpDetail(diagnosticDetails, 'internalCode', eventData.internalCode);
  assignDefinedPhoneOtpDetail(diagnosticDetails, 'duration', eventData.duration);
  assignDefinedPhoneOtpDetail(diagnosticDetails, 'successful', eventData.successful);
  assignDefinedPhoneOtpDetail(
    diagnosticDetails,
    'reason',
    eventData.reason ? sanitizeLogText(eventData.reason) : undefined,
  );
  assignDefinedPhoneOtpDetail(diagnosticDetails, 'timestamp', eventData.timestamp);
  assignDefinedPhoneOtpDetail(diagnosticDetails, 'eventDetails', sanitizedEventDetails);

  await recordPhoneOtpEventSafely({
    phone: eventData.destination,
    eventType: 'voximplant_webhook_event',
    provider: 'voximplant',
    providerRequestId: sessionId ?? null,
    callSessionHistoryId: sessionId ?? null,
    callerId: eventData.callerId ?? null,
    details: diagnosticDetails,
  });
}

// ============================================================
// VoxEngine webhooks (без аутентификации)
// ============================================================

/**
 * POST /incoming-call — входящий звонок от VoxEngine
 */
router.post('/incoming-call', verifyVoximplantWebhook('incoming-call'), async (req: Request, res: Response) => {
  const parsed = incomingCallWebhookSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.message);
  const { caller_number, called_number, session_id } = parsed.data;
  telephonyIncomingCallsTotal.inc();

  // Поиск клиента
  const client = await telephonyService.lookupClientByPhone(caller_number);

  // Создать или обновить запись звонка без дублей
  const callLog = await telephonyService.createOrUpdateInboundCallLog({
    voximplant_session_id: session_id,
    caller_number,
    called_number,
    client_user_id: client?.id,
  });

  broadcastToRoom('telephony:incoming_call', 'employee:dashboard', {
    callId: callLog.id,
    callerNumber: caller_number,
    clientName: client?.display_name || null,
    clientId: client?.id || null,
    ordersCount: client?.orders_count || 0,
    sessionId: session_id,
    calledNumber: called_number || null,
  });

  res.json({
    success: true,
    client_name: client?.display_name || null,
    client_id: client?.id || null,
    call_id: callLog.id,
  });
});

/**
 * GET /intercom-route — эффективная маршрутизация внутренних номеров для
 * сценария internal-intercom. Баррикадная закрыта, поэтому оба коротких номера
 * ведут на открытую точку (Соборный). Возвращает простую карту
 * { route: { "1": "soborny101", "2": "soborny101" } }.
 *
 * Статус студии публичен (он же на сайте), поэтому эндпоинт неприватный
 * (verifyVoximplantWebhook в режиме dual-accept пропускает неподписанный GET от
 * сценария, как и существующие webhook'и).
 */
const INTERCOM_BASE_ROUTING = [
  { ext: '1', locationCode: 'soborny', sip: 'soborny101' },
  { ext: '2', locationCode: 'soborny', sip: 'soborny101' },
] as const;

router.get('/intercom-route', verifyVoximplantWebhook('intercom-route'), async (_req: Request, res: Response) => {
  let openLocationCodes = new Set<string>();
  try {
    const studios = await getStudiosEffectiveStatus();
    openLocationCodes = new Set(
      studios.filter(s => s.status === 'open' && s.location_code).map(s => s.location_code as string),
    );
  } catch {
    // При сбое БД не ломаем интерком: отдаём базовую карту (каждый номер на свою
    // студию), сценарий и так умеет фолбэкать на статику.
    openLocationCodes = new Set(INTERCOM_BASE_ROUTING.map(b => b.locationCode));
  }

  // SIP открытой точки с приоритетом по порядку INTERCOM_BASE_ROUTING (Соборный первый).
  const openSip = INTERCOM_BASE_ROUTING.find(b => openLocationCodes.has(b.locationCode))?.sip ?? null;

  const route: Record<string, string> = {};
  for (const b of INTERCOM_BASE_ROUTING) {
    route[b.ext] = openLocationCodes.has(b.locationCode) ? b.sip : (openSip ?? b.sip);
  }
  res.json({ route });
});

/**
 * POST /call-event — события звонка от VoxEngine (answered, ended)
 */
router.post('/call-event', verifyVoximplantWebhook('call-event'), async (req: Request, res: Response) => {
  const parsed = callEventWebhookSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.message);
  const {
    session_id,
    event,
    operator_user_id,
    duration_seconds,
    caller_number,
    called_number,
    reason,
    failure_code,
    failure_name,
    scenario,
    destination_user,
    occurred_at,
  } = parsed.data;
  telephonyCallEventsTotal.inc({ event });

  if (event === 'missed') {
    telephonyMissedCallsTotal.inc({ reason: failure_name || 'unknown' });
    const result = await telephonyService.recordMissedInboundCall({
      session_id,
      caller_number,
      called_number,
      reason,
      failure_code,
      failure_name,
      duration_seconds,
      scenario,
      destination_user,
      occurred_at,
    });

    broadcastToRoom('telephony:call_event', 'employee:dashboard', {
      callId: result.callLog.id,
      event,
      status: result.callLog.status,
      taskId: result.taskId,
      taskNumber: result.taskNumber,
      createdTask: result.createdTask,
      reason: reason || null,
    });

    res.json({
      success: true,
      data: {
        call_id: result.callLog.id,
        task_id: result.taskId,
        task_number: result.taskNumber,
        created_task: result.createdTask,
      },
    });
    return;
  }

  const updates: CallEventUpdates = {};
  const occurredAt = occurred_at || new Date().toISOString();

  if (event === 'answered') {
    updates['status'] = 'active';
    updates['answered_at'] = occurredAt;
    if (operator_user_id) updates['operator_user_id'] = operator_user_id;
  } else if (event === 'ended') {
    updates['status'] = 'completed';
    updates['ended_at'] = occurredAt;
    if (duration_seconds !== undefined) updates['duration_seconds'] = duration_seconds;
  } else if (event === 'failed') {
    updates['status'] = 'failed';
    updates['ended_at'] = occurredAt;
    if (duration_seconds !== undefined) updates['duration_seconds'] = duration_seconds;
    updates['notes'] = [
      `[${occurredAt}] Voximplant call failed`,
      reason ? `reason=${reason}` : null,
      failure_code !== undefined ? `code=${failure_code}` : null,
      failure_name ? `failure=${failure_name}` : null,
      scenario ? `scenario=${scenario}` : null,
      destination_user ? `destination=${destination_user}` : null,
    ].filter((part): part is string => Boolean(part)).join(', ');
  }

  const callLog = await telephonyService.updateCallLogBySession(session_id, updates);

  if (callLog) {
    broadcastToRoom('telephony:call_event', 'employee:dashboard', {
      callId: callLog.id,
      event,
      status: callLog.status,
    });
  }

  res.json({ success: true });
});

/**
 * POST /voice-otp/event — диагностические события flash-call OTP от VoxEngine.
 */
router.post('/voice-otp/event', verifyVoximplantWebhook('voice-otp-event'), async (req: Request, res: Response) => {
  const parsed = voiceOtpEventWebhookSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.message);

  const {
    event,
    sessionId,
    callId,
    destination,
    callerId,
    eventCode,
    sipCode,
    internalCode,
    duration,
    successful,
    reason,
    timestamp,
    details,
  } = parsed.data;
  const sanitizedDetails = sanitizeVoiceOtpEventDetails(details);

  // Метрики жизненного цикла: 'spoke' = робот реально начал проигрывать код,
  // 'failed' = звонок упал/таймаут. Кросс-проверка «connected без spoke» —
  // через PromQL (см. deploy-configs/prometheus-telephony-alerts.yml).
  if (event === 'playback_started') {
    voiceOtpCallsTotal.inc({ result: 'spoke' });
  } else if (event === 'failed' || event === 'timeout') {
    voiceOtpCallsTotal.inc({ result: 'failed' });
  }

  log.info('Voximplant voice OTP event', {
    event,
    sessionId: sessionId !== undefined ? String(sessionId) : undefined,
    callId: callId !== undefined ? String(callId) : undefined,
    destinationMasked: maskPhone(destination) || undefined,
    callerIdMasked: maskPhone(callerId) || undefined,
    eventCode,
    sipCode,
    internalCode,
    duration,
    successful,
    reason: reason ? sanitizeLogText(reason) : undefined,
    timestamp,
    details: sanitizedDetails,
  });

  await recordVoiceOtpWebhookDiagnosticEvent(parsed.data, sanitizedDetails);

  res.json({ success: true });
});

/**
 * POST /service-survey/result — результат автоматического опроса после услуги.
 */
router.post('/service-survey/result', verifyVoximplantWebhook('service-survey-result'), async (req: Request, res: Response) => {
  const parsed = serviceSurveyResultWebhookSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.message);

  telephonyServiceSurveyTotal.inc({ event: parsed.data.event });
  if ((parsed.data.event === 'completed' || parsed.data.event === 'transcript') && !parsed.data.transcript) {
    asrEmptyTranscriptTotal.inc();
  }

  const result = await telephonyService.recordServiceSurveyResult(parsed.data);

  if (result.callLog) {
    broadcastToRoom('telephony:call_event', 'employee:dashboard', {
      callId: result.callLog.id,
      event: parsed.data.event,
      status: result.callLog.status,
      scenario: 'service_survey',
      transcriptId: result.transcript?.id || null,
      recordingUrl: result.callLog.recording_url || null,
    });
  }
  scheduleNextQueuedServiceSurveyCall(parsed.data.event);

  res.json({
    success: true,
    data: {
      call_id: result.callLog?.id || null,
      transcript_id: result.transcript?.id || null,
    },
  });
});

/**
 * POST /service-survey/turn — один ход разговорного опроса-заботы.
 * VoxEngine присылает накопленную историю реплик; отвечаем следующей короткой
 * репликой бота (мозг Grok через OpenRouter) и URL её озвучки голосом Grok
 * (mp3 в S3). audio_url=null → VoxEngine озвучит встроенным TTS (фолбэк).
 *
 * БЕЗОПАСНОСТЬ: эндпоинт дёргает платные LLM+TTS, а webhook-auth в dual-accept
 * пропускает неподписанные запросы. Поэтому ОБЯЗАТЕЛЬНЫЙ IP rate-limit (Redis)
 * как барьер от abuse/финансового DoS: легитимный звонок делает ~6-12 ходов за
 * минуты, 120/мин на IP с запасом хватает (Voximplant шлёт с общих egress-IP),
 * но тысячи запросов атаки режутся. Доп. защита — лимиты в zod-схеме выше.
 */
const surveyTurnLimiter = createUploadLimiter('rl-survey-turn:', 120, 60 * 1000);
router.post('/service-survey/turn', surveyTurnLimiter, verifyVoximplantWebhook('service-survey-turn'), async (req: Request, res: Response) => {
  const parsed = serviceSurveyTurnSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.message);

  const result = await runSurveyTurn({
    sessionId: parsed.data.session_id,
    turnIndex: parsed.data.turn_index,
    history: parsed.data.history,
  });

  res.json({
    success: true,
    data: {
      reply_text: result.replyText,
      audio_url: result.audioUrl,
      end: result.end,
    },
  });
});

/**
 * POST /service-survey/tool — function tool execution for native xAI/Grok realtime.
 * VoxEngine receives `ResponseFunctionCallArgumentsDone`, calls this endpoint,
 * then returns the JSON string as `function_call_output` to xAI.
 */
const surveyToolLimiter = createUploadLimiter('rl-survey-tool:', 240, 60 * 1000);
router.post('/service-survey/tool', surveyToolLimiter, verifyVoximplantWebhook('service-survey-tool'), async (req: Request, res: Response) => {
  const parsed = serviceSurveyToolSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.message);

  const result = await runServiceSurveyRealtimeTool({
    sessionId: parsed.data.session_id,
    toolName: parsed.data.tool_name,
    rawArguments: parsed.data.arguments,
    callerNumber: parsed.data.caller_number,
    calledNumber: parsed.data.called_number,
    trustedIdentity: hasTrustedVoximplantLegacySecret(req),
  });

  res.json({
    success: true,
    data: {
      tool_name: result.toolName,
      outcome: result.outcome,
      output: result.output,
    },
  });
});

// ============================================================
// Authenticated endpoints
// ============================================================

/**
 * GET /health/voip-phone — снимок здоровья входящей VoIP линии
 */
router.get('/health/voip-phone', authenticateToken, requirePermission('inbox:manage'), async (_req: AuthRequest, res: Response) => {
  const snapshot = await getTelephonyVoipHealthSnapshot();
  res.json({ success: true, data: snapshot });
});

/**
 * POST /health/voip-phone/check — ручной запуск health-check
 */
router.post('/health/voip-phone/check', authenticateToken, requirePermission('inbox:manage'), async (_req: AuthRequest, res: Response) => {
  const result = await runTelephonyVoipHealthCheckOnce();
  res.json({ success: true, data: result });
});

/**
 * GET /service-survey/responses — список звонков-опросов с расшифровками.
 */
router.get('/service-survey/responses', authenticateToken, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'admin') throw new AppError(403, 'Недостаточно прав');

  const parsed = serviceSurveyResponsesQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(400, parsed.error.message);

  const result = await telephonyService.getServiceSurveyResponses({
    q: parsed.data.q,
    status: parsed.data.status,
    from: parsed.data.from,
    to: parsed.data.to,
    limit: parsed.data.limit ?? 50,
    offset: parsed.data.offset ?? 0,
  });

  res.json({ success: true, data: result.items, total: result.total });
});

/**
 * GET /service-survey/responses/:callId/recording — поток записи звонка-опроса.
 */
router.get('/service-survey/responses/:callId/recording', authenticateToken, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'admin') throw new AppError(403, 'Недостаточно прав');

  const callId = req.params['callId'];
  if (!callId) throw new AppError(400, 'Call id is required');

  const recording = await telephonyService.getServiceSurveyRecording(callId);
  const recordingUrl = recording?.recording_url?.trim();
  if (!recordingUrl) throw new AppError(404, 'Запись звонка не найдена');

  const localRecordingPath = resolveLocalRecordingPath(recordingUrl);
  if (localRecordingPath) {
    if (!fs.existsSync(localRecordingPath)) throw new AppError(404, 'Запись звонка не найдена');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(localRecordingPath);
    return;
  }

  await streamExternalRecording(recordingUrl, req, res);
});

/**
 * POST /call — Click-to-call
 */
router.post('/call', authenticateToken, requirePermission('inbox:manage'), async (req: AuthRequest, res: Response) => {
  const parsed = startCallSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.message);
  const { phone } = parsed.data;
  const userId = req.user?.id;
  if (!userId) throw new AppError(401, 'Unauthorized');

  // Поиск клиента
  const client = await telephonyService.lookupClientByPhone(phone);
  const sessionId = `crm-click-${randomUUID()}`;

  // Создать запись исходящего звонка
  const callLog = await telephonyService.createCallLog({
    voximplant_session_id: sessionId,
    direction: 'outbound',
    caller_number: config.voximplant.studioClickToCall.callerId,
    called_number: phone,
    operator_user_id: userId,
    client_user_id: client?.id,
    status: 'connecting',
  });

  const started = await startVoximplantStudioClickToCall({
    destinationPhone: phone,
    sessionId,
    operatorUser: config.voximplant.studioClickToCall.sipUser,
    callerId: config.voximplant.studioClickToCall.callerId,
  });

  if (!started.success) {
    await telephonyService.updateCallLog(callLog.id, {
      status: 'failed',
      ended_at: new Date().toISOString(),
      notes: `Voximplant click-to-call start failed: ${started.error || 'unknown'}`,
    });
    throw new AppError(502, 'Voximplant click-to-call failed');
  }

  res.json({
    success: true,
    data: {
      callId: callLog.id,
      clientName: client?.display_name || null,
      sessionId,
      status: callLog.status,
    },
  });
});

/**
 * POST /service-survey/call — автоматический звонок клиенту после оказания услуги.
 * Если другой service survey звонок активен, запрос остается в очереди.
 */
router.post('/service-survey/call', authenticateToken, requirePermission('inbox:manage'), async (req: AuthRequest, res: Response) => {
  const parsed = serviceSurveyCallSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.message);
  const { phone, order_id, client_id } = parsed.data;
  const userId = req.user?.id;
  if (!userId) throw new AppError(401, 'Unauthorized');

  let queued: EnqueueServiceSurveyCallResult;
  try {
    queued = await enqueueServiceSurveyCall({
      phone,
      orderId: order_id,
      clientId: client_id,
      operatorUserId: userId,
    });
  } catch (error) {
    if (error instanceof ServiceSurveyCallStartError) {
      throw new AppError(502, 'Voximplant service survey failed');
    }
    throw error;
  }

  res.json({
    success: true,
    data: {
      callId: queued.callLog.id,
      clientName: queued.clientName,
      sessionId: queued.sessionId,
      status: queued.status,
      question: queued.question,
      queued: queued.queued,
      queuePosition: queued.queuePosition,
    },
  });
});

/**
 * POST /openai/realtime-token — краткоживущий OpenAI Realtime client secret
 */
router.post(
  '/openai/realtime-token',
  authenticateToken,
  requirePermission('inbox:manage'),
  validate(openAiRealtimeTokenSchema),
  async (req: AuthRequest, res: Response) => {
    const clientSecret = await createOpenAiRealtimeClientSecret(req.body);
    res.json({ success: true, data: clientSecret });
  },
);

/**
 * GET /calls — История звонков
 */
router.get('/calls', authenticateToken, requirePermission('inbox:manage'), async (req: AuthRequest, res: Response) => {
  const parsed = callHistoryQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(400, parsed.error.message);
  const { phone, operator_id, client_id, direction, limit, offset } = parsed.data;

  const result = await telephonyService.getCallHistory({
    phone,
    operator_id,
    client_id,
    direction,
    limit: limit ?? 50,
    offset: offset ?? 0,
  });

  res.json({ success: true, data: result.calls, total: result.total });
});

/**
 * GET /calls/:id — Детали звонка
 */
router.get('/calls/:id', authenticateToken, requirePermission('inbox:manage'), async (req: AuthRequest, res: Response) => {
  const call = await telephonyService.getCallById(req.params['id']);
  if (!call) throw new AppError(404, 'Call not found');
  res.json({ success: true, data: call });
});

/**
 * POST /calls/:id/link — Привязать звонок к задаче/заказу/записи
 */
router.post('/calls/:id/link', authenticateToken, requirePermission('inbox:manage'), async (req: AuthRequest, res: Response) => {
  const { entity_type, entity_id } = req.body;
  const validTypes = ['task', 'order', 'booking', 'approval'];

  if (!entity_type || !entity_id || !validTypes.includes(entity_type)) throw new AppError(400, 'entity_type and entity_id required');

  await telephonyService.linkCallToEntity(req.params['id'], entity_type, entity_id);
  res.json({ success: true });
});

/**
 * POST /calls/:id/recording — Загрузить запись звонка
 */
const recordingUploadLimiter = createUploadLimiter('ul-telrec:', 20, 15 * 60 * 1000);

router.post(
  '/calls/:id/recording',
  authenticateToken,
  requirePermission('inbox:manage'),
  recordingUploadLimiter,
  uploadRecording.single('recording'),
  async (req: AuthRequest, res: Response) => {
    if (!req.file) throw new AppError(400, 'No recording file');

    const recordingUrl = `/uploads/recordings/${req.file.filename}`;

    await telephonyService.updateCallLog(req.params['id'], {
      recording_url: recordingUrl,
    });

    res.json({ success: true, data: { recording_url: recordingUrl } });
  }
);

/**
 * GET /operators/available — доступные операторы (на смене или accept_calls)
 * ПЛАН 10: Voximplant переключение звонков
 */
router.get('/operators/available', authenticateToken, requirePermission('inbox:view'), async (_req: AuthRequest, res: Response) => {
  const operators = await telephonyService.getAvailableOperators();
  res.json({ success: true, data: operators });
});

/**
 * POST /calls/:id/transfer — переключить звонок на другого оператора
 * ПЛАН 10: Voximplant переключение звонков
 */
router.post('/calls/:id/transfer', authenticateToken, requirePermission('inbox:view'), async (req: AuthRequest, res: Response) => {
  const { to_employee_id } = req.body;
  if (!to_employee_id) throw new AppError(400, 'to_employee_id обязателен');

  await telephonyService.transferCall(req.params['id'], to_employee_id);
  res.json({ success: true, message: 'Звонок переключён' });
});

export default router;
