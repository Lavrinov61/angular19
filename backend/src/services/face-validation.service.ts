/**
 * Face Validation Service — Rust photo-retouch-tool based document face estimate.
 * Measures head height in mm from detected crown/chin crop lines.
 * SECURITY: URL whitelist/storage guard, worker concurrency pool, timeout enforcement.
 */
import PQueue from 'p-queue';
import { pool } from '../database/db.js';
import { MEDIA_ALLOWED_DOMAINS } from '../config/media-domains.js';
import { createLogger } from '../utils/logger.js';
import { checkPhotoRetouchTool, detectCropLinesRust } from './crop/photo-retouch-tool.service.js';

const logger = createLogger('face-validation');
const STANDARDS: Readonly<Record<'passport_35x45' | 'greencard_50x50', readonly [number, number]>> = {
  passport_35x45: [30.0, 34.0],
  greencard_50x50: [37.0, 42.0],
};

// Worker concurrency pool — prevent OOM DoS (p-queue v9.1.0)
// Max 3 parallel Rust tool processes, unlimited queue size
const workerQueue = new PQueue({ concurrency: 3 });

export interface FaceValidationResult {
  face_detected: boolean;
  face_count: number;
  face_height_px: number | null;
  face_height_mm: number | null;
  face_width_px: number | null;
  face_width_mm: number | null;
  forehead_y: number | null;
  chin_y: number | null;
  eye_level_delta_px: number | null;
  /** Центр лица (между глаз), px по горизонтали. Для crop-detect (аддитивно, опц.). */
  center_x?: number | null;
  /** Наклон головы в градусах [-90,90] со знаком. Для crop-detect UI-warning (опц.). */
  tilt?: number | null;
  /** Макушка головы, px (эвристика воркера). Для crop-detect стартовой линии (опц.). */
  crown_y?: number | null;
  image_width: number;
  image_height: number;
  image_dpi: number;
  dpi_source: string;
  landmarks_count: number;
  verdict: string;
  is_valid_passport: boolean;
  is_valid_greencard: boolean;
  processing_time_ms: number;
}

export interface FaceValidationRow extends FaceValidationResult {
  id: string;
  photo_approval_id: string | null;
  message_id: string | null;
  image_url: string;
  validated_by: string | null;
  created_at: string;
}

export interface FaceValidationWorkerHealth {
  ok: boolean;
  status: 'healthy' | 'unhealthy';
  latencyMs: number;
  error: string | null;
}

/**
 * Fast process-level probe for the Rust photo-retouch tool.
 */
