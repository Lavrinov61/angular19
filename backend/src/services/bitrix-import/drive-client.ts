/**
 * Bitrix24 Drive REST client.
 *
 * - getChildren(folderId)   — disk.folder.getchildren, пагинация через start
 * - getFile(fileId)         — disk.file.get, возвращает DOWNLOAD_URL
 * - downloadFile(url)       — HTTP GET на DOWNLOAD_URL, возвращает ReadableStream
 * - getStorages()           — список доступных disk.storage-ов
 *
 * Rate-limit: 2 req/sec через TokenBucket.
 * Retry: 3x с exponential backoff на 5xx/network errors.
 * 401 — попытка forceRefresh + retry.
 */

import { Readable } from 'stream';
import { createLogger } from '../../utils/logger.js';
import { bitrixRateLimiter } from './rate-limiter.js';
import { getAccessToken, forceRefresh } from './oauth.service.js';
import type { BitrixDiskItem, BitrixRestError, BitrixRestResult } from './types.js';

const logger = createLogger('bitrix.drive');

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callRest<T>(
  method: string,
  params: Record<string, unknown> = {},
  retryCount = 0,
): Promise<T> {
  await bitrixRateLimiter.take();
  const tokens = await getAccessToken();
  const url = `${tokens.portalUrl}/rest/${method}.json`;

  const body = new URLSearchParams({
    auth: tokens.accessToken,
    ...Object.fromEntries(
      Object.entries(params).flatMap(([k, v]) => {
        if (v === undefined || v === null) return [];
        if (Array.isArray(v)) return v.map((item, idx) => [`${k}[${idx}]`, String(item)]);
        if (typeof v === 'object') {
          return Object.entries(v as Record<string, unknown>).map(([kk, vv]) => [`${k}[${kk}]`, String(vv)]);
        }
        return [[k, String(v)]];
      }),
    ),
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (err) {
    if (retryCount < MAX_RETRIES) {
      const wait = RETRY_BASE_MS * Math.pow(3, retryCount);
      logger.warn(`Bitrix REST network error, retry ${retryCount + 1}/${MAX_RETRIES} in ${wait}ms`, {
        method,
        err: (err as Error).message,
      });
      await sleep(wait);
      return callRest(method, params, retryCount + 1);
    }
    throw err;
  }

  if (response.status === 401 && retryCount === 0) {
    logger.warn('Bitrix REST 401, force-refreshing token', { method });
    await forceRefresh();
    return callRest(method, params, retryCount + 1);
  }

  if (response.status >= 500 && retryCount < MAX_RETRIES) {
    const wait = RETRY_BASE_MS * Math.pow(3, retryCount);
    logger.warn(`Bitrix REST ${response.status}, retry ${retryCount + 1}/${MAX_RETRIES} in ${wait}ms`, { method });
    await sleep(wait);
    return callRest(method, params, retryCount + 1);
  }

  const rawText = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(`Bitrix REST ${method} returned non-JSON: ${rawText.slice(0, 200)}`);
  }

  if (typeof data === 'object' && data !== null && 'error' in data && !('result' in data)) {
    const err = data as BitrixRestError;
    throw new Error(`Bitrix REST ${method} error: ${err.error} — ${err.error_description ?? ''}`);
  }

  return (data as BitrixRestResult<T>).result;
}

/**
 * disk.folder.getchildren с авто-пагинацией.
 * Возвращает все дочерние элементы папки (лениво, через async generator).
 */
export async function* iterateChildren(folderId: string): AsyncGenerator<BitrixDiskItem, void, void> {
  let start = 0;
  for (;;) {
    await bitrixRateLimiter.take();
    const tokens = await getAccessToken();
    const url = `${tokens.portalUrl}/rest/disk.folder.getchildren.json`;

    const body = new URLSearchParams({
      auth: tokens.accessToken,
      id: folderId,
      start: String(start),
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!response.ok) {
      throw new Error(`disk.folder.getchildren failed: ${response.status}`);
    }

    const data = (await response.json()) as BitrixRestResult<BitrixDiskItem[]>;
    const items = data.result ?? [];
    for (const item of items) {
      yield item;
    }

    if (typeof data.next !== 'number' || items.length === 0) return;
    start = data.next;
  }
}

/**
 * disk.file.get — возвращает DOWNLOAD_URL и метаданные.
 */
export async function getFile(fileId: string): Promise<BitrixDiskItem> {
  return callRest<BitrixDiskItem>('disk.file.get', { id: fileId });
}

/**
 * disk.storage.getlist — список storage-ов (пользовательские диски + общие).
 */
export async function getStorages(): Promise<BitrixDiskItem[]> {
  return callRest<BitrixDiskItem[]>('disk.storage.getlist', {});
}

/**
 * Скачать файл по DOWNLOAD_URL (внешний URL с auth-токеном внутри).
 * Возвращает Node Readable stream — не буферит содержимое.
 */
export async function downloadFile(downloadUrl: string): Promise<Readable> {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`File download failed: ${response.status}`);
  }
  if (!response.body) {
    throw new Error('File download: no response body');
  }
  return Readable.fromWeb(response.body as unknown as import('stream/web').ReadableStream);
}
