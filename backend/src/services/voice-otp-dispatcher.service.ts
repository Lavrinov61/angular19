import { randomInt, randomUUID } from 'node:crypto';
import { Queue, QueueEvents, Worker } from 'bullmq';
import type { Job, JobsOptions } from 'bullmq';
import { config } from '../config/index.js';
import { getRequestId, runWithRequestId } from '../middleware/request-context.js';
import { createLogger } from '../utils/logger.js';
import { captureException } from '../utils/error-tracker.js';
import { bullmqJobDuration, bullmqJobsProcessed, voiceOtpCallsTotal } from './metrics.service.js';
import { createResilientRedis } from './redis-factory.js';
import {
  getVoximplantVoiceCallHistory,
  startVoximplantVoiceCall,
} from './voximplant.service.js';
import { recordPhoneOtpEventSafely } from './phone-otp-event.service.js';

const log = createLogger('voice-otp-dispatcher');

const QUEUE_NAME = 'voice-otp-dispatch';
const FAILURE_PREFIX = 'VOICE_OTP_DISPATCH';
const CALL_HISTORY_LOOKUP_MIN_DELAY_MS = 10_000;
const CALL_HISTORY_LOOKUP_RETRY_EXTRA_DELAY_MS = 30_000;
const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

const redisOpts = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  tls: config.redis.tls,
  maxRetriesPerRequest: null as null,
};

type DispatchFailureReason = 'busy' | 'provider' | 'unavailable';
type DispatchFailureCode = 'BUSY' | 'PROVIDER' | 'UNAVAILABLE';

export interface VoiceOtpDispatchAccepted {
  provider: 'voice_call';
  requestId?: string;
  callSessionHistoryId?: string;
  callerId: string;
  verificationCode: string;
  acceptedAt: string;
}

export type VoiceOtpDispatchResult =
  | { success: true; data: VoiceOtpDispatchAccepted }
  | { success: false; reason: DispatchFailureReason; error: string };

interface VoiceOtpDispatchJobData {
  phone: string;
  verificationCode: string;
  dispatchDeadlineAt: number;
  inflightKey: string;
  inflightToken: string;
  _requestId?: string;
}

interface SlotCandidate {
  callerId: string;
  key: string;
}

interface SlotLease {
  callerId: string;
  key: string;
  token: string;
}

const queue = new Queue<VoiceOtpDispatchJobData, VoiceOtpDispatchAccepted>(QUEUE_NAME, {
  connection: { ...redisOpts },
});

const queueEvents = new QueueEvents(QUEUE_NAME, { connection: { ...redisOpts } });

let worker: Worker<VoiceOtpDispatchJobData, VoiceOtpDispatchAccepted> | null = null;
let lockRedis: ReturnType<typeof createResilientRedis> | null = null;

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return digits;
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function getDispatchConfig() {
  return config.voximplant.voiceCall.dispatcher;
}

function getJobOpts(): JobsOptions {
  const dispatchConfig = getDispatchConfig();
  return {
    attempts: dispatchConfig.maxAttempts,
    backoff: { type: 'fixed', delay: dispatchConfig.retryDelayMs },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  };
}

function getLockRedis() {
  if (!lockRedis) {
    lockRedis = createResilientRedis('voice-otp-dispatch-locks', {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: true,
    });
  }
  return lockRedis;
}

function createFailureMessage(code: DispatchFailureCode, message: string): string {
  return `${FAILURE_PREFIX}:${code}:${message}`;
}

