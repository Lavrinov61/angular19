/**
 * Omnichannel v2 — Media Worker
 *
 * BullMQ worker for async media processing:
 * 1. adapter.downloadMedia(ref, account) → Buffer
 * 2. MediaProcessor: HEIC→JPEG, type reclassification
 * 3. S3 upload
 * 4. INSERT/UPDATE media_attachments
 *
 * Decouples media download from message INSERT — messages are saved immediately,
 * media attachments are populated asynchronously. Frontend handles
 * "loading" state for media that hasn't been processed yet.
 */

import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import db from '../../../database/db.js';
import { config } from '../../../config/index.js';
import { getAdapterOrThrow } from '../core/adapter-registry.js';
import { getAccountById } from '../core/account-store.js';
import {
  processAndStoreMedia,
  downloadAndStoreFromUrl,
  processAndStoreMediaStream,
  downloadAndStoreFromUrlStream,
  shouldUseStreamingMedia,
} from '../core/media-service.js';
import type { ChannelType, MessageType } from '../core/types.js';

import type { ParsedMediaRef } from '../core/dto.js';
import { broadcastMediaReady } from './broadcast.js';
import { createLogger } from '../../../utils/logger.js';
import { runWithRequestId } from '../../../middleware/request-context.js';
import {
  mediaProcessedTotal,
  mediaProcessingDuration,
  mediaUploadBytes,
} from '../../../services/metrics.service.js';

const log = createLogger('media-worker');

// ─── BullMQ setup ─────────────────────────────────────────────────────────────

const redisOpts = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  tls: config.redis.tls,
  maxRetriesPerRequest: null as null,
};

interface MediaJobData {
  messageId: string;
  channel: ChannelType;
  accountId: string;
  mediaRef: ParsedMediaRef;
  _requestId?: string;
}

interface PermanentError extends Error {
  permanent?: boolean;
  Code?: string;
}

interface UploadedMediaRow {
  s3_url: string;
  file_name: string | null;
  mime_type: string | null;
}

interface MediaMessageRow {
  conversation_id: string;
  message_type: MessageType;
}

interface MediaFailureContextRow {
  conversation_id: string;
  message_type: MessageType;
  external_chat_id: string | null;
}

interface MediaFailureStatus {
  status: 'failed';
  reasonCode: string;
  operatorMessage: string;
  clientMessage: string;
  failedAt: string;
  clientNotified: boolean;
}

const MEDIA_UPLOAD_FALLBACK_URL = 'https://svoefoto.ru/chat';

const GENERIC_CLIENT_MEDIA_FAILURE =
  `Не удалось получить файл. Пожалуйста, отправьте его ещё раз или загрузите через чат на сайте: ${MEDIA_UPLOAD_FALLBACK_URL}`;

function markPermanentIfNeeded(err: unknown): void {
  if (!(err instanceof Error)) return;
  const e = err as PermanentError;
  const msg = e.message ?? '';
  const code = e.Code ?? e.name ?? '';
  if (
    code === 'AccessDenied' ||
    msg.includes('AccessDenied') ||
    msg.includes('file is too big') ||
    msg.includes('FILE_TOO_BIG') ||
    msg.includes('PHOTO_TOO_BIG')
  ) {
    e.permanent = true;
  }
}

function isTooLargeError(err: unknown): boolean {
  const e = err instanceof Error ? err as PermanentError : null;
  const msg = e?.message ?? String(err);
  const code = e?.Code ?? e?.name ?? '';
  return (
    msg.includes('file is too big') ||
    msg.includes('FILE_TOO_BIG') ||
    msg.includes('PHOTO_TOO_BIG') ||
    code === 'FILE_TOO_BIG' ||
    code === 'PHOTO_TOO_BIG'
  );
}

function isAccessDeniedError(err: unknown): boolean {
  const e = err instanceof Error ? err as PermanentError : null;
  const msg = e?.message ?? String(err);
  const code = e?.Code ?? e?.name ?? '';
  return code === 'AccessDenied' || msg.includes('AccessDenied');
}

function isFinalAttempt(job: Job<MediaJobData>, isPermanent: boolean): boolean {
  if (isPermanent) return true;
  const maxAttempts = job.opts.attempts ?? 1;
  return job.attemptsMade + 1 >= maxAttempts;
}

