import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { execFile } from 'child_process';
import { pool } from '../database/db.js';
import { optionalAuth, AuthRequest } from '../middleware/auth.js';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';

import { createLogger } from '../utils/logger.js';
const router = Router();

const logger = createLogger('photo-enhance.routes');
const enhancedDir = path.resolve(config.upload.dir, 'enhanced');

// Ensure enhanced directory exists
async function ensureEnhancedDir() {
  try {
    await fs.mkdir(enhancedDir, { recursive: true });
  } catch (error) {
    logger.error('Failed to create enhanced directory:', { error: String(error) });
  }
}

ensureEnhancedDir();

// Run Sharp in a child process to avoid Zone.js Promise conflict with Sharp native code
function enhanceWithSharp(inputPath: string, outputPath: string): Promise<{ width: number; height: number; size: number }> {
  return new Promise((resolve, reject) => {
    const script = `
      const sharp = require('sharp');
      const input = process.argv[1];
      const output = process.argv[2];
      sharp(input)
        .normalize()
        .sharpen({ sigma: 1.2 })
        .modulate({ brightness: 1.05, saturation: 1.1 })
        .gamma(1.1)
        .jpeg({ quality: 92 })
        .toFile(output)
        .then(info => {
          process.stdout.write(JSON.stringify({ width: info.width, height: info.height, size: info.size }));
        })
        .catch(err => {
          process.stderr.write(err.message);
          process.exit(1);
        });
    `;
    execFile('node', ['-e', script, inputPath, outputPath], { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error('Invalid Sharp output'));
        }
      }
    });
  });
}

// POST /api/photo-enhance/enhance — AI-улучшение загруженного фото
router.post('/enhance', optionalAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { fileId } = req.body;
  if (!fileId) {
    throw new AppError(400, 'fileId is required');
  }

  // Find original file (by id only — guests don't have user_id)
  const fileResult = await pool.query(
    'SELECT id, user_id, file_name, original_name, file_path, file_size, mime_type, storage_type FROM files WHERE id = $1',
    [fileId]
  );

  if (fileResult.rows.length === 0) {
    throw new AppError(404, 'File not found');
  }

  const file = fileResult.rows[0];
  const originalPath = path.resolve(file.file_path);

  // Check file exists on disk
  const fileExists = await fs.access(originalPath).then(() => true).catch(() => false);
  if (!fileExists) {
    throw new AppError(404, 'Original file not found on disk');
  }

  // Generate enhanced file name
  const enhancedFileName = `${uuidv4()}.jpg`;
  const enhancedPath = path.join(enhancedDir, enhancedFileName);

  // Run Sharp in child process (avoids Angular Zone.js Promise patching conflict)
  const metadata = await enhanceWithSharp(originalPath, enhancedPath);

  // Save enhanced file record to database
  const enhancedFileId = uuidv4();
  await pool.query(
    `INSERT INTO files (id, user_id, file_name, original_name, file_path, file_size, mime_type, storage_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      enhancedFileId,
      req.user?.id || null,
      enhancedFileName,
      `enhanced_${file.original_name}`,
      enhancedPath,
      metadata.size,
      'image/jpeg',
      'local',
    ]
  );

  res.json({
    success: true,
    data: {
      originalFileId: fileId,
      enhancedFileId,
      originalUrl: `/api/files/${fileId}/download`,
      enhancedUrl: `/api/files/${enhancedFileId}/download`,
      metadata: {
        width: metadata.width,
        height: metadata.height,
        size: metadata.size,
      },
    },
  });
});

export default router;