function parseFailure(error: unknown): VoiceOtpDispatchResult {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith(`${FAILURE_PREFIX}:BUSY:`)) {
    return {
      success: false,
      reason: 'busy',
      error: message.slice(`${FAILURE_PREFIX}:BUSY:`.length),
    };
  }
  if (message.startsWith(`${FAILURE_PREFIX}:UNAVAILABLE:`)) {
    return {
      success: false,
      reason: 'unavailable',
      error: message.slice(`${FAILURE_PREFIX}:UNAVAILABLE:`.length),
    };
  }
  if (message.startsWith(`${FAILURE_PREFIX}:PROVIDER:`)) {
    return {
      success: false,
      reason: 'provider',
      error: message.slice(`${FAILURE_PREFIX}:PROVIDER:`.length),
    };
  }
  if (message.toLowerCase().includes('timed out')) {
    return {
      success: false,
      reason: 'busy',
      error: 'Очередь голосового OTP перегружена. Попробуйте ещё раз.',
    };
  }
  return {
    success: false,
    reason: 'provider',
    error: message || 'Voice OTP dispatch failed',
  };
}

function getInflightKey(phone: string): string {
  return `voice-otp:inflight:${phone}`;
}

function getCallerSlots(): SlotCandidate[] {
  const slots: SlotCandidate[] = [];
  const perCallerSlots = Math.max(1, getDispatchConfig().slotsPerCaller);

  for (const callerId of config.voximplant.voiceCall.callerIds) {
    const normalizedCallerId = callerId.replace(/\D/g, '');
    for (let index = 0; index < perCallerSlots; index++) {
      slots.push({
        callerId,
        key: `voice-otp:slot:${normalizedCallerId}:${index}`,
      });
    }
  }

  return slots;
}

function getWorkerConcurrency(): number {
  const slots = getCallerSlots().length;
  return Math.max(1, slots);
}