function buildMediaFailureStatus(err: unknown, reasonOverride?: string): MediaFailureStatus {
  const failedAt = new Date().toISOString();
  const reasonCode = reasonOverride
    ?? (isTooLargeError(err) ? 'too_large'
      : isAccessDeniedError(err) ? 'storage_access_denied'
        : 'download_failed');

  if (reasonCode === 'too_large') {
    return {
      status: 'failed',
      reasonCode,
      operatorMessage: 'Файл не удалось получить: Telegram не отдаёт файлы больше 20 МБ.',
      clientMessage: `Файл слишком большой для Telegram. Пожалуйста, загрузите его через чат на сайте: ${MEDIA_UPLOAD_FALLBACK_URL}`,
      failedAt,
      clientNotified: false,
    };
  }

  if (reasonCode === 'account_missing') {
    return {
      status: 'failed',
      reasonCode,
      operatorMessage: 'Файл не удалось скачать: не найден аккаунт канала. Клиента автоматически уведомить не удалось.',
      clientMessage: GENERIC_CLIENT_MEDIA_FAILURE,
      failedAt,
      clientNotified: false,
    };
  }

  if (reasonCode === 'storage_access_denied') {
    return {
      status: 'failed',
      reasonCode,
      operatorMessage: 'Файл получили, но не смогли сохранить в хранилище. Проверьте доступ к S3.',
      clientMessage: `Файл получен, но временно не обработан. Пожалуйста, загрузите его через чат на сайте: ${MEDIA_UPLOAD_FALLBACK_URL}`,
      failedAt,
      clientNotified: false,
    };
  }

  return {
    status: 'failed',
    reasonCode,
    operatorMessage: 'Файл не удалось получить из канала после нескольких попыток. Попросите клиента отправить файл повторно или загрузить через сайт.',
    clientMessage: GENERIC_CLIENT_MEDIA_FAILURE,
    failedAt,
    clientNotified: false,
  };
}

// ─── Worker processor ─────────────────────────────────────────────────────────

async function processMedia(job: Job<MediaJobData>): Promise<void> {
  // Restore requestId from job data for distributed tracing
  return runWithRequestId(job.data._requestId, () => processMediaInner(job));
}

