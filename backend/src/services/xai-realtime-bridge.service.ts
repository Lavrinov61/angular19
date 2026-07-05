import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Server, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import WebSocket, { WebSocketServer, type RawData } from 'ws';
import { z } from 'zod';
import {
  buildVoximplantMediaMessage,
  buildVoximplantStartMessage,
  buildXaiAudioAppend,
  buildXaiResponseCancel,
  buildXaiResponseCreate,
  buildXaiSessionUpdate,
  getXaiOutputAudioPayload,
  parseVoximplantBridgeMessage,
  transcodeXaiAudioToVoximplant,
  type VoximplantMediaMessage,
} from './xai-realtime-bridge.protocol.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('xai-realtime-bridge');

const tokenPayloadSchema = z.object({
  sessionId: z.string().min(1),
  expiresAtMs: z.number().int().positive(),
});

const xaiEventSchema = z.object({
  type: z.string().min(1),
}).passthrough();

const xaiTranscriptSchema = z.object({
  type: z.union([
    z.literal('conversation.item.input_audio_transcription.completed'),
    z.literal('response.output_audio_transcript.done'),
    z.literal('response.audio_transcript.done'),
  ]),
  transcript: z.string().optional(),
}).passthrough();

const xaiFunctionCallSchema = z.object({
  type: z.literal('response.function_call_arguments.done'),
  name: z.string().min(1),
  call_id: z.string().min(1),
}).passthrough();

const xaiErrorEventSchema = z.object({
  type: z.literal('error'),
  error: z.object({
    code: z.string().optional(),
    message: z.string().optional(),
  }).passthrough().optional(),
  message: z.string().optional(),
}).passthrough();

export interface ServiceSurveyRealtimeBridgeTokenInput {
  sessionId: string;
  expiresAtMs: number;
}

export interface ServiceSurveyRealtimeBridgeTokenPayload {
  sessionId: string;
}

export interface ServiceSurveyRealtimeBridgeConnectionInput {
  bridgeUrl: string;
  sessionId: string;
  tokenSecret: string;
  tokenTtlMs: number;
  nowMs?: number;
}

export interface ServiceSurveyRealtimeBridgeConnectionConfig {
  url: string;
  expiresAtMs: number;
}

export interface XaiRealtimeBridgeRegistrationOptions {
  path: string;
  tokenSecret: string;
  xaiApiKey: string;
  xaiRealtimeUrl?: string;
}

interface BridgeSessionOptions {
  sessionId: string;
  voice: string;
  instructions: string;
  greeting: string;
  xaiRealtimeUrl: string;
}

interface XaiErrorSummary {
  type: 'error';
  code?: string;
  message?: string;
}

const DEFAULT_XAI_REALTIME_MODEL = 'grok-voice-think-fast-1.0';
const DEFAULT_XAI_REALTIME_VOICE = 'om17cury';
const DEFAULT_XAI_REALTIME_INSTRUCTIONS = 'Ты голосовой помощник студии Своё Фото. Говори коротко и только по-русски.';
const MAX_QUEUED_AUDIO_FRAMES = 250;
// Если xAI не подтвердил сессию за это окно — открываем вход клиента принудительно,
// чтобы он не остался неуслышанным при сбое xAI (нет кредитов / rate-limit).
const GREETING_WATCHDOG_MS = 5000;
// Пейсинг исходящего аудио в Voximplant. На 20мс кадрах Node timer в проде
// просыпался поздно и растягивал речь (~6.6кБ/с вместо 8кБ/с). Держим тот же
// real-time темп, но отдаём более крупные 100мс блоки: меньше timer overhead и
// стабильнее playback без транскода.
// μ-law 8 кГц: 8 байт = 1 мс ⇒ 800 байт = 100 мс.
export const VOX_FRAME_MS = 100;
export const VOX_FRAME_BYTES = 800;
const VOX_MAX_FRAMES_PER_TICK = 1;
const VOX_SEGMENT_IDLE_MS = VOX_FRAME_MS * 3;
// Предохранитель от безграничного роста буфера (≈30 с аудио).
const VOX_MAX_BUFFER_BYTES = 8000 * 30;

