import { execFile } from 'child_process';
import { existsSync } from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path, { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { storageService } from '../storage.service.js';
import { createLogger } from '../../utils/logger.js';
import type { CropPlan, CropWarning } from './crop-geometry.js';

const __dirname2 = dirname(fileURLToPath(import.meta.url));
const logger = createLogger('photo-retouch-tool');
const TOOL_TIMEOUT_MS = 45_000;
const TOOL_MAX_BUFFER = 8 * 1024 * 1024;

export interface RustDetectCropLinesResult {
  imageWidth: number;
  imageHeight: number;
  crownY: number | null;
  chinY: number | null;
  centerX: number | null;
  tilt: number | null;
  faceDetected: boolean;
  verdict: string;
}

export interface RustCropDocumentParams {
  documentType: string;
  crownY: number;
  chinY: number;
  centerX: number;
  rotationDeg: number;
  preset: {
    photoWmm: number;
    photoHmm: number;
    topMarginMm: number;
    headHeightMm: number;
    dpi: number;
    jpegQuality: number;
  };
}

export interface RustCropDocumentResult {
  buffer: Buffer;
  plan: CropPlan;
}

interface ToolEnvelope {
  success: boolean;
  result: unknown;
  error: string | null;
}

interface UnknownObject {
  readonly [key: string]: unknown;
}

export async function checkPhotoRetouchTool(): Promise<void> {
  await runTool({ operation: 'health' });
}

export async function detectCropLinesRust(photoUrl: string): Promise<RustDetectCropLinesResult> {
  const { buffer, tempDir } = await writeStoredImageToTemp(photoUrl);
  try {
    const imagePath = path.join(tempDir, 'source-image');
    await fsp.writeFile(imagePath, buffer);
    const result = await runTool({
      operation: 'detect_crop_lines',
      image_path: imagePath,
    });
    return parseDetectCropLinesResult(result);
  } finally {
    await cleanupTempDir(tempDir);
  }
}

export async function cropDocumentRust(
  photoUrl: string,
  params: RustCropDocumentParams,
): Promise<RustCropDocumentResult> {
  const { buffer, tempDir } = await writeStoredImageToTemp(photoUrl);
  try {
    const imagePath = path.join(tempDir, 'source-image');
    const outputPath = path.join(tempDir, 'document-crop.jpg');
    await fsp.writeFile(imagePath, buffer);
    const result = await runTool({
      operation: 'crop_document',
      imagePath,
      outputPath,
      documentType: params.documentType,
      crownY: params.crownY,
      chinY: params.chinY,
      centerX: params.centerX,
      rotationDeg: params.rotationDeg,
      preset: params.preset,
    });
    const plan = parseCropDocumentResult(result).plan;
    const out = await fsp.readFile(outputPath);
    return { buffer: out, plan };
  } finally {
    await cleanupTempDir(tempDir);
  }
}

async function writeStoredImageToTemp(photoUrl: string): Promise<{ buffer: Buffer; tempDir: string }> {
  const key = storageKeyFromUrl(photoUrl);
  if (!key) {
    throw new Error('photo_url must be from our storage');
  }
  const { buffer } = await storageService.downloadToBuffer(key);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'photo-retouch-tool-'));
  return { buffer, tempDir };
}

function storageKeyFromUrl(url: string): string | null {
  const direct = storageService.keyFromUrl(url);
  if (direct) return direct;

  const mediaPrefix = '/media/';
  if (url.startsWith(mediaPrefix)) {
    return decodeStorageKey(url.slice(mediaPrefix.length));
  }

  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith(mediaPrefix)) {
      return decodeStorageKey(parsed.pathname.slice(mediaPrefix.length));
    }
  } catch {
    return null;
  }
  return null;
}

function decodeStorageKey(value: string): string | null {
  const clean = value.split('?')[0]?.split('#')[0] ?? '';
  if (!clean) return null;
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await fsp.rm(tempDir, { recursive: true, force: true });
  } catch (err) {
    logger.warn('[PhotoRetouchTool] temp cleanup failed', { tempDir, error: String(err) });
  }
}

async function runTool(request: UnknownObject): Promise<unknown> {
  const toolPath = resolveToolPath();
  const input = JSON.stringify(request);

  return new Promise((resolveResult, rejectResult) => {
    const child = execFile(toolPath, [], {
      timeout: TOOL_TIMEOUT_MS,
      maxBuffer: TOOL_MAX_BUFFER,
    }, (error, stdout, stderr) => {
      if (stderr.trim()) {
        logger.info('[PhotoRetouchTool] stderr', { detail: stderr.slice(0, 500) });
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        if (error) {
          rejectResult(new Error(`Photo retouch Rust tool failed: ${error.message}`));
          return;
        }
        rejectResult(new Error('Photo retouch Rust tool returned invalid JSON'));
        return;
      }

      const envelope = parseEnvelope(parsed);
      if (!envelope.success) {
        rejectResult(new Error(envelope.error ?? 'Photo retouch Rust tool failed'));
        return;
      }
      resolveResult(envelope.result);
    });

    child.stdin?.write(input);
    child.stdin?.end();
  });
}

