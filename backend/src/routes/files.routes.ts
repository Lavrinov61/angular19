import { Router, Request, Response } from 'express';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../database/db.js';
import { authenticateToken, optionalAuth, AuthRequest } from '../middleware/auth.js';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { verifySignedUrl } from '../services/signed-url.service.js';
import { createUploadLimiter } from '../middleware/upload-limiter.js';

import { createLogger } from '../utils/logger.js';
const router = Router();

const logger = createLogger('files.routes');
// Ensure upload directory exists
async function ensureUploadDir() {
  try {
    await fs.mkdir(config.upload.dir, { recursive: true });
  } catch (error) {
    logger.error('Failed to create upload directory:', { error: String(error) });
  }
}

ensureUploadDir();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (_req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    await ensureUploadDir();
    cb(null, config.upload.dir);
  },
  filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: config.upload.maxFileSize,
  },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (config.upload.allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  },
});

// Extend AuthRequest to include file property
interface FileAuthRequest extends AuthRequest {
  file?: Express.Multer.File;
}

// Upload file
const fileUploadLimiter = createUploadLimiter('ul-files:', 100, 15 * 60 * 1000);

router.post('/upload', optionalAuth, fileUploadLimiter, upload.single('file'), async (req: FileAuthRequest, res: Response): Promise<void> => {
  if (!req.file) {
    throw new AppError(400, 'No file uploaded');
  }

  const fileId = uuidv4();
  const filePath = path.join(config.upload.dir, req.file.filename);

  // Save file metadata to database (user_id nullable for guests)
  const result = await pool.query(
    `INSERT INTO files (id, user_id, file_name, original_name, file_path, file_size, mime_type, storage_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      fileId,
      req.user?.id || null,
      req.file.filename,
      req.file.originalname,
      filePath,
      req.file.size,
      req.file.mimetype,
      'local',
    ]
  );

  const fileRecord = result.rows[0];

  res.status(201).json({
    success: true,
    data: {
      id: fileRecord.id,
      fileName: fileRecord.file_name,
      originalName: fileRecord.original_name,
      fileSize: fileRecord.file_size,
      mimeType: fileRecord.mime_type,
      url: `/api/files/${fileRecord.id}/download`,
    },
  });
});

// Get file metadata
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const result = await pool.query('SELECT id, user_id, file_name, original_name, file_size, mime_type, file_path, uploaded_at FROM files WHERE id = $1', [id]);

  if (result.rows.length === 0) {
    throw new AppError(404, 'File not found');
  }

  const file = result.rows[0];

  // Check permissions: user can only see their own files or admins can see all
  if (!req.user || (file.user_id !== req.user.id && req.user.role !== 'admin')) {
    throw new AppError(403, 'Forbidden');
  }

  res.json({
    success: true,
    data: {
      id: file.id,
      fileName: file.file_name,
      originalName: file.original_name,
      fileSize: file.file_size,
      mimeType: file.mime_type,
      url: `/api/files/${file.id}/download`,
      uploadedAt: file.uploaded_at,
    },
  });
});

// Download file — requires JWT auth OR signed URL
router.get('/:id/download', optionalAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const result = await pool.query('SELECT id, user_id, file_name, original_name, file_size, mime_type, file_path, uploaded_at FROM files WHERE id = $1', [id]);

  if (result.rows.length === 0) {
    throw new AppError(404, 'File not found');
  }

  const file = result.rows[0];

  // ── Access control ───────────────────────────────────────────────────
  const hasSignedUrl = req.query['sig'] && req.query['exp'];
  const isAuthenticated = !!req.user;

  if (hasSignedUrl) {
    // Verify HMAC signature + expiry
    const valid = verifySignedUrl(req.originalUrl, config.guestSession.secret);
    if (!valid) {
      throw new AppError(403, 'Invalid or expired download link');
    }
  } else if (isAuthenticated) {
    // Authenticated user: must own the file, or be staff (admin/employee)
    const isStaff = req.user!.role === 'admin' || req.user!.role === 'employee';
    if (file.user_id && file.user_id !== req.user!.id && !isStaff) {
      throw new AppError(403, 'Access denied');
    }
  } else if (file.user_id) {
    // No auth, no signed URL, but file belongs to a user → deny
    throw new AppError(403, 'Authentication required');
  } else {
    // Guest file (user_id IS NULL) without signed URL — must use presigned URL
    throw new AppError(403, 'Signed download URL required');
  }

  const filePath = path.resolve(file.file_path);
  const fileExists = await fs.access(filePath).then(() => true).catch(() => false);

  if (!fileExists) {
    throw new AppError(404, 'File not found on disk');
  }

  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
  res.sendFile(filePath);
});

// Delete file
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const { id } = req.params;

  const result = await pool.query('SELECT id, user_id, file_name, original_name, file_size, mime_type, file_path, uploaded_at FROM files WHERE id = $1', [id]);

  if (result.rows.length === 0) {
    throw new AppError(404, 'File not found');
  }

  const file = result.rows[0];

  // Check permissions: user can only delete their own files or admins can delete all
  if (file.user_id !== req.user.id && req.user.role !== 'admin') {
    throw new AppError(403, 'Forbidden');
  }

  // Delete file from disk
  const filePath = path.resolve(file.file_path);
  await fs.unlink(filePath).catch(() => {
    // Ignore errors if file doesn't exist
  });

  // Delete file record from database
  await pool.query('DELETE FROM files WHERE id = $1', [id]);

  res.json({ success: true, message: 'File deleted successfully' });
});

export default router;