async function processMediaInner(job: Job<MediaJobData>): Promise<void> {
  const { messageId, channel, accountId, mediaRef } = job.data;
  const startTime = Date.now();
  const mediaType = mediaRef.mediaTypeHint || 'unknown';

  // Mark as downloading
  await db.query(
    `INSERT INTO media_attachments
      (message_id, s3_key, s3_url, media_type, mime_type, processing_status, original_url)
     VALUES ($1, 'pending', '', $2, $3, 'downloading', $4)
     ON CONFLICT DO NOTHING`,
    [messageId, mediaRef.mediaTypeHint, mediaRef.mimeHint, mediaRef.sourceRef],
  );

  const account = await getAccountById(accountId);
  if (!account) {
    log.error('account not found for media download', { accountId, messageId });
    const failureStatus = buildMediaFailureStatus(new Error('account not found'), 'account_missing');
    await markMediaFailed(messageId, mediaRef.sourceRef, failureStatus.reasonCode);
    await notifyMediaProcessingFailure(messageId, channel, accountId, failureStatus).catch(e =>
      log.error('notifyMediaProcessingFailure failed', { messageId, error: String(e) }),
    );
    mediaProcessedTotal.inc({ channel, media_type: mediaType, status: 'failed' });
    return;
  }

  try {
    let totalBytes = 0;
    const useStreaming = shouldUseStreamingMedia(mediaRef);

    // Choose download strategy based on source type
    if (mediaRef.sourceType === 'url') {
      // Direct CDN URL (Max, some VK photos) — prefer streaming, fallback to buffer
      if (useStreaming) {
        try {
          const result = await downloadAndStoreFromUrlStream(
            mediaRef.sourceRef,
            messageId,
            channel,
            mediaRef.mimeHint,
            mediaRef.mediaTypeHint,
            mediaRef.fileName,
          );
          totalBytes = result.sizeBytes ?? 0;
          log.debug('media stored from URL (streaming)', {
            messageId,
            channel,
            mediaType: result.mediaType,
            sizeBytes: result.sizeBytes,
          });
        } catch (streamErr) {
          log.warn('streaming URL download failed, falling back to buffer', {
            messageId, error: String(streamErr),
          });
          const result = await downloadAndStoreFromUrl(
            mediaRef.sourceRef,
            messageId,
            channel,
            mediaRef.mimeHint,
            mediaRef.mediaTypeHint,
            mediaRef.fileName,
          );
          totalBytes = result.sizeBytes ?? 0;
          log.debug('media stored from URL (buffer fallback)', {
            messageId,
            channel,
            mediaType: result.mediaType,
            sizeBytes: result.sizeBytes,
          });
        }
      } else {
        const result = await downloadAndStoreFromUrl(
          mediaRef.sourceRef,
          messageId,
          channel,
          mediaRef.mimeHint,
          mediaRef.mediaTypeHint,
          mediaRef.fileName,
        );
        totalBytes = result.sizeBytes ?? 0;
        log.debug('media stored from URL (buffer)', {
          messageId,
          channel,
          mediaType: result.mediaType,
          sizeBytes: result.sizeBytes,
        });
      }
    } else {
      // Channel-specific download (Telegram file_id, WhatsApp media_id)
      const adapter = getAdapterOrThrow(channel);

      // Prefer streaming if adapter supports it
      if (useStreaming && adapter.downloadMediaStream) {
        try {
          const result = await processAndStoreMediaStream(mediaRef, messageId, adapter, account);
          totalBytes = result.sizeBytes ?? 0;
          log.debug('media stored via adapter (streaming)', {
            messageId,
            channel,
            mediaType: result.mediaType,
            sizeBytes: result.sizeBytes,
          });
        } catch (streamErr) {
          log.warn('streaming adapter download failed, falling back to buffer', {
            messageId, error: String(streamErr),
          });
          const result = await processAndStoreMedia(mediaRef, messageId, adapter, account);
          totalBytes = result.sizeBytes ?? 0;
          log.debug('media stored via adapter (buffer fallback)', {
            messageId,
            channel,
            mediaType: result.mediaType,
            sizeBytes: result.sizeBytes,
          });
        }
      } else {
        const result = await processAndStoreMedia(mediaRef, messageId, adapter, account);
        totalBytes = result.sizeBytes ?? 0;
        log.debug('media stored via adapter', {
          messageId,
          channel,
          mediaType: result.mediaType,
          sizeBytes: result.sizeBytes,
        });
      }
    }

    // Remove the placeholder row (processAndStoreMedia/downloadAndStoreFromUrl already inserted the real one)
    await db.query(
      `DELETE FROM media_attachments
       WHERE message_id = $1 AND s3_key = 'pending' AND processing_status = 'downloading'`,
      [messageId],
    );

    // Record success metrics
    const durationSec = (Date.now() - startTime) / 1000;
    mediaProcessedTotal.inc({ channel, media_type: mediaType, status: 'success' });
    mediaProcessingDuration.observe({ channel, media_type: mediaType }, durationSec);
    if (totalBytes > 0) {
      mediaUploadBytes.inc({ channel }, totalBytes);
    }

    // Notify frontend that media is ready — read the actual uploaded URL from media_attachments
    // (messages.attachment_url only stores the FIRST attachment; use the specific one we just uploaded)
    const uploaded = await db.queryOne<UploadedMediaRow>(
      `SELECT s3_url, file_name, mime_type FROM media_attachments
       WHERE message_id = $1 AND original_url = $2 AND processing_status = 'uploaded'
       ORDER BY created_at DESC LIMIT 1`,
      [messageId, mediaRef.sourceRef],
    );
    const msgInfo = await db.queryOne<MediaMessageRow>(
      `SELECT conversation_id, message_type FROM messages WHERE id = $1`,
      [messageId],
    );
    if (uploaded?.s3_url && msgInfo) {
      broadcastMediaReady(
        msgInfo.conversation_id,
        messageId,
        uploaded.s3_url,
        msgInfo.message_type || 'image',
        uploaded.file_name,
        uploaded.mime_type,
      );
    }
  } catch (err) {
    markPermanentIfNeeded(err);
    const isPermanent = err instanceof Error && (err as PermanentError).permanent === true;
    log.error('media processing failed', {
      messageId,
      channel,
      sourceRef: mediaRef.sourceRef,
      error: String(err),
      permanent: isPermanent,
    });
    mediaProcessedTotal.inc({ channel, media_type: mediaType, status: 'failed' });
    const failureStatus = buildMediaFailureStatus(err);
    await markMediaFailed(messageId, mediaRef.sourceRef, failureStatus.reasonCode);
    const finalAttempt = isFinalAttempt(job, isPermanent);

    if (finalAttempt) {
      await notifyMediaProcessingFailure(messageId, channel, accountId, failureStatus).catch(e =>
        log.error('notifyMediaProcessingFailure failed', { messageId, error: String(e) }),
      );
    }

    // Permanent errors (e.g. "file is too big") — don't retry after notifying both sides
    if (isPermanent) {
      log.warn('permanent media error — skipping retry', { messageId, channel });
      return;
    }

    throw err; // Let BullMQ retry transient errors
  }
}

