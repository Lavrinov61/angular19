/**
 * Сервис обработки фотографий для печати.
 * 
 * Вся тяжёлая работа (sharp, archiver) выполняется в отдельном
 * Node.js процессе (worker), чтобы избежать конфликтов с Angular SSR esbuild.
 * 
 * Этот файл — тонкая обёртка, которая:
 *  1. Формирует JSON с параметрами
 *  2. Запускает воркер через child_process
 *  3. Парсит JSON-результат
 */

import { execFile } from 'child_process';
import * as path from 'path';

import { createLogger } from '../utils/logger.js';
// ============================================================================
// Типы (экспортируются для использования в routes)
// ============================================================================

const logger = createLogger('photo-processor.service');
export interface ProcessingOptions {
  /** Размер печати, напр. "10x15" или "7x7" */
  size: string;
  /** Количество копий каждого фото (глобально, используется как fallback) */
  copies: number;
  /** Пути к исходным файлам (абсолютные) */
  sourcePaths: string[];
  /** ID сессии чата */
  sessionId: string;
  /** Тип бумаги (premium / super) — информационно */
  printType?: string;
  /** С полями или без */
  borders?: string;
  /** Номер заказа (для имени архива) */
  orderNumber?: number;
  /**
   * Индивидуальные копии для каждого фото.
   * Ключ — messageId фото, значение — количество копий.
   */
  perPhotoCopies?: Record<string, number>;
  /**
   * Соответствие sourcePath → messageId (для маппинга перфото-копий).
   */
  pathToMessageId?: Record<string, string>;
}

export interface ProcessingResult {
  archivePath: string;
  archiveUrl: string;
  processedCount: number;
  totalFiles: number;
  archiveSize: number;
  details: {
    targetWidthPx: number;
    targetHeightPx: number;
    sizeCm: string;
    fitMode: 'cover' | 'contain' | 'layout';
    layout?: {
      sheetCm: string;
      sheetWidthPx: number;
      sheetHeightPx: number;
      photosPerSheet: number;
      cols: number;
      rows: number;
      sheetsTotal: number;
    };
  };
}

export interface OriginalArchiveResult {
  archivePath: string;
  archiveUrl: string;
  photosCount: number;
  archiveSize: number;
}

// ============================================================================
// Путь к воркеру
// ============================================================================

function getWorkerPath(): string {
  // Воркер лежит рядом с проектом, НЕ бандлится esbuild
  return path.resolve(process.cwd(), 'backend/workers/photo-processor.worker.mjs');
}

// ============================================================================
// Вызов воркера через child_process
// ============================================================================

function runWorker<T>(input: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const workerPath = getWorkerPath();
    const child = execFile('node', [workerPath], {
      cwd: process.cwd(),
      timeout: 5 * 60 * 1000, // 5 минут макс
      maxBuffer: 50 * 1024 * 1024, // 50 MB stdout
      env: { ...process.env },
    }, (error, stdout, stderr) => {
      // Логи воркера (stderr) пробрасываем в консоль
      if (stderr) {
        for (const line of stderr.split('\n').filter(Boolean)) {
          logger.info(line);
        }
      }

      if (error) {
        // Попробуем распарсить stdout даже при ошибке — воркер мог записать JSON
        try {
          const parsed = JSON.parse(stdout);
          if (!parsed.success) {
            return reject(new Error(parsed.error || 'Worker failed'));
          }
        } catch {
          // stdout не JSON
        }
        return reject(new Error(`Worker error: ${error.message}`));
      }

      try {
        const parsed = JSON.parse(stdout);
        if (parsed.success) {
          resolve(parsed.result as T);
        } else {
          reject(new Error(parsed.error || 'Worker returned failure'));
        }
      } catch (parseErr: unknown) {
        reject(new Error(`Worker output parse error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}. stdout: ${stdout.slice(0, 500)}`));
      }
    });

    // Отправляем входные данные через stdin
    child.stdin?.write(JSON.stringify(input));
    child.stdin?.end();
  });
}

// ============================================================================
// Публичные функции (интерфейс остаётся прежним)
// ============================================================================

export async function processPhotosForPrint(
  options: ProcessingOptions
): Promise<ProcessingResult> {
  logger.info(`[PhotoProcessor] Запуск воркера для обработки ${options.sourcePaths.length} фото, размер ${options.size}`);

  return runWorker<ProcessingResult>({
    action: 'processPhotosForPrint',
    cwd: process.cwd(),
    ...options,
  });
}

export async function archiveOriginalPhotos(
  sourcePaths: string[],
  sessionId: string,
  orderInfo: { service: string; tariff: string; price: number },
  orderNumber?: number
): Promise<OriginalArchiveResult> {
  logger.info(`[PhotoProcessor] Запуск воркера для архивирования ${sourcePaths.length} оригиналов`);

  return runWorker<OriginalArchiveResult>({
    action: 'archiveOriginalPhotos',
    cwd: process.cwd(),
    sourcePaths,
    sessionId,
    orderInfo,
    orderNumber,
  });
}

// ============================================================================
// Утилита (не требует sharp)
// ============================================================================

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
