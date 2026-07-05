/**
 * Bitrix24 Drive import orchestrator.
 *
 * Алгоритм:
 *   1. createRun() — запись в bitrix_import_runs (status=running).
 *   2. Стартуем очередь folder-ов: либо config.rootFolderIds, либо disk.storage.getlist
 *      → берём ROOT_OBJECT_ID каждого storage.
 *   3. BFS: на каждом элементе из iterateChildren(folderId):
 *      - TYPE=folder → пуш в очередь
 *      - TYPE=file  → processFile()
 *   4. processFile():
 *      - skip если уже в bitrix_photo_imports (ON CONFLICT)
 *      - getFile(id) → DOWNLOAD_URL
 *      - downloadFile(url) → stream
 *      - uploadToArchive(stream) → sha256 + size
 *      - INSERT bitrix_photo_imports
 *      - опционально WebP preview
 *   5. Периодически (каждые 30 файлов) проверяем paused-флаг в БД — и корректно завершаемся.
 *
 * Запуск: runImport() — НЕ await'ится запросом (fire-and-forget). Все ошибки в run.last_error.
 */

import { extname } from 'node:path';
import db from '../../database/db.js';
import { createLogger } from '../../utils/logger.js';
import type {
  BitrixImportRunCreated,
  BitrixImportRunRow,
  BitrixImportRunStatus,
  BitrixImportRunWithConfig,
  BitrixPhotoImportIdRef,
} from '../../types/views/bitrix-archive-views.js';
import { iterateChildren, getFile, getStorages, downloadFile } from './drive-client.js';
import {
  uploadToArchive,
  uploadWebpPreview,
  isConvertibleImage,
  streamToBuffer,
} from './archive-writer.js';
import {
  recordImportedFile,
  recordSkippedFile,
  recordError,
  recordBytes,
} from './metrics.js';
import type { BitrixDiskItem, ImportFileOutcome, ImportRunConfig } from './types.js';

const logger = createLogger('bitrix.importer');

const PAUSE_CHECK_EVERY = 30;

function guessMimeFromName(name: string): string | undefined {
  const ext = extname(name).toLowerCase();
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.heic': 'image/heic',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.bmp': 'image/bmp',
    '.cr2': 'image/x-canon-cr2',
    '.nef': 'image/x-nikon-nef',
    '.arw': 'image/x-sony-arw',
    '.raf': 'image/x-fuji-raf',
    '.dng': 'image/x-adobe-dng',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.pdf': 'application/pdf',
  };
  return map[ext];
}

function buildS3Key(portalHost: string, folderPath: string, fileId: string, name: string): string {
  const safePortal = portalHost.replace(/[^a-z0-9.-]+/gi, '_');
  const year = new Date().getFullYear();
  const safeFolder = (folderPath || 'root').replace(/^\/+/, '').replace(/\s+/g, '_').slice(0, 120);
  const ext = extname(name);
  return `originals/${safePortal}/${year}/${safeFolder}/${fileId}${ext}`;
}

async function isAlreadyImported(bitrixFileId: string): Promise<boolean> {
  const row = await db.queryOne<BitrixPhotoImportIdRef>(
    `SELECT id FROM bitrix_photo_imports WHERE bitrix_file_id = $1`,
    [bitrixFileId],
  );
  return row !== null;
}

async function insertImportRecord(params: {
  runId: number;
  bitrixFile: BitrixDiskItem;
  folderPath: string;
  portalHost: string;
  s3Key: string;
  size: number;
  sha256: string;
  mime: string | undefined;
  webpKey: string | null;
  importedBy?: string | null;
}): Promise<void> {
  await db.query(
    `
    INSERT INTO bitrix_photo_imports
      (bitrix_file_id, bitrix_folder_id, bitrix_folder_path, bitrix_name,
       s3_bucket, s3_key, size_bytes, sha256, mime_type,
       is_webp_preview_generated, webp_preview_key,
       source_portal, bitrix_created_at, bitrix_modified_at,
       run_id, imported_by)
    VALUES ($1, $2, $3, $4,
            COALESCE($5, 'svoefoto-archive-bitrix'), $6, $7, $8, $9,
            $10, $11,
            $12, $13, $14,
            $15, $16)
    ON CONFLICT (bitrix_file_id) DO NOTHING
    `,
    [
      params.bitrixFile.ID,
      params.bitrixFile.PARENT_ID,
      params.folderPath,
      params.bitrixFile.NAME,
      process.env['BITRIX_ARCHIVE_BUCKET'] ?? null,
      params.s3Key,
      params.size,
      params.sha256,
      params.mime ?? null,
      params.webpKey !== null,
      params.webpKey,
      params.portalHost,
      params.bitrixFile.CREATE_TIME ?? null,
      params.bitrixFile.UPDATE_TIME ?? null,
      params.runId,
      params.importedBy ?? null,
    ],
  );
}