export interface VoxDueFrameCountInput {
  nowMs: number;
  nextDrainAtMs: number;
  bufferedBytes: number;
  maxFramesPerTick?: number;
}

export interface VoxPacingSummaryInput {
  sentBytes: number;
  firstSendMs: number;
  lastSendMs: number;
  lastFrameBytes: number;
}

export interface VoxPacingSummary {
  sentAudioSec: number;
  sendWallSec: number;
  effectiveHz: number;
}

export function computeVoxDueFrameCount(input: VoxDueFrameCountInput): number {
  if (input.bufferedBytes <= 0 || input.nowMs < input.nextDrainAtMs) return 0;
  const dueSlots = Math.floor((input.nowMs - input.nextDrainAtMs) / VOX_FRAME_MS) + 1;
  const bufferedFrames = Math.ceil(input.bufferedBytes / VOX_FRAME_BYTES);
  const maxFrames = input.maxFramesPerTick ?? VOX_MAX_FRAMES_PER_TICK;
  return Math.max(0, Math.min(dueSlots, bufferedFrames, maxFrames));
}

export function summarizeVoxPacing(input: VoxPacingSummaryInput): VoxPacingSummary {
  if (input.sentBytes <= 0 || input.firstSendMs <= 0 || input.lastSendMs < input.firstSendMs) {
    return { sentAudioSec: 0, sendWallSec: 0, effectiveHz: 0 };
  }
  const sentAudioSec = input.sentBytes / 8000;
  const lastFrameSec = Math.max(0, input.lastFrameBytes) / 8000;
  const sendWallSec = ((input.lastSendMs - input.firstSendMs) / 1000) + lastFrameSec;
  return {
    sentAudioSec: Number(sentAudioSec.toFixed(2)),
    sendWallSec: Number(sendWallSec.toFixed(2)),
    effectiveHz: sendWallSec > 0 ? Math.round(input.sentBytes / sendWallSec) : 0,
  };
}

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64Url(value: string): string | null {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseUpgradeUrl(request: IncomingMessage): URL | null {
  const rawUrl = request.url;
  if (!rawUrl) return null;

  try {
    return new URL(rawUrl, 'http://telephony.local');
  } catch {
    return null;
  }
}

function writeUpgradeError(socket: Duplex, statusCode: number, statusText: string): void {
  socket.write(`HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\n\r\n`);
  socket.end();
}

function buildDefaultXaiRealtimeUrl(model: string): string {
  const url = new URL('wss://api.x.ai/v1/realtime');
  url.searchParams.set('model', model);
  return url.toString();
}

function normalizeBridgeUrl(rawBridgeUrl: string): URL {
  const url = new URL(rawBridgeUrl);
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol === 'http:') url.protocol = 'ws:';
  return url;
}

function resolveBridgeSessionOptions(
  url: URL,
  options: XaiRealtimeBridgeRegistrationOptions,
  sessionId: string,
): BridgeSessionOptions {
  const model = url.searchParams.get('model') || DEFAULT_XAI_REALTIME_MODEL;
  return {
    sessionId,
    voice: url.searchParams.get('voice') || DEFAULT_XAI_REALTIME_VOICE,
    instructions: url.searchParams.get('instructions') || DEFAULT_XAI_REALTIME_INSTRUCTIONS,
    greeting: url.searchParams.get('greeting') || '',
    xaiRealtimeUrl: options.xaiRealtimeUrl || buildDefaultXaiRealtimeUrl(model),
  };
}

function sendJson(socket: WebSocket, message: object): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function closeSocket(socket: WebSocket): void {
  if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) return;
  socket.close();
}

function rawDataToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function parseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function summarizeXaiErrorEvent(event: unknown): XaiErrorSummary {
  const parsed = xaiErrorEventSchema.safeParse(event);
  if (!parsed.success) return { type: 'error' };
  return {
    type: parsed.data.type,
    code: parsed.data.error?.code,
    message: parsed.data.error?.message ?? parsed.data.message,
  };
}

function isXaiReady(socket: WebSocket): boolean {
  return socket.readyState === WebSocket.OPEN;
}

export function createServiceSurveyRealtimeBridgeToken(
  input: ServiceSurveyRealtimeBridgeTokenInput,
  secret: string,
): string {
  const payload = encodeBase64Url(JSON.stringify({
    sessionId: input.sessionId,
    expiresAtMs: input.expiresAtMs,
  }));
  const signature = signPayload(payload, secret);
  return `${payload}.${signature}`;
}

export function buildServiceSurveyRealtimeBridgeConnectionConfig(
  input: ServiceSurveyRealtimeBridgeConnectionInput,
): ServiceSurveyRealtimeBridgeConnectionConfig {
  const nowMs = input.nowMs ?? Date.now();
  const expiresAtMs = nowMs + input.tokenTtlMs;
  const url = normalizeBridgeUrl(input.bridgeUrl);
  const token = createServiceSurveyRealtimeBridgeToken({
    sessionId: input.sessionId,
    expiresAtMs,
  }, input.tokenSecret);

  url.searchParams.set('session_id', input.sessionId);
  url.searchParams.set('token', token);

  return {
    url: url.toString(),
    expiresAtMs,
  };
}

export function verifyServiceSurveyRealtimeBridgeToken(
  token: string,
  secret: string,
  nowMs = Date.now(),
): ServiceSurveyRealtimeBridgeTokenPayload | null {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;

  const expected = signPayload(payload, secret);
  if (!secureEqual(signature, expected)) return null;

  const decoded = decodeBase64Url(payload);
  if (!decoded) return null;

  let json: unknown;
  try {
    json = JSON.parse(decoded);
  } catch {
    return null;
  }

  const parsed = tokenPayloadSchema.safeParse(json);
  if (!parsed.success || parsed.data.expiresAtMs <= nowMs) return null;

  return { sessionId: parsed.data.sessionId };
}

export function registerXaiRealtimeBridge(
  server: Server,
  options: XaiRealtimeBridgeRegistrationOptions,
): void {
  const bridgeServer = new WebSocketServer({ noServer: true });

  bridgeServer.on('connection', (voximplantSocket, request) => {
    const url = parseUpgradeUrl(request);
    if (!url) {
      closeSocket(voximplantSocket);
      return;
    }

    const sessionId = url.searchParams.get('session_id') ?? '';
    const sessionOptions = resolveBridgeSessionOptions(url, options, sessionId);
    bridgeVoximplantToXai(voximplantSocket, sessionOptions, options.xaiApiKey);
  });

  server.on('upgrade', (request, socket, head) => {
    const url = parseUpgradeUrl(request);
    if (!url || url.pathname !== options.path) return;

    const token = url.searchParams.get('token') ?? '';
    const sessionId = url.searchParams.get('session_id') ?? '';
    const verified = verifyServiceSurveyRealtimeBridgeToken(token, options.tokenSecret);
    if (!verified || verified.sessionId !== sessionId) {
      writeUpgradeError(socket, 401, 'Unauthorized');
      return;
    }

    if (!options.xaiApiKey) {
      writeUpgradeError(socket, 503, 'Service Unavailable');
      return;
    }

    bridgeServer.handleUpgrade(request, socket, head, (webSocket) => {
      bridgeServer.emit('connection', webSocket, request);
    });
  });
}