async function markMediaFailed(messageId: string, sourceRef: string, reasonCode: string): Promise<void> {
  const metadata = JSON.stringify({ errorCode: reasonCode, failedAt: new Date().toISOString() });
  await db.query(
    `UPDATE media_attachments
     SET processing_status = 'failed',
         metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
     WHERE message_id = $1 AND (original_url = $2 OR s3_key = 'pending')`,
    [messageId, sourceRef, metadata],
  );
}

async function updateMessageMediaFailureStatus(
  messageId: string,
  status: MediaFailureStatus,
): Promise<void> {
  await db.query(
    `UPDATE messages
     SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
     WHERE id = $1`,
    [messageId, JSON.stringify({ mediaStatus: status })],
  );
}

async function notifyMediaProcessingFailure(
  messageId: string,
  channel: ChannelType,
  accountId: string,
  failureStatus: MediaFailureStatus,
): Promise<void> {
  const conv = await db.queryOne<MediaFailureContextRow>(
    `SELECT m.conversation_id, m.message_type, c.external_chat_id
     FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE m.id = $1`,
    [messageId],
  );

  let clientNotified = false;
  if (conv?.external_chat_id) {
    try {
      const account = await getAccountById(accountId);
      if (account) {
        const adapter = getAdapterOrThrow(channel);
        const sendResult = await adapter.sendText(account, conv.external_chat_id, failureStatus.clientMessage);
        clientNotified = sendResult.success;
        if (!sendResult.success) {
          log.warn('client media failure notification was not accepted by channel', {
            messageId,
            channel,
            errorCode: sendResult.errorCode,
            errorMessage: sendResult.errorMessage,
          });
        }
      } else {
        log.warn('account not found while notifying client about media failure', { accountId, messageId });
      }
    } catch (sendErr) {
      log.warn('failed to notify client about media failure', { messageId, channel, error: String(sendErr) });
    }
  }

  const finalStatus: MediaFailureStatus = { ...failureStatus, clientNotified };
  await updateMessageMediaFailureStatus(messageId, finalStatus);

  if (!conv) {
    log.warn('message not found while broadcasting media failure', { messageId, channel });
    return;
  }

  await broadcastMediaReady(
    conv.conversation_id,
    messageId,
    '',
    conv.message_type || 'file',
    null,
    null,
    {
      status: 'failed',
      errorMessage: finalStatus.operatorMessage,
      clientNotified: finalStatus.clientNotified,
      clientMessage: finalStatus.clientMessage,
    },
  );
}

// ─── Worker lifecycle ─────────────────────────────────────────────────────────

let worker: Worker | null = null;

/**
 * Start the media worker. Called once at app startup.
 */
export function startMediaWorker(): Worker {
  if (worker) return worker;

  worker = new Worker('omni-media', processMedia, {
    connection: { ...redisOpts },
    concurrency: 3,
    limiter: { max: 10, duration: 1000 },
    lockDuration: 15 * 60 * 1000,     // 15 min — HEIC downloads via proxy can take 5-10 min
    lockRenewTime: 60 * 1000,         // renew lock every 60s to prevent false stalls
    stalledInterval: 2 * 60 * 1000,   // check stalled every 2 min — fast detection
    maxStalledCount: 1,               // fail stalled job immediately — don't block queue
  });

  worker.on('completed', (job) => {
    log.debug('media job completed', { jobId: job.id, messageId: job.data.messageId });
  });

  worker.on('failed', (job, err) => {
    log.error('media job failed', {
      jobId: job?.id,
      messageId: job?.data.messageId,
      error: String(err),
    });
  });

  log.info('media worker started');
  return worker;
}

export async function stopMediaWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    log.info('media worker stopped');
  }
}
