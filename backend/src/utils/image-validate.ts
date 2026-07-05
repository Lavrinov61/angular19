/**
 * Image buffer validation — pre-flight check before passing to Sharp.
 *
 * Validates: non-empty, size limit, magic bytes match known image formats.
 * Prevents Sharp from crashing on corrupt/non-image buffers.
 */

export interface ImageValidation {
  valid: boolean;
  mime?: string;
  error?: string;
}

/**
 * Validate an image buffer BEFORE passing to Sharp.
 * Checks size constraints and magic bytes against known image formats.
 */
export function validateImageBuffer(
  buffer: Buffer,
  maxSizeBytes = 50_000_000,
): ImageValidation {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Empty buffer' };
  }
  if (buffer.length > maxSizeBytes) {
    return { valid: false, error: `Buffer too large: ${buffer.length} > ${maxSizeBytes}` };
  }

  const magic = buffer.subarray(0, 12);

  // JPEG: FF D8 FF
  if (magic[0] === 0xFF && magic[1] === 0xD8 && magic[2] === 0xFF) {
    return { valid: true, mime: 'image/jpeg' };
  }
  // PNG: 89 50 4E 47
  if (magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4E && magic[3] === 0x47) {
    return { valid: true, mime: 'image/png' };
  }
  // GIF: 47 49 46 38
  if (magic[0] === 0x47 && magic[1] === 0x49 && magic[2] === 0x46) {
    return { valid: true, mime: 'image/gif' };
  }
  // WebP: RIFF....WEBP
  if (
    magic[0] === 0x52 && magic[1] === 0x49 && magic[2] === 0x46 && magic[3] === 0x46 &&
    magic[8] === 0x57 && magic[9] === 0x45 && magic[10] === 0x42 && magic[11] === 0x50
  ) {
    return { valid: true, mime: 'image/webp' };
  }
  // HEIF/HEIC: ....ftyp
  if (magic[4] === 0x66 && magic[5] === 0x74 && magic[6] === 0x79 && magic[7] === 0x70) {
    return { valid: true, mime: 'image/heif' };
  }
  // BMP: 42 4D
  if (magic[0] === 0x42 && magic[1] === 0x4D) {
    return { valid: true, mime: 'image/bmp' };
  }
  // TIFF: 49 49 2A 00 (little-endian) or 4D 4D 00 2A (big-endian)
  if (
    (magic[0] === 0x49 && magic[1] === 0x49 && magic[2] === 0x2A) ||
    (magic[0] === 0x4D && magic[1] === 0x4D && magic[3] === 0x2A)
  ) {
    return { valid: true, mime: 'image/tiff' };
  }

  return { valid: false, error: 'Unknown image format' };
}