async function releaseOwnedKey(key: string, token: string): Promise<void> {
  try {
    await getLockRedis().eval(RELEASE_LOCK_SCRIPT, 1, key, token);
  } catch (error: unknown) {
    log.warn('Failed to release voice OTP lock', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function acquireInflightLock(phone: string, token: string, ttlMs: number): Promise<boolean> {
  const result = await getLockRedis().set(getInflightKey(phone), token, 'PX', ttlMs, 'NX');
  return result === 'OK';
}

async function releaseInflightLock(data: Pick<VoiceOtpDispatchJobData, 'inflightKey' | 'inflightToken'>): Promise<void> {
  await releaseOwnedKey(data.inflightKey, data.inflightToken);
}

async function acquireCallerSlot(lockTtlMs: number): Promise<SlotLease | null> {
  const slots = getCallerSlots();
  if (slots.length === 0) {
    return null;
  }

  const startIndex = slots.length > 1 ? randomInt(slots.length) : 0;

  for (let offset = 0; offset < slots.length; offset++) {
    const slot = slots[(startIndex + offset) % slots.length];
    if (!slot) continue;

    const token = randomUUID();
    const result = await getLockRedis().set(slot.key, token, 'PX', lockTtlMs, 'NX');
    if (result === 'OK') {
      return {
        callerId: slot.callerId,
        key: slot.key,
        token,
      };
    }
  }

  return null;
}

async function releaseCallerSlot(lease: SlotLease | null): Promise<void> {
  if (!lease) return;
  await releaseOwnedKey(lease.key, lease.token);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function observeJobMetrics(job: Job<VoiceOtpDispatchJobData>, status: 'completed' | 'failed'): void {
  bullmqJobsProcessed.inc({ queue: QUEUE_NAME, job_name: job.name, status });
  if (!job.processedOn || !job.finishedOn || job.finishedOn < job.processedOn) {
    return;
  }
  bullmqJobDuration.observe(
    { queue: QUEUE_NAME, job_name: job.name },
    (job.finishedOn - job.processedOn) / 1000,
  );
}

function getCallHistoryLookupDelays(): number[] {
  const hangupAfterMs = Math.max(0, config.voximplant.voiceCall.hangupAfterMs || 0);
  const firstDelay = Math.max(CALL_HISTORY_LOOKUP_MIN_DELAY_MS, hangupAfterMs + 5_000);
  return [firstDelay, firstDelay + CALL_HISTORY_LOOKUP_RETRY_EXTRA_DELAY_MS];
}

async function logVoiceOtpCallHistory(
  job: Job<VoiceOtpDispatchJobData>,
  delivery: VoiceOtpDispatchAccepted,
  attempt: number,
): Promise<boolean> {
  if (!delivery.callSessionHistoryId) {
    return true;
  }

  const history = await getVoximplantVoiceCallHistory(delivery.callSessionHistoryId);
  if (!history.success) {
    log.warn('voice OTP call history lookup failed', {
      jobId: job.id,
      phoneMasked: maskPhone(job.data.phone),
      attempt,
      providerRequestId: delivery.requestId,
      callSessionHistoryId: delivery.callSessionHistoryId,
      error: history.error,
    });
    return false;
  }

  const session = history.session;
  const primaryCall = session.calls.find((call) => call.incoming === false) || session.calls[0];
  log.info('voice OTP call history resolved', {
    jobId: job.id,
    phoneMasked: maskPhone(job.data.phone),
    attempt,
    providerRequestId: delivery.requestId,
    callSessionHistoryId: delivery.callSessionHistoryId,
    callerId: delivery.callerId,
    sessionStartDate: session.startDate,
    sessionDuration: session.duration,
    finishReason: session.finishReason,
    callId: primaryCall?.callId,
    callStartTime: primaryCall?.startTime,
    callDuration: primaryCall?.duration,
    callSuccessful: primaryCall?.successful,
    endReasonCode: primaryCall?.endReason?.code,
    endReasonDetails: primaryCall?.endReason?.details,
    cost: primaryCall?.cost,
    direction: primaryCall?.direction,
  });
  voiceOtpCallsTotal.inc({ result: 'connected' });
  await recordPhoneOtpEventSafely({
    phone: job.data.phone,
    eventType: 'call_history_resolved',
    provider: delivery.provider,
    providerRequestId: delivery.requestId,
    callSessionHistoryId: delivery.callSessionHistoryId,
    callerId: delivery.callerId,
    details: {
      sessionStartDate: session.startDate,
      sessionDuration: session.duration,
      finishReason: session.finishReason,
      callId: primaryCall?.callId,
      callStartTime: primaryCall?.startTime,
      callDuration: primaryCall?.duration,
      callSuccessful: primaryCall?.successful,
      endReasonCode: primaryCall?.endReason?.code,
      endReasonDetails: primaryCall?.endReason?.details,
      cost: primaryCall?.cost,
      direction: primaryCall?.direction,
    },
  });

  if (primaryCall?.successful !== true || (primaryCall.duration ?? 0) <= 0) {
    voiceOtpCallsTotal.inc({ result: 'not_reached' });
    await recordPhoneOtpEventSafely({
      phone: job.data.phone,
      eventType: 'call_not_reached',
      provider: delivery.provider,
      providerRequestId: delivery.requestId,
      callSessionHistoryId: delivery.callSessionHistoryId,
      callerId: delivery.callerId,
      details: {
        reason: 'call_unsuccessful_or_zero_duration',
        sessionDuration: session.duration,
        finishReason: session.finishReason,
        callDuration: primaryCall?.duration,
        callSuccessful: primaryCall?.successful,
        endReasonCode: primaryCall?.endReason?.code,
        endReasonDetails: primaryCall?.endReason?.details,
        direction: primaryCall?.direction,
      },
    });
  }
  return true;
}

function scheduleVoiceOtpCallHistoryLog(
  job: Job<VoiceOtpDispatchJobData>,
  delivery: VoiceOtpDispatchAccepted,
): void {
  if (!delivery.callSessionHistoryId) {
    return;
  }

  let resolved = false;
  const delays = getCallHistoryLookupDelays();
  delays.forEach((delayMs, index) => {
    const timer = setTimeout(() => {
      if (resolved) return;

      void runWithRequestId(job.data._requestId, async () => {
        if (resolved) return;
        try {
          const logged = await logVoiceOtpCallHistory(job, delivery, index + 1);
          if (logged) {
            resolved = true;
          }
        } catch (error: unknown) {
          log.warn('voice OTP call history log failed', {
            jobId: job.id,
            phoneMasked: maskPhone(job.data.phone),
            attempt: index + 1,
            providerRequestId: delivery.requestId,
            callSessionHistoryId: delivery.callSessionHistoryId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }, delayMs);
    timer.unref();
  });
}

async function processDispatchJob(job: Job<VoiceOtpDispatchJobData>): Promise<VoiceOtpDispatchAccepted> {
  return runWithRequestId(job.data._requestId, () => processDispatchJobInner(job));
}

async function processDispatchJobInner(job: Job<VoiceOtpDispatchJobData>): Promise<VoiceOtpDispatchAccepted> {
  const dispatchConfig = getDispatchConfig();

  if (Date.now() > job.data.dispatchDeadlineAt) {
    throw new Error(createFailureMessage('BUSY', 'Очередь голосового OTP перегружена. Попробуйте ещё раз.'));
  }

  const lockTtlMs = Math.max(dispatchConfig.slotLockTtlMs, dispatchConfig.dispatchTimeoutMs + 1000);
  const lease = await acquireCallerSlot(lockTtlMs);
  if (!lease) {
    throw new Error(createFailureMessage('BUSY', 'Нет свободной голосовой линии для OTP-звонка.'));
  }

  try {
    const remainingMs = job.data.dispatchDeadlineAt - Date.now();
    if (remainingMs <= 0) {
      throw new Error(createFailureMessage('BUSY', 'Очередь голосового OTP перегружена. Попробуйте ещё раз.'));
    }

    const providerTimeoutMs = Math.max(1000, Math.min(dispatchConfig.providerTimeoutMs, remainingMs));
    const result = await withTimeout(
      startVoximplantVoiceCall(job.data.phone, job.data.verificationCode, lease.callerId),
      providerTimeoutMs,
      createFailureMessage('BUSY', 'Провайдер голосового OTP не подтвердил запуск вовремя.'),
    );

    if (!result.success) {
      const failureCode: DispatchFailureCode = result.error?.includes('not configured')
        ? 'UNAVAILABLE'
        : 'PROVIDER';
      throw new Error(
        createFailureMessage(
          failureCode,
          result.error || 'Не удалось запустить голосовой OTP-звонок.',
        ),
      );
    }

    return {
      provider: 'voice_call',
      requestId: result.requestId,
      callSessionHistoryId: result.callSessionHistoryId,
      callerId: result.callerId || lease.callerId,
      verificationCode: result.verificationCode || job.data.verificationCode,
      acceptedAt: new Date().toISOString(),
    };
  } finally {
    await releaseCallerSlot(lease);
  }
}

export function getVoiceOtpDispatchQueue(): Queue<VoiceOtpDispatchJobData, VoiceOtpDispatchAccepted> {
  return queue;
}

export function isVoiceOtpDispatcherReady(): boolean {
  return worker !== null;
}

export async function requestVoiceOtpDispatch(
  phone: string,
  verificationCode: string,
): Promise<VoiceOtpDispatchResult> {
  const dispatchConfig = getDispatchConfig();
  const inflightToken = randomUUID();
  const dispatchTimeoutMs = dispatchConfig.dispatchTimeoutMs;

  try {
    const lockAcquired = await acquireInflightLock(phone, inflightToken, dispatchTimeoutMs);
    if (!lockAcquired) {
      return {
        success: false,
        reason: 'busy',
        error: 'По этому номеру уже запускается голосовой OTP-звонок. Подождите несколько секунд.',
      };
    }
  } catch (error: unknown) {
    return {
      success: false,
      reason: 'unavailable',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const jobData: VoiceOtpDispatchJobData = {
    phone,
    verificationCode,
    dispatchDeadlineAt: Date.now() + dispatchTimeoutMs,
    inflightKey: getInflightKey(phone),
    inflightToken,
    _requestId: getRequestId(),
  };

  let job: Job<VoiceOtpDispatchJobData, VoiceOtpDispatchAccepted>;

  try {
    job = await queue.add('dispatch', jobData, getJobOpts());
  } catch (error: unknown) {
    await releaseInflightLock(jobData);
    return {
      success: false,
      reason: 'unavailable',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const data = await job.waitUntilFinished(queueEvents, dispatchTimeoutMs + 1000);
    voiceOtpCallsTotal.inc({ result: 'accepted' });
    return { success: true, data };
  } catch (error: unknown) {
    const failure = parseFailure(error);
    if (!failure.success && failure.reason === 'busy') voiceOtpCallsTotal.inc({ result: 'busy' });
    return failure;
  }
}

export function startVoiceOtpDispatchWorker(): void {
  if (worker) return;

  const concurrency = getWorkerConcurrency();

  worker = new Worker<VoiceOtpDispatchJobData, VoiceOtpDispatchAccepted>(
    QUEUE_NAME,
    processDispatchJob,
    {
      connection: { ...redisOpts },
      concurrency,
    },
  );

  worker.on('completed', (job, delivery) => {
    observeJobMetrics(job, 'completed');
    releaseInflightLock(job.data).catch((error: unknown) => {
      log.warn('Failed to release inflight lock after success', {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    log.info('voice OTP dispatch completed', {
      jobId: job.id,
      phoneMasked: maskPhone(job.data.phone),
      providerRequestId: delivery.requestId,
      callSessionHistoryId: delivery.callSessionHistoryId,
      callerId: delivery.callerId,
    });
    scheduleVoiceOtpCallHistoryLog(job, delivery);
  });

  worker.on('failed', (job: Job<VoiceOtpDispatchJobData> | undefined, error: Error) => {
    if (!job) return;

    observeJobMetrics(job, 'failed');

    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= maxAttempts) {
      releaseInflightLock(job.data).catch((releaseError: unknown) => {
        log.warn('Failed to release inflight lock after final failure', {
          jobId: job.id,
          error: releaseError instanceof Error ? releaseError.message : String(releaseError),
        });
      });
      const parsedFailure = parseFailure(error);
      if (!parsedFailure.success && parsedFailure.reason !== 'busy') {
        captureException(error, {
          tags: { worker: 'voice-otp-dispatch', reason: parsedFailure.reason },
          extra: {
            jobId: job.id,
            phoneMasked: maskPhone(job.data.phone),
            attempts: job.attemptsMade,
          },
          level: 'error',
        });
      }
      const logPayload = {
        jobId: job.id,
        attempts: job.attemptsMade,
        phoneMasked: maskPhone(job.data.phone),
        error: error.message,
      };
      if (!parsedFailure.success && parsedFailure.reason === 'busy') {
        log.warn('voice OTP dispatch rejected due to capacity', logPayload);
      } else {
        log.error('voice OTP dispatch permanently failed', logPayload);
      }
      return;
    }

    log.warn('voice OTP dispatch retry scheduled', {
      jobId: job.id,
      attempt: job.attemptsMade,
      error: error.message,
    });
  });

  worker.on('error', (error: Error) => {
    captureException(error, {
      tags: { worker: 'voice-otp-dispatch' },
      level: 'error',
    });
    log.error('voice OTP dispatch worker error', { error: error.message });
  });

  log.info('voice OTP dispatch worker started', {
    queue: QUEUE_NAME,
    concurrency,
    callerIds: config.voximplant.voiceCall.callerIds.length,
    slotsPerCaller: getDispatchConfig().slotsPerCaller,
  });
}

export async function stopVoiceOtpDispatchWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
}

export async function shutdownVoiceOtpDispatcher(): Promise<void> {
  await stopVoiceOtpDispatchWorker();
  await queue.close();
  await queueEvents.close();

  if (lockRedis) {
    await lockRedis.quit();
    lockRedis = null;
  }
}