async function updateRunProgress(runId: number, patch: {
  files_scanned?: number;
  files_imported?: number;
  files_skipped?: number;
  bytes_imported?: number;
  errors_count?: number;
  last_folder_id?: string;
  last_file_id?: string;
  last_error?: string;
}): Promise<void> {
  const increments: string[] = [];
  const direct: string[] = [];
  const vals: unknown[] = [];
  let i = 1;

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (
      key === 'files_scanned' ||
      key === 'files_imported' ||
      key === 'files_skipped' ||
      key === 'bytes_imported' ||
      key === 'errors_count'
    ) {
      increments.push(`${key} = ${key} + $${i}`);
    } else {
      direct.push(`${key} = $${i}`);
    }
    vals.push(value);
    i += 1;
  }

  if (increments.length === 0 && direct.length === 0) return;

  vals.push(runId);
  await db.query(
    `UPDATE bitrix_import_runs SET ${[...increments, ...direct].join(', ')} WHERE id = $${i}`,
    vals,
  );
}

async function isRunPaused(runId: number): Promise<boolean> {
  const row = await db.queryOne<BitrixImportRunStatus>(
    `SELECT status FROM bitrix_import_runs WHERE id = $1`,
    [runId],
  );
  return row?.status === 'paused' || row?.status === 'cancelled';
}

async function markRunFinished(runId: number, status: 'completed' | 'failed' | 'paused' | 'cancelled', lastError?: string): Promise<void> {
  await db.query(
    `UPDATE bitrix_import_runs
     SET status = $1,
         finished_at = CASE WHEN $1 IN ('completed','failed','cancelled') THEN now() ELSE finished_at END,
         last_error = COALESCE($2, last_error)
     WHERE id = $3`,
    [status, lastError ?? null, runId],
  );
}

async function processFile(
  file: BitrixDiskItem,
  folderPath: string,
  portalHost: string,
  runId: number,
  config: ImportRunConfig,
): Promise<ImportFileOutcome> {
  if (await isAlreadyImported(file.ID)) {
    recordSkippedFile();
    return { status: 'skipped', bitrixFileId: file.ID };
  }

  const mime = guessMimeFromName(file.NAME);
  if (config.mimeWhitelist && config.mimeWhitelist.length > 0) {
    if (!mime || !config.mimeWhitelist.includes(mime)) {
      recordSkippedFile();
      return { status: 'skipped', bitrixFileId: file.ID };
    }
  }

  const detail = await getFile(file.ID);
  const downloadUrl = detail.DOWNLOAD_URL;
  if (!downloadUrl) {
    throw new Error(`disk.file.get returned no DOWNLOAD_URL for ${file.ID}`);
  }

  const s3Key = buildS3Key(portalHost, folderPath, file.ID, file.NAME);

  const stream = await downloadFile(downloadUrl);
  const { size, sha256 } = await uploadToArchive(stream, s3Key, mime);

  let webpKey: string | null = null;
  if (isConvertibleImage(mime)) {
    try {
      const again = await downloadFile(downloadUrl);
      const buf = await streamToBuffer(again);
      webpKey = await uploadWebpPreview(buf, s3Key);
    } catch (err) {
      logger.warn('WebP generation skipped', { key: s3Key, err: (err as Error).message });
    }
  }

  await insertImportRecord({
    runId,
    bitrixFile: file,
    folderPath,
    portalHost,
    s3Key,
    size,
    sha256,
    mime,
    webpKey,
  });

  recordImportedFile();
  recordBytes(size);
  return { status: 'imported', bitrixFileId: file.ID, s3Key, size, sha256 };
}

export async function createRun(initiatedBy: string | null, config: ImportRunConfig = {}): Promise<number> {
  const row = await db.queryOne<BitrixImportRunCreated>(
    `INSERT INTO bitrix_import_runs (status, initiated_by, config) VALUES ('running', $1, $2) RETURNING id`,
    [initiatedBy, JSON.stringify(config)],
  );
  if (!row) throw new Error('Failed to insert bitrix_import_runs');
  return row.id;
}

