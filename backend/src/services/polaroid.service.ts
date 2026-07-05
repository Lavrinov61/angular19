/**
 * Polaroid Service — generates Polaroid 600 photos on 10×15 sheets.
 *
 * Uses Python worker (polaroid_generator.py) with MediaPipe face detection
 * for smart vertical cropping. Uploads results to S3.
 *
 * Flow: image URL → Python worker (crop + compose) → S3 upload → return URL
 */
import { execFile } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlink } from 'fs/promises';
import PQueue from 'p-queue';
import { storageService } from './storage.service.js';
import { createLogger } from '../utils/logger.js';

const __dirname2 = dirname(fileURLToPath(import.meta.url));

const logger = createLogger('polaroid');
const PYTHON_PATH = '/var/www/apimain/multiplatformpublic/venv/bin/python3';
const WORKER_PATH = resolve(__dirname2, '../../workers/polaroid_generator.py');
const WORKER_TIMEOUT = 60_000;

// Concurrency pool — max 2 parallel (heavy image processing + MediaPipe)
const workerQueue = new PQueue({ concurrency: 2 });

export interface PolaroidResult {
  /** S3 URL of the generated Polaroid image */
  url: string;
  /** S3 object key */
  s3Key: string;
  /** Whether a face was detected for smart cropping */
  faceDetected: boolean;
  /** Vertical crop offset in pixels */
  cropTop: number;
  /** Processing time in ms */
  processingTimeMs: number;
}

export interface PolaroidBatchResult {
  results: Array<PolaroidResult & { originalUrl: string }>;
  totalTimeMs: number;
}

interface WorkerOutput {
  success: boolean;
  result?: {
    output_path: string;
    face_detected: boolean;
    crop_top: number;
    width: number;
    height: number;
    processing_time_ms: number;
  };
  error?: string;
}

/**
 * Generate a single Polaroid image from a source photo.
 * Downloads from S3, applies smart crop + Polaroid frame, uploads result to S3.
 */
export async function generatePolaroid(
  imageUrl: string,
  opts: {
    faceData?: { forehead_y: number; chin_y: number; image_width: number; image_height: number };
    createdBy?: string;
  } = {},
): Promise<PolaroidResult> {
  return workerQueue.add(async () => {
    const outputId = randomUUID();
    const outputPath = join(tmpdir(), `polaroid_${outputId}.jpg`);

    try {
      // Build worker input
      const workerInput: Record<string, unknown> = { output_path: outputPath };

      // Resolve S3 key for local download (faster than HTTP round-trip)
      const s3Key = storageService.keyFromUrl(imageUrl);
      if (s3Key) {
        const localPath = await storageService.downloadToTemp(s3Key);
        workerInput['image_path'] = localPath;
      } else {
        workerInput['image_url'] = imageUrl;
      }

      if (opts.faceData) {
        workerInput['face_data'] = opts.faceData;
      }

      // Call Python worker
      const result = await callWorker(workerInput);

      // Read output file and upload to S3
      const { readFile } = await import('fs/promises');
      const buffer = await readFile(outputPath);
      const s3UploadKey = `polaroid/${outputId}.jpg`;
      const uploaded = await storageService.upload(buffer, s3UploadKey, 'image/jpeg');

      logger.info(`[Polaroid] Generated: face=${result.face_detected}, ${result.processing_time_ms}ms → ${s3UploadKey}`);

      return {
        url: uploaded.url,
        s3Key: s3UploadKey,
        faceDetected: result.face_detected,
        cropTop: result.crop_top,
        processingTimeMs: result.processing_time_ms,
      };
    } finally {
      // Cleanup temp file
      await unlink(outputPath).catch(() => {});
    }
  });
}

/**
 * Generate Polaroid images for a batch of photos.
 * Processes sequentially within the concurrency pool.
 */
export async function generatePolaroidBatch(
  imageUrls: string[],
  opts: { createdBy?: string } = {},
): Promise<PolaroidBatchResult> {
  const start = Date.now();

  const results = await Promise.all(
    imageUrls.map(async (url) => {
      const result = await generatePolaroid(url, { createdBy: opts.createdBy });
      return { ...result, originalUrl: url };
    }),
  );

  return {
    results,
    totalTimeMs: Date.now() - start,
  };
}

/**
 * Call the Python polaroid_generator.py worker via execFile + stdin.
 */
function callWorker(input: Record<string, unknown>): Promise<NonNullable<WorkerOutput['result']>> {
  const inputJson = JSON.stringify(input);

  return new Promise((resolve, reject) => {
    const child = execFile(PYTHON_PATH, [WORKER_PATH], {
      timeout: WORKER_TIMEOUT,
      maxBuffer: 5 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (stderr) {
        logger.info('[Polaroid] Worker stderr:', { detail: stderr.slice(0, 500) });
      }
      if (error) {
        logger.error('[Polaroid] Worker error:', { detail: error.message });
        reject(new Error(`Polaroid worker failed: ${error.message}`));
        return;
      }
      try {
        const parsed: WorkerOutput = JSON.parse(stdout);
        if (parsed.success && parsed.result) {
          resolve(parsed.result);
        } else {
          reject(new Error(parsed.error || 'Polaroid worker returned no result'));
        }
      } catch (e) {
        logger.error('[Polaroid] Failed to parse worker output:', { error: String(e), stdout: stdout.slice(0, 200) });
        reject(new Error('Failed to parse polaroid worker output'));
      }
    });

    child.stdin?.write(inputJson);
    child.stdin?.end();
  });
}