function resolveToolPath(): string {
  const envPath = process.env['PHOTO_RETOUCH_TOOL_PATH'];
  const candidates = [
    envPath,
    resolve(__dirname2, '../../../bin/photo-retouch-tool'),
    resolve(__dirname2, '../../bin/photo-retouch-tool'),
    resolve(process.cwd(), '../photo-retouch-tool/target/release/photo-retouch-tool'),
    resolve(process.cwd(), '../photo-retouch-tool/target/debug/photo-retouch-tool'),
    resolve(process.cwd(), 'photo-retouch-tool/target/release/photo-retouch-tool'),
    resolve(process.cwd(), 'photo-retouch-tool/target/debug/photo-retouch-tool'),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0] ?? 'photo-retouch-tool';
}

function parseEnvelope(value: unknown): ToolEnvelope {
  if (!isRecord(value)) {
    throw new Error('Photo retouch Rust tool returned invalid envelope');
  }
  const success = Reflect.get(value, 'success');
  const result = Reflect.get(value, 'result');
  const error = Reflect.get(value, 'error');
  if (typeof success !== 'boolean') {
    throw new Error('Photo retouch Rust tool returned invalid success flag');
  }
  return {
    success,
    result,
    error: typeof error === 'string' ? error : null,
  };
}

function parseDetectCropLinesResult(value: unknown): RustDetectCropLinesResult {
  if (!isRecord(value)) {
    throw new Error('Photo retouch Rust tool returned invalid detect result');
  }
  return {
    imageWidth: readNumber(value, 'imageWidth'),
    imageHeight: readNumber(value, 'imageHeight'),
    crownY: readNullableNumber(value, 'crownY'),
    chinY: readNullableNumber(value, 'chinY'),
    centerX: readNullableNumber(value, 'centerX'),
    tilt: readNullableNumber(value, 'tilt'),
    faceDetected: readBoolean(value, 'faceDetected'),
    verdict: readString(value, 'verdict'),
  };
}

function parseCropDocumentResult(value: unknown): { plan: CropPlan } {
  if (!isRecord(value)) {
    throw new Error('Photo retouch Rust tool returned invalid crop result');
  }
  const plan = Reflect.get(value, 'plan');
  return { plan: parseCropPlan(plan) };
}

function parseCropPlan(value: unknown): CropPlan {
  if (!isRecord(value)) {
    throw new Error('Photo retouch Rust tool returned invalid crop plan');
  }
  const extract = readRecord(value, 'extract');
  const extend = readRecord(value, 'extend');
  const target = readRecord(value, 'target');
  const warnings = Reflect.get(value, 'warnings');
  return {
    extract: {
      left: readNumber(extract, 'left'),
      top: readNumber(extract, 'top'),
      width: readNumber(extract, 'width'),
      height: readNumber(extract, 'height'),
    },
    extend: {
      top: readNumber(extend, 'top'),
      bottom: readNumber(extend, 'bottom'),
      left: readNumber(extend, 'left'),
      right: readNumber(extend, 'right'),
    },
    target: {
      width: readNumber(target, 'width'),
      height: readNumber(target, 'height'),
    },
    density: readNumber(value, 'density'),
    jpegQuality: readNumber(value, 'jpegQuality'),
    warnings: Array.isArray(warnings) ? warnings.map(parseCropWarning) : [],
  };
}

function parseCropWarning(value: unknown): CropWarning {
  if (!isRecord(value)) {
    throw new Error('Photo retouch Rust tool returned invalid crop warning');
  }
  return {
    code: readWarningCode(readString(value, 'code')),
    valuePx: readNumber(value, 'valuePx'),
    valueMm: readNullableNumber(value, 'valueMm') ?? undefined,
  };
}

function readWarningCode(value: string): CropWarning['code'] {
  switch (value) {
    case 'extend_top':
    case 'extend_bottom':
    case 'extend_left':
    case 'extend_right':
    case 'low_resolution':
      return value;
    default:
      throw new Error(`Unknown crop warning code: ${value}`);
  }
}

function readRecord(value: UnknownObject, key: string): UnknownObject {
  const nested = Reflect.get(value, key);
  if (!isRecord(nested)) {
    throw new Error(`Photo retouch Rust tool returned invalid ${key}`);
  }
  return nested;
}

function readNumber(value: UnknownObject, key: string): number {
  const item = Reflect.get(value, key);
  if (typeof item !== 'number' || !Number.isFinite(item)) {
    throw new Error(`Photo retouch Rust tool returned invalid number: ${key}`);
  }
  return item;
}

function readNullableNumber(value: UnknownObject, key: string): number | null {
  const item = Reflect.get(value, key);
  if (item == null) return null;
  if (typeof item !== 'number' || !Number.isFinite(item)) {
    throw new Error(`Photo retouch Rust tool returned invalid number: ${key}`);
  }
  return item;
}

function readBoolean(value: UnknownObject, key: string): boolean {
  const item = Reflect.get(value, key);
  if (typeof item !== 'boolean') {
    throw new Error(`Photo retouch Rust tool returned invalid boolean: ${key}`);
  }
  return item;
}

function readString(value: UnknownObject, key: string): string {
  const item = Reflect.get(value, key);
  if (typeof item !== 'string') {
    throw new Error(`Photo retouch Rust tool returned invalid string: ${key}`);
  }
  return item;
}

function isRecord(value: unknown): value is UnknownObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