function bridgeVoximplantToXai(
  voximplantSocket: WebSocket,
  sessionOptions: BridgeSessionOptions,
  xaiApiKey: string,
): void {
  const xaiSocket = new WebSocket(sessionOptions.xaiRealtimeUrl, {
    headers: {
      Authorization: `Bearer ${xaiApiKey}`,
    },
  });
  const queuedAudio: VoximplantMediaMessage[] = [];
  let xaiOpen = false;
  let voxStartSent = false;
  let voxSequenceNumber = 0;
  let voxChunk = 0;
  let voxTimestamp = 0;
  let hangupRequested = false;
  // Джиттер-буфер исходящего μ-law + таймер пейсинга (см. VOX_FRAME_*).
  let voxOutBuffer = Buffer.alloc(0);
  let voxPacer: ReturnType<typeof setInterval> | null = null;
  let voxNextDrainAtMs = 0;
  // [TEMP-DIAG] счётчики для диагностики частоты/пейсинга
  let voxDiagOutBytes = 0;
  let voxDiagFirstSendMs = 0;
  let voxDiagLastSendMs = 0;
  let voxDiagLastFrameBytes = 0;
  let voxDiagXaiBytes = 0;
  let voxDiagSegmentIndex = 0;
  let voxDiagSegmentBytes = 0;
  let voxDiagSegmentFirstSendMs = 0;
  let voxDiagSegmentLastSendMs = 0;
  let voxDiagSegmentLastFrameBytes = 0;
  let voxDiagSegmentTimer: ReturnType<typeof setTimeout> | null = null;
  let xaiResponseActive = false;
  let voximplantClosed = false;
  let closeVoximplantAfterDrain = false;
  let closeSummaryLogged = false;
  let initialGreetingPending = sessionOptions.greeting.trim().length > 0;
  // До готовности realtime-сессии не пробрасываем вход клиента в xAI.
  // Если задано приветствие, сначала запускаем его голосом xAI, без Voximplant TTS.
  let conversationOpen = false;

  let greetingWatchdog: ReturnType<typeof setTimeout> | null = null;

  function flushQueuedAudio(): void {
    while (queuedAudio.length > 0 && isXaiReady(xaiSocket)) {
      const frame = queuedAudio.shift();
      if (frame) sendJson(xaiSocket, buildXaiAudioAppend(frame));
    }
  }

  // Открывает проброс входного аудио клиента в xAI. Идемпотентно. Вызывается по
  // session.updated, по первой аудио-дельте бота, ИЛИ по watchdog-таймауту — чтобы
  // клиент не остался неуслышанным, если xAI не вернул session.updated.
  function openConversation(): void {
    if (conversationOpen) return;
    conversationOpen = true;
    if (greetingWatchdog) {
      clearTimeout(greetingWatchdog);
      greetingWatchdog = null;
    }
    flushQueuedAudio();
  }

  // Кладёт аудио xAI (PCMU/μ-law 8к) в джиттер-буфер. Реальная отправка в
  // Voximplant — равномерно, таймером (drainVoxFrame), иначе ускоренное воспроизведение.
  function enqueueVoxAudio(payload: string): void {
    const mulaw = Buffer.from(transcodeXaiAudioToVoximplant(payload), 'base64');
    if (mulaw.length === 0) return;
    voxDiagXaiBytes += mulaw.length; // [TEMP-DIAG]
    if (voxOutBuffer.length + mulaw.length > VOX_MAX_BUFFER_BYTES) {
      // Защита от разрастания: дропаем старейшее (бот «отстаёт» — лучше пропуск, чем лавина).
      const overflow = voxOutBuffer.length + mulaw.length - VOX_MAX_BUFFER_BYTES;
      voxOutBuffer = voxOutBuffer.subarray(Math.min(overflow, voxOutBuffer.length));
    }
    voxOutBuffer = Buffer.concat([voxOutBuffer, mulaw]);
    ensureVoxPacer();
  }

  function logVoxSegment(reason: string): void {
    if (voxDiagSegmentBytes <= 0) return;
    const summary = summarizeVoxPacing({
      sentBytes: voxDiagSegmentBytes,
      firstSendMs: voxDiagSegmentFirstSendMs,
      lastSendMs: voxDiagSegmentLastSendMs,
      lastFrameBytes: voxDiagSegmentLastFrameBytes,
    });
    logger.info('[VOX-DIAG] segment', {
      sessionId: sessionOptions.sessionId,
      segment: voxDiagSegmentIndex,
      reason,
      sentMulawBytes: voxDiagSegmentBytes,
      ...summary,
    });
    voxDiagSegmentBytes = 0;
    voxDiagSegmentFirstSendMs = 0;
    voxDiagSegmentLastSendMs = 0;
    voxDiagSegmentLastFrameBytes = 0;
  }

  function noteVoxSegmentSend(nowMs: number, bytes: number): void {
    if (voxDiagSegmentBytes === 0) {
      voxDiagSegmentIndex += 1;
      voxDiagSegmentFirstSendMs = nowMs;
    }
    voxDiagSegmentBytes += bytes;
    voxDiagSegmentLastSendMs = nowMs;
    voxDiagSegmentLastFrameBytes = bytes;
    if (voxDiagSegmentTimer) clearTimeout(voxDiagSegmentTimer);
    voxDiagSegmentTimer = setTimeout(() => {
      voxDiagSegmentTimer = null;
      logVoxSegment('idle');
    }, VOX_SEGMENT_IDLE_MS);
  }

  // Отдаёт один 100мс-кадр μ-law (или хвост) в Voximplant.
  function drainOneVoxFrame(nowMs: number): void {
    if (voxOutBuffer.length === 0) return;
    if (!voxStartSent) {
      sendJson(voximplantSocket, buildVoximplantStartMessage(voxSequenceNumber));
      voxStartSent = true;
      voxSequenceNumber += 1;
    }
    const take = Math.min(VOX_FRAME_BYTES, voxOutBuffer.length);
    const frame = voxOutBuffer.subarray(0, take);
    voxOutBuffer = voxOutBuffer.subarray(take);
    // [TEMP-DIAG]
    if (voxDiagFirstSendMs === 0) voxDiagFirstSendMs = nowMs;
    voxDiagLastSendMs = nowMs;
    voxDiagOutBytes += take;
    voxDiagLastFrameBytes = take;
    noteVoxSegmentSend(nowMs, take);
    voxChunk += 1;
    sendJson(voximplantSocket, buildVoximplantMediaMessage({
      sequenceNumber: voxSequenceNumber,
      chunk: voxChunk,
      timestamp: voxTimestamp,
      payload: frame.toString('base64'),
    }));
    // timestamp в СЭМПЛАХ (как у VoxEngine: +160 на 20мс-кадр), а не в мс.
    // μ-law 8 кГц: 1 байт = 1 сэмпл.
    voxTimestamp += take;
    voxSequenceNumber += 1;
  }

  // Таймер Node может просыпаться позже 20мс. Если отправлять всегда один кадр,
  // речь растягивается (в проде видели ~6кБ/с вместо 8кБ/с). Догоняем долг.
  function drainDueVoxFrames(): void {
    const nowMs = Date.now();
    if (voxOutBuffer.length === 0) {
      voxNextDrainAtMs = nowMs + VOX_FRAME_MS;
      if (closeVoximplantAfterDrain) finishXaiClosedAfterDrain();
      return;
    }
    const dueFrames = computeVoxDueFrameCount({
      nowMs,
      nextDrainAtMs: voxNextDrainAtMs || nowMs,
      bufferedBytes: voxOutBuffer.length,
    });
    for (let frameIndex = 0; frameIndex < dueFrames; frameIndex += 1) {
      drainOneVoxFrame(nowMs);
    }
    if (dueFrames > 0) {
      voxNextDrainAtMs += dueFrames * VOX_FRAME_MS;
    }
    if (voxOutBuffer.length === 0 && closeVoximplantAfterDrain) {
      finishXaiClosedAfterDrain();
    }
  }

  function ensureVoxPacer(): void {
    if (voxPacer) return;
    voxNextDrainAtMs = Date.now() + VOX_FRAME_MS;
    voxPacer = setInterval(drainDueVoxFrames, VOX_FRAME_MS);
  }

  function stopVoxPacer(): void {
    if (voxPacer) {
      clearInterval(voxPacer);
      voxPacer = null;
    }
    if (voxDiagSegmentTimer) {
      clearTimeout(voxDiagSegmentTimer);
      voxDiagSegmentTimer = null;
    }
    logVoxSegment('stop');
  }

  function logCloseSummary(): void {
    if (closeSummaryLogged) return;
    closeSummaryLogged = true;
    const summary = summarizeVoxPacing({
      sentBytes: voxDiagOutBytes,
      firstSendMs: voxDiagFirstSendMs,
      lastSendMs: voxDiagLastSendMs,
      lastFrameBytes: voxDiagLastFrameBytes,
    });
    logger.info('[VOX-DIAG] out', {
      sessionId: sessionOptions.sessionId,
      xaiMulawBytes: voxDiagXaiBytes,
      sentMulawBytes: voxDiagOutBytes,
      sendSpanSec: summary.sendWallSec,
      sentAudioSec: summary.sentAudioSec,
      bufferAudioSec: Number((voxOutBuffer.length / 8000).toFixed(2)),
      effectiveHz: summary.effectiveHz,
      bufferLeft: voxOutBuffer.length,
    });
    logger.info('xAI realtime bridge closed', { sessionId: sessionOptions.sessionId });
  }

  function finishXaiClosedAfterDrain(): void {
    closeVoximplantAfterDrain = false;
    stopVoxPacer();
    if (!voximplantClosed) closeSocket(voximplantSocket);
    logCloseSummary();
  }

  // Барж-ин/отмена: сбросить недоигранный буфер бота, чтобы он замолчал немедленно.
  function flushVoxOutBuffer(): void {
    voxOutBuffer = Buffer.alloc(0);
  }

  xaiSocket.on('open', () => {
    xaiOpen = true;
    sendJson(xaiSocket, buildXaiSessionUpdate({
      voice: sessionOptions.voice,
      instructions: sessionOptions.instructions,
    }));
    // Watchdog: если xAI не вернёт session.updated за окно, всё равно открываем вход,
    // иначе клиента не будет слышно весь звонок.
    greetingWatchdog = setTimeout(openConversation, GREETING_WATCHDOG_MS);
    logger.info('xAI realtime bridge connected', { sessionId: sessionOptions.sessionId });
  });

  voximplantSocket.on('message', (data) => {
    const rawIn = rawDataToString(data);
    const message = parseVoximplantBridgeMessage(rawIn);
    if (!message) return;

    if (message.type === 'voximplant.media') {
      // Пока бот не начал приветствие — вход клиента отбрасываем (см. conversationOpen).
      if (!conversationOpen) return;
      if (xaiOpen && isXaiReady(xaiSocket)) {
        sendJson(xaiSocket, buildXaiAudioAppend(message));
      } else if (queuedAudio.length < MAX_QUEUED_AUDIO_FRAMES) {
        queuedAudio.push(message);
      }
      return;
    }

    if (message.type === 'control.barge_in') {
      // Клиент перебил — отменяем генерацию И сбрасываем недоигранный буфер бота.
      flushVoxOutBuffer();
      if (xaiResponseActive) {
        sendJson(xaiSocket, buildXaiResponseCancel());
        xaiResponseActive = false;
      }
      return;
    }

    if (message.type === 'voximplant.stop') {
      closeSocket(xaiSocket);
    }
  });

  xaiSocket.on('message', (data) => {
    const parsed = parseJson(rawDataToString(data));
    if (!parsed) return;

    const event = xaiEventSchema.safeParse(parsed);
    if (!event.success) return;

    const audioPayload = getXaiOutputAudioPayload(parsed);
    if (audioPayload) {
      // Бот заговорил — диалог точно жив (страховка, если response.created не пришёл).
      xaiResponseActive = true;
      openConversation();
      enqueueVoxAudio(audioPayload);
      return;
    }

    if (event.data.type === 'session.updated') {
      if (initialGreetingPending) {
        const greeting = sessionOptions.greeting.trim();
        sendJson(xaiSocket, buildXaiResponseCreate([
          `Скажи дословно эту фразу и больше ничего: «${greeting}»`,
          'Не добавляй приветствий, пояснений, вопросов про запись или лишних фраз.',
        ].join(' ')));
        sendJson(voximplantSocket, {
          customEvent: 'transcript',
          role: 'bot',
          text: greeting,
        });
        return;
      }
      openConversation();
      return;
    }

    if (event.data.type === 'response.created') {
      // Не разрешаем cancel до первой аудио-дельты:
      // xAI может прислать response.created до фактического аудио, и ранний barge-in
      // даёт "Cancellation failed: no active response found".
      return;
    }

    if (event.data.type === 'response.done') {
      xaiResponseActive = false;
      if (initialGreetingPending) {
        initialGreetingPending = false;
        openConversation();
      }
      return;
    }

    if (event.data.type === 'input_audio_buffer.speech_started') {
      flushVoxOutBuffer();
      sendJson(voximplantSocket, { customEvent: 'barge_in_detected' });
      return;
    }

    if (event.data.type === 'response.output_audio.done' && hangupRequested) {
      sendJson(voximplantSocket, { customEvent: 'hangup_call' });
      return;
    }

    if (event.data.type === 'error') {
      logger.warn('xAI realtime bridge upstream event error', {
        sessionId: sessionOptions.sessionId,
        error: summarizeXaiErrorEvent(parsed),
      });
      return;
    }

    const transcript = xaiTranscriptSchema.safeParse(parsed);
    if (transcript.success && transcript.data.transcript) {
      sendJson(voximplantSocket, {
        customEvent: 'transcript',
        role: transcript.data.type === 'conversation.item.input_audio_transcription.completed' ? 'client' : 'bot',
        text: transcript.data.transcript,
      });
      return;
    }

    const functionCall = xaiFunctionCallSchema.safeParse(parsed);
    if (functionCall.success && functionCall.data.name === 'hangup_call') {
      hangupRequested = true;
      sendJson(xaiSocket, {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: functionCall.data.call_id,
          output: 'ok',
        },
      });
      sendJson(xaiSocket, buildXaiResponseCreate());
    }
  });

  function clearGreetingWatchdog(): void {
    if (greetingWatchdog) {
      clearTimeout(greetingWatchdog);
      greetingWatchdog = null;
    }
  }

  voximplantSocket.on('close', () => {
    voximplantClosed = true;
    closeVoximplantAfterDrain = false;
    clearGreetingWatchdog();
    stopVoxPacer();
    closeSocket(xaiSocket);
  });

  xaiSocket.on('close', () => {
    clearGreetingWatchdog();
    if (!voximplantClosed && voxOutBuffer.length > 0) {
      closeVoximplantAfterDrain = true;
      ensureVoxPacer();
      return;
    }
    finishXaiClosedAfterDrain();
  });

  xaiSocket.on('error', (error) => {
    logger.warn('xAI realtime bridge upstream error', {
      sessionId: sessionOptions.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    closeSocket(voximplantSocket);
  });

  voximplantSocket.on('error', (error) => {
    logger.warn('xAI realtime bridge Voximplant socket error', {
      sessionId: sessionOptions.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    closeSocket(xaiSocket);
  });
}