export async function runImport(runId: number, config: ImportRunConfig = {}): Promise<void> {
  const portalUrl = process.env['BITRIX_PORTAL_URL'] ?? '';
  const portalHost = portalUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

  const queue: Array<{ folderId: string; path: string }> = [];

  try {
    if (config.rootFolderIds && config.rootFolderIds.length > 0) {
      for (const id of config.rootFolderIds) {
        queue.push({ folderId: id, path: '/' });
      }
    } else {
      const storages = await getStorages();
      for (const st of storages) {
        if (st.REAL_OBJECT_ID) queue.push({ folderId: st.REAL_OBJECT_ID, path: `/${st.NAME ?? 'storage-' + st.ID}` });
      }
    }

    let processedCount = 0;
    let filesImported = 0;

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;

      if (processedCount > 0 && processedCount % PAUSE_CHECK_EVERY === 0) {
        if (await isRunPaused(runId)) {
          logger.info('Import paused by user', { runId });
          return;
        }
      }

      await updateRunProgress(runId, { last_folder_id: current.folderId });

      try {
        for await (const item of iterateChildren(current.folderId)) {
          if (item.TYPE === 'folder') {
            queue.push({ folderId: item.ID, path: `${current.path}/${item.NAME}`.replace(/\/+/g, '/') });
            await updateRunProgress(runId, { files_scanned: 1 });
            continue;
          }

          if (item.TYPE !== 'file') continue;

          if (config.maxFiles !== undefined && filesImported >= config.maxFiles) {
            logger.info('maxFiles reached, stopping', { runId, filesImported });
            await markRunFinished(runId, 'completed');
            return;
          }

          await updateRunProgress(runId, { files_scanned: 1, last_file_id: item.ID });

          try {
            const outcome = await processFile(item, current.path, portalHost, runId, config);
            if (outcome.status === 'imported') {
              await updateRunProgress(runId, { files_imported: 1, bytes_imported: outcome.size ?? 0 });
              filesImported += 1;
            } else if (outcome.status === 'skipped') {
              await updateRunProgress(runId, { files_skipped: 1 });
            }
          } catch (fileErr) {
            const msg = (fileErr as Error).message.slice(0, 400);
            logger.error('File processing error', { fileId: item.ID, err: msg });
            recordError('file_process');
            await updateRunProgress(runId, { errors_count: 1, last_error: msg });
          }

          processedCount += 1;
        }
      } catch (folderErr) {
        const msg = (folderErr as Error).message.slice(0, 400);
        logger.error('Folder iteration error', { folderId: current.folderId, err: msg });
        recordError('folder_iterate');
        await updateRunProgress(runId, { errors_count: 1, last_error: msg });
      }
    }

    await markRunFinished(runId, 'completed');
    logger.info('Import run completed', { runId });
  } catch (err) {
    const msg = (err as Error).message.slice(0, 400);
    logger.error('Import run failed', { runId, err: msg });
    recordError('run_failed');
    await markRunFinished(runId, 'failed', msg);
  }
}

export async function pauseRun(runId: number): Promise<void> {
  await db.query(`UPDATE bitrix_import_runs SET status = 'paused' WHERE id = $1 AND status = 'running'`, [runId]);
}

export async function resumeRun(runId: number): Promise<void> {
  const row = await db.queryOne<BitrixImportRunWithConfig>(
    `SELECT id, config FROM bitrix_import_runs WHERE id = $1`,
    [runId],
  );
  if (!row) throw new Error(`Run ${runId} not found`);
  await db.query(`UPDATE bitrix_import_runs SET status = 'running' WHERE id = $1`, [runId]);
  const cfg = ((row.config as ImportRunConfig | null) ?? {}) as ImportRunConfig;
  setImmediate(() => {
    runImport(runId, cfg).catch((err) => {
      logger.error('Import resume crashed', { runId, err: (err as Error).message });
    });
  });
}

export async function cancelRun(runId: number): Promise<void> {
  await db.query(
    `UPDATE bitrix_import_runs SET status = 'cancelled', finished_at = now() WHERE id = $1`,
    [runId],
  );
}

export async function getLatestRun(): Promise<BitrixImportRunRow | null> {
  const row = await db.queryOne<BitrixImportRunRow>(
    `SELECT id, status, started_at, finished_at, last_folder_id, last_file_id,
            files_scanned, files_imported, files_skipped, bytes_imported,
            errors_count, last_error, initiated_by, config
     FROM bitrix_import_runs
     ORDER BY started_at DESC
     LIMIT 1`,
  );
  return row ?? null;
}