export async function checkFaceValidationWorker(): Promise<FaceValidationWorkerHealth> {
  const startedAt = Date.now();
  try {
    await checkPhotoRetouchTool();
    return {
      ok: true,
      status: 'healthy',
      latencyMs: Date.now() - startedAt,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      status: 'unhealthy',
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Validate image URL — whitelist origins (SSRF prevention).
 */
function validateImageUrl(url: string): void {
  if (url.startsWith('/media/')) return;

  try {
    const parsed = new URL(url);

    // Whitelist allowed origins — centralized in media-domains.ts
    const hostname = parsed.hostname || '';
    const isAllowed = MEDIA_ALLOWED_DOMAINS.some(
      domain => hostname === domain || hostname.endsWith(`.${domain}`)
    );

    if (!isAllowed) {
      throw new Error(`Image URL must be from allowed origins (${MEDIA_ALLOWED_DOMAINS.join(', ')})`);
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Only HTTP(S) URLs allowed');
    }
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error('Invalid URL format');
    }
    throw err;
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Call Rust photo-retouch-tool via execFile + stdin.
 * Runs inside concurrency-limited queue to prevent OOM.
 */
export async function validateFace(imageUrl: string, dpiOverride?: number): Promise<FaceValidationResult> {
  validateImageUrl(imageUrl); // SSRF prevention

  return workerQueue.add(async () => {
    const startedAt = Date.now();
    const detected = await detectCropLinesRust(imageUrl);
    const dpi = dpiOverride && dpiOverride > 0 ? Math.round(dpiOverride) : 300;
    const dpiSource = dpiOverride && dpiOverride > 0 ? 'override' : 'default';

    if (!detected.faceDetected || detected.crownY == null || detected.chinY == null) {
      return {
        face_detected: false,
        face_count: 0,
        face_height_px: null,
        face_height_mm: null,
        face_width_px: null,
        face_width_mm: null,
        forehead_y: null,
        chin_y: null,
        eye_level_delta_px: null,
        center_x: detected.centerX,
        tilt: detected.tilt,
        crown_y: detected.crownY,
        image_width: detected.imageWidth,
        image_height: detected.imageHeight,
        image_dpi: dpi,
        dpi_source: dpiSource,
        landmarks_count: 0,
        verdict: detected.verdict,
        is_valid_passport: false,
        is_valid_greencard: false,
        processing_time_ms: Date.now() - startedAt,
      };
    }

    const faceHeightPx = detected.chinY - detected.crownY;
    const faceHeightMm = round1((faceHeightPx / dpi) * 25.4);
    const passport = STANDARDS['passport_35x45'];
    const greencard = STANDARDS['greencard_50x50'];
    const passportValid = faceHeightMm >= passport[0] && faceHeightMm <= passport[1];
    const greencardValid = faceHeightMm >= greencard[0] && faceHeightMm <= greencard[1];

    return {
      face_detected: true,
      face_count: 1,
      face_height_px: faceHeightPx,
      face_height_mm: faceHeightMm,
      face_width_px: null,
      face_width_mm: null,
      forehead_y: detected.crownY,
      chin_y: detected.chinY,
      eye_level_delta_px: null,
      center_x: detected.centerX,
      tilt: detected.tilt,
      crown_y: detected.crownY,
      image_width: detected.imageWidth,
      image_height: detected.imageHeight,
      image_dpi: dpi,
      dpi_source: dpiSource,
      landmarks_count: 0,
      verdict: passportValid ? 'ok' : faceHeightMm < passport[0] ? 'face_too_small' : 'face_too_large',
      is_valid_passport: passportValid,
      is_valid_greencard: greencardValid,
      processing_time_ms: Date.now() - startedAt,
    };
  });
}

/**
 * Validate face and persist result to face_validations table.
 */
export async function validateFaceAndSave(
  imageUrl: string,
  opts: {
    photoApprovalId?: string;
    messageId?: string;
    validatedBy?: string;
    dpiOverride?: number;
  } = {},
): Promise<FaceValidationRow> {
  const result = await validateFace(imageUrl, opts.dpiOverride);

  const { rows } = await pool.query<FaceValidationRow>(
    `INSERT INTO face_validations (
       photo_approval_id, message_id, image_url,
       image_dpi, dpi_source,
       face_detected, face_count,
       face_height_px, face_height_mm, face_width_px, face_width_mm,
       forehead_y, chin_y, eye_level_delta_px, landmarks_count,
       is_valid_passport, is_valid_greencard,
       verdict, verdict_details,
       validated_by, processing_time_ms
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     RETURNING *`,
    [
      opts.photoApprovalId || null,
      opts.messageId || null,
      imageUrl,
      result.image_dpi,
      result.dpi_source,
      result.face_detected,
      result.face_count,
      result.face_height_px,
      result.face_height_mm,
      result.face_width_px,
      result.face_width_mm,
      result.forehead_y,
      result.chin_y,
      result.eye_level_delta_px,
      result.landmarks_count,
      result.is_valid_passport ?? null,
      result.is_valid_greencard ?? null,
      result.verdict,
      JSON.stringify(result),
      opts.validatedBy || null,
      result.processing_time_ms,
    ],
  );

  logger.info(`[FaceValidation] Saved: ${result.verdict}, ${result.face_height_mm}mm, ${result.processing_time_ms}ms`);
  return rows[0];
}

/**
 * Get latest face validation for a photo approval.
 */
export async function getByPhotoApproval(photoApprovalId: string): Promise<FaceValidationRow | null> {
  const { rows } = await pool.query<FaceValidationRow>(
    `SELECT * FROM face_validations WHERE photo_approval_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [photoApprovalId],
  );
  return rows[0] || null;
}

/**
 * Get latest face validation for a chat message.
 */
export async function getByMessage(messageId: string): Promise<FaceValidationRow | null> {
  const { rows } = await pool.query<FaceValidationRow>(
    `SELECT * FROM face_validations WHERE message_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [messageId],
  );
  return rows[0] || null;
}
