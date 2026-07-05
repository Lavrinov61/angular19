import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import archiver from 'archiver';
import { pool } from '../../database/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import { mediaDownloadLimiter } from './chat-shared.js';
import { storageService } from '../../services/storage.service.js';
import { isAllowedMediaDomain } from '../../config/media-domains.js';
import { convertImageBufferToJpeg, needsJpegConversion, replaceExtForJpeg } from '../../utils/image-convert.js';
import { appendReadableToArchive } from '../../utils/archive-utils.js';

import { createLogger } from '../../utils/logger.js';
const router = Router();

const logger = createLogger('chat-media.routes');
// ===== Безопасная резолюция путей (защита от Path Traversal) =====
const BASE_DIR = process.cwd();

interface SessionMediaDownloadRow {
  id: string;
  sender_type: string;
  attachment_url: string;
  created_at: string;
  detected_mime: string | null;
  original_file_name: string | null;
}

/** Безопасно резолвит путь -- проверяет что результат внутри BASE_DIR */
function safePath(relativePath: string): string | null {
  const cleaned = relativePath.replace(/^\//, '');
  const resolved = path.resolve(BASE_DIR, cleaned);
  if (!resolved.startsWith(BASE_DIR + path.sep) && resolved !== BASE_DIR) {
    logger.warn(`[Security] Path traversal blocked: ${relativePath} → ${resolved}`);
    return null;
  }
  return resolved;
}

// ============================================================================
// Media API (public — for visitors)
// ============================================================================

/**
 * Получить медиа-файлы сессии
 * GET /sessions/:sessionId/media
 */
router.get('/sessions/:sessionId/media', async (req: Request, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const { type } = req.query;

  const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);

  let query = `
    SELECT id, sender_type, content, attachment_url, created_at
    FROM messages
    WHERE conversation_id = $1
      AND message_type = 'image'
      AND attachment_url IS NOT NULL
  `;
  const params: unknown[] = [sessionId];

  if (type === 'sent') {
    query += ` AND sender_type = 'visitor'`;
  } else if (type === 'received') {
    query += ` AND sender_type IN ('operator', 'bot')`;
  }

  const countResult = await pool.query(
    query.replace('SELECT id, sender_type, content, attachment_url, created_at', 'SELECT COUNT(*) as total'),
    params,
  );
  const total = parseInt(countResult.rows[0].total, 10);

  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await pool.query(query, params);

  res.json({
    success: true,
    data: result.rows.map(row => ({
      id: row.id,
      url: row.attachment_url,
      type: row.sender_type === 'visitor' ? 'sent' : 'received',
      caption: row.content !== '\u{1F4F7} Фото' ? row.content : null,
      timestamp: row.created_at
    })),
    pagination: { total, limit, offset, hasMore: offset + limit < total },
  });
});

/**
 * Скачать все медиа сессии как ZIP
 * GET /sessions/:sessionId/download
 */
router.get('/sessions/:sessionId/download', mediaDownloadLimiter, async (req: Request, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const { type } = req.query; // 'sent' | 'received' | undefined

  // Получаем медиа-файлы
  let query = `
    SELECT m.id, m.sender_type, COALESCE(m.attachment_url, ma.s3_url) AS attachment_url,
           m.created_at, ma.mime_type AS detected_mime, ma.file_name AS original_file_name
    FROM messages m
    LEFT JOIN media_attachments ma ON ma.message_id = m.id
    WHERE m.conversation_id = $1
      AND m.message_type = 'image'
      AND COALESCE(m.attachment_url, ma.s3_url) IS NOT NULL
  `;
  const params: unknown[] = [sessionId];

  if (type === 'sent') {
    query += ` AND m.sender_type = 'visitor'`;
  } else if (type === 'received') {
    query += ` AND m.sender_type IN ('operator', 'bot')`;
  }

  query += ` ORDER BY m.created_at ASC`;

  const result = await pool.query<SessionMediaDownloadRow>(query, params);

  if (result.rows.length === 0) {
    throw new AppError(404, 'No media files found');
  }

  // Создаём ZIP архив
  const archive = archiver('zip', { zlib: { level: 9 } });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="photos-${sessionId.substring(0, 8)}.zip"`);

  archive.pipe(res);

  // Добавляем файлы в архив
  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows[i];
    const url = row.attachment_url;

    // Извлекаем имя файла из URL и конвертируем WebP/HEIC → JPEG
    const rawFilename = row.original_file_name || url.split('/').pop()?.split('?')[0] || `photo-${i + 1}.jpg`;
    const convertToJpeg = needsJpegConversion(row.detected_mime, url);
    const filename = convertToJpeg ? replaceExtForJpeg(rawFilename) : rawFilename;
    const prefix = row.sender_type === 'visitor' ? 'original' : 'processed';
    const archiveName = `${prefix}_${i + 1}_${filename}`;

    try {
      if (url.startsWith('/uploads/')) {
        const localPath = safePath(url);
        if (localPath && fs.existsSync(localPath)) {
          if (convertToJpeg) {
            const source = await fs.promises.readFile(localPath);
            const jpeg = await convertImageBufferToJpeg(source, row.detected_mime, url);
            archive.append(jpeg, { name: archiveName });
          } else {
            archive.file(localPath, { name: archiveName });
          }
        }
      } else {
        // For S3 URLs — use SDK directly (no public URL dependency)
        const s3Key = storageService.keyFromUrl(url);
        if (s3Key) {
          if (convertToJpeg) {
            const { buffer } = await storageService.downloadToBuffer(s3Key);
            const jpeg = await convertImageBufferToJpeg(buffer, row.detected_mime, url);
            archive.append(jpeg, { name: archiveName });
          } else {
            const stream = await storageService.getReadStream(s3Key);
            await appendReadableToArchive(archive, stream, archiveName);
          }
        } else {
          // Fallback for non-S3 external URLs
          const parsed = new URL(url);
          if (!isAllowedMediaDomain(parsed.hostname)) {
            logger.warn(`[Security] SSRF blocked: ${url}`);
            continue;
          }
          const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
          let buf = Buffer.from(response.data);
          if (convertToJpeg) {
            buf = await convertImageBufferToJpeg(buf, row.detected_mime, url);
          }
          archive.append(buf, { name: archiveName });
        }
      }
    } catch (err) {
      logger.error(`Failed to download ${url}:`, { error: String(err) });
    }
  }

  await archive.finalize();
});

/**
 * Сохранить выбор и комментарии клиента
 * POST /sessions/:sessionId/feedback
 */
router.post('/sessions/:sessionId/feedback', async (req: Request, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const { selectedPhotoId, feedback } = req.body;

  // Сохраняем feedback в метаданные сессии
  await pool.query(
    `UPDATE conversations
     SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
     WHERE id = $1`,
    [sessionId, JSON.stringify({
      photo_feedback: {
        selected_photo_id: selectedPhotoId,
        feedback: feedback,
        submitted_at: new Date().toISOString()
      }
    })]
  );

  res.json({
    success: true,
    message: 'Feedback saved successfully'
  });
});

export default router;
