/**
 * Client-side image resize before upload.
 * Reduces iPhone RAW photos from 20MB+ to 2-4MB for faster upload on 3G/4G.
 */

export interface ResizeOptions {
  /** Max width or height in px. Default 2048. */
  maxDimension: number;
  /** JPEG quality 0-1. Default 0.85. */
  quality: number;
  /** Skip resize if file smaller than this. Default 2MB. */
  maxSizeBytes: number;
  /** Output MIME type. Default 'image/jpeg'. */
  outputType: string;
}

const DEFAULT_OPTIONS: ResizeOptions = {
  maxDimension: 2048,
  quality: 0.85,
  maxSizeBytes: 2 * 1024 * 1024,
  outputType: 'image/jpeg',
};

/**
 * Resize image if it exceeds size/dimension thresholds.
 * Returns original file if resize is not needed or not possible.
 */
export async function resizeImageIfNeeded(
  file: File,
  options?: Partial<ResizeOptions>,
): Promise<File> {
  const opts: ResizeOptions = { ...DEFAULT_OPTIONS, ...options };

  // Skip non-images
  if (!file.type.startsWith('image/')) return file;

  // Skip formats that shouldn't be rasterized
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file;

  // WebP/HEIC must always be converted to JPEG regardless of size (photo studio requirement)
  const mustConvert = file.type === 'image/webp' || file.type === 'image/heic' || file.type === 'image/heif';

  // Skip small files unless format conversion is needed
  if (!mustConvert && file.size <= opts.maxSizeBytes) return file;

  try {
    const bitmap = await createImageBitmapFromFile(file);

    // Image could not be decoded (e.g. HEIC on unsupported browser)
    if (bitmap.width === 0 || bitmap.height === 0) return file;

    // Calculate scaled dimensions
    const { width, height } = scaleDimensions(
      bitmap.width,
      bitmap.height,
      opts.maxDimension,
    );

    // If already within limits and the file just happens to be large,
    // still re-encode to reduce size
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx || !('drawImage' in ctx)) {
      bitmap.close();
      return file;
    }

    (ctx as CanvasRenderingContext2D).drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await canvasToBlob(canvas, opts.outputType, opts.quality);

    // If re-encoding made it larger, return original
    if (blob.size >= file.size) return file;

    // Preserve original filename, adjust extension if type changed
    const name = adjustFileName(file.name, opts.outputType);
    return new File([blob], name, {
      type: opts.outputType,
      lastModified: file.lastModified,
    });
  } catch {
    // Any error (HEIC not supported, canvas tainted, etc.), return original
    return file;
  }
}

/**
 * Resize a single file in a Web Worker (off main thread).
 * Falls back to main-thread resize if Worker/OffscreenCanvas unavailable.
 */
function resizeInWorker(file: File, opts: ResizeOptions): Promise<File> {
  return new Promise((resolve) => {
    try {
      const worker = new Worker(
        new URL('../workers/image-resize.worker', import.meta.url),
        { type: 'module' },
      );
      worker.onmessage = (e: MessageEvent<{ file: File; resized: boolean }>) => {
        worker.terminate();
        resolve(e.data.file);
      };
      worker.onerror = () => {
        worker.terminate();
        // Fallback to main thread
        resizeImageIfNeeded(file, opts).then(resolve);
      };
      worker.postMessage({
        file,
        maxDimension: opts.maxDimension,
        quality: opts.quality,
        outputType: opts.outputType,
        maxSizeBytes: opts.maxSizeBytes,
      });
    } catch {
      resizeImageIfNeeded(file, opts).then(resolve);
    }
  });
}

/** True if Web Workers with OffscreenCanvas are available */
function canUseWorkerResize(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

/**
 * Batch resize for multiple files.
 * Uses Web Workers when available to avoid blocking the main thread.
 */
export function resizeImages(
  files: File[],
  options?: Partial<ResizeOptions>,
): Promise<File[]> {
  const opts: ResizeOptions = { ...DEFAULT_OPTIONS, ...options };
  if (canUseWorkerResize()) {
    return Promise.all(files.map(f => resizeInWorker(f, opts)));
  }
  return Promise.all(files.map(f => resizeImageIfNeeded(f, options)));
}

// ── Internal helpers ─────────────────────────────────────────────

function createImageBitmapFromFile(file: File): Promise<ImageBitmap> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }

  // Fallback for environments without createImageBitmap
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      // Check if image actually decoded
      if (img.naturalWidth === 0) {
        reject(new Error('Image could not be decoded'));
        return;
      }
      // Create a minimal ImageBitmap-like object
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Cannot get canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      createImageBitmap(canvas).then(resolve, reject);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image load failed'));
    };
    img.src = url;
  });
}

function scaleDimensions(
  origWidth: number,
  origHeight: number,
  maxDim: number,
): { width: number; height: number } {
  if (origWidth <= maxDim && origHeight <= maxDim) {
    return { width: origWidth, height: origHeight };
  }
  const ratio = Math.min(maxDim / origWidth, maxDim / origHeight);
  return {
    width: Math.round(origWidth * ratio),
    height: Math.round(origHeight * ratio),
  };
}

function createCanvas(
  width: number,
  height: number,
): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      type,
      quality,
    );
  });
}

function adjustFileName(originalName: string, outputType: string): string {
  const ext = outputType === 'image/jpeg' ? '.jpg'
    : outputType === 'image/png' ? '.png'
    : outputType === 'image/webp' ? '.webp'
    : '.jpg';

  const dotIdx = originalName.lastIndexOf('.');
  const base = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  return `${base}${ext}`;
}
