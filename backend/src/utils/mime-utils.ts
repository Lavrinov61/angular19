/**
 * Shared MIME/extension utilities for messenger connectors.
 *
 * Includes magic-bytes detection for reliable MIME identification
 * when channels send `application/octet-stream` or no MIME at all.
 */

/** Magic bytes signatures — ordered by specificity (most specific first). */
const MAGIC_SIGNATURES: ReadonlyArray<{ mime: string; offset: number; bytes: number[] }> = [
  // Images
  { mime: 'image/png',  offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47] },              // \x89PNG
  { mime: 'image/jpeg', offset: 0, bytes: [0xFF, 0xD8, 0xFF] },                     // SOI marker
  { mime: 'image/gif',  offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },              // GIF8
  { mime: 'image/webp', offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },              // WEBP at offset 8
  { mime: 'image/bmp',  offset: 0, bytes: [0x42, 0x4D] },                           // BM
  { mime: 'image/tiff', offset: 0, bytes: [0x49, 0x49, 0x2A, 0x00] },              // II*\0 (little-endian)
  { mime: 'image/tiff', offset: 0, bytes: [0x4D, 0x4D, 0x00, 0x2A] },              // MM\0* (big-endian)
  // Video
  { mime: 'video/webm', offset: 0, bytes: [0x1A, 0x45, 0xDF, 0xA3] },              // EBML (Matroska/WebM)
  // RIFF (AVI/WAV) handled separately below — sub-chunk disambiguation
  // Audio
  { mime: 'audio/ogg',  offset: 0, bytes: [0x4F, 0x67, 0x67, 0x53] },              // OggS
  { mime: 'audio/flac', offset: 0, bytes: [0x66, 0x4C, 0x61, 0x43] },              // fLaC
  { mime: 'audio/mpeg', offset: 0, bytes: [0x49, 0x44, 0x33] },                     // ID3 (MP3 with tag)
  { mime: 'audio/mpeg', offset: 0, bytes: [0xFF, 0xFB] },                           // MP3 sync word
  // Documents
  { mime: 'application/pdf', offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },          // %PDF
  // ZIP-based (docx, xlsx, pptx, zip) — all start with PK\x03\x04
  { mime: 'application/zip', offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] },          // PK..
  // Archives
  { mime: 'application/x-rar-compressed', offset: 0, bytes: [0x52, 0x61, 0x72, 0x21] }, // Rar!
  { mime: 'application/x-7z-compressed',  offset: 0, bytes: [0x37, 0x7A, 0xBC, 0xAF] }, // 7z\xBC\xAF
  { mime: 'application/gzip', offset: 0, bytes: [0x1F, 0x8B] },                     // gzip
];

/** HEIC/HEIF ftyp brands (checked at offset 4 for `ftyp`, then brand at offset 8). */
const HEIC_BRANDS = new Set(['heic', 'heix', 'mif1', 'hevc', 'hevx']);

/**
 * Detect MIME type from buffer magic bytes.
 * Returns `null` if no signature matches — caller should fall back to hint.
 *
 * O(1) — reads at most 16 bytes from an already-in-memory buffer.
 */
export function detectMimeFromBuffer(buf: Buffer): string | null {
  if (buf.length < 12) return null;

  // HEIC/HEIF: bytes 4–7 = "ftyp", brand at 8–11
  if (buf.length >= 12
    && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const brand = buf.subarray(8, 12).toString('ascii');
    if (HEIC_BRANDS.has(brand)) return 'image/heic';
    // MP4/MOV also use ftyp — check common brands
    // M4A must be checked before mp4Brands to avoid video/mp4 misclassification
    if (brand === 'M4A ' || brand === 'M4A\0') return 'audio/mp4';
    const mp4Brands = new Set(['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ']);
    const qtBrand = new Set(['qt  ']);
    if (mp4Brands.has(brand)) return 'video/mp4';
    if (qtBrand.has(brand)) return 'video/quicktime';
    // Unknown ftyp — assume mp4
    return 'video/mp4';
  }

  // RIFF container: AVI vs WAV disambiguation via sub-chunk at bytes 8–11
  if (buf.length >= 12
    && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
    // bytes 8–11: "WAVE" = audio/wav, "AVI " = video/x-msvideo
    if (buf[8] === 0x57 && buf[9] === 0x41 && buf[10] === 0x56 && buf[11] === 0x45) return 'audio/wav';
    if (buf[8] === 0x41 && buf[9] === 0x56 && buf[10] === 0x49 && buf[11] === 0x20) return 'video/x-msvideo';
    // WEBP is also RIFF-based but already detected via offset 8 in MAGIC_SIGNATURES
  }

  for (const sig of MAGIC_SIGNATURES) {
    if (buf.length < sig.offset + sig.bytes.length) continue;
    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (buf[sig.offset + i] !== sig.bytes[i]) { match = false; break; }
    }
    if (match) return sig.mime;
  }

  return null;
}

const MIME_TO_EXT: Record<string, string> = {
  // Images
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  // Video
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-msvideo': '.avi',
  'video/x-matroska': '.mkv',
  // Audio
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/flac': '.flac',
  // Documents
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  // Archives
  'application/zip': '.zip',
  'application/x-rar-compressed': '.rar',
  'application/x-7z-compressed': '.7z',
  'application/gzip': '.gz',
  // Text / data
  'text/plain': '.txt',
  'text/csv': '.csv',
  'text/html': '.html',
  'application/json': '.json',
  'application/xml': '.xml',
  'text/xml': '.xml',
};

/** Map MIME type to file extension (with leading dot). Falls back to `.bin`. */
export function mimeToExt(mime: string): string {
  return MIME_TO_EXT[mime] || '.bin';
}

/**
 * Get file extension from original filename, falling back to MIME-based extension.
 * Preserves the real extension when available (e.g. `.docx` from `report.docx`).
 */
export function extFromFilename(filename: string | undefined, fallbackMime: string): string {
  if (filename) {
    const dotIdx = filename.lastIndexOf('.');
    if (dotIdx > 0) return filename.slice(dotIdx);
  }
  return mimeToExt(fallbackMime);
}

/** Reverse lookup: file extension → MIME type. Returns null if unknown. */
const EXT_TO_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_TO_EXT).map(([mime, ext]) => [ext, mime]),
);
// Add common aliases not covered by the reverse map
Object.assign(EXT_TO_MIME, {
  '.jpeg': 'image/jpeg',
  '.tif': 'image/tiff',
  '.htm': 'text/html',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
});

/**
 * Derive MIME type from filename extension. Returns null if unknown.
 * Used as fallback when magic bytes and channel hints fail.
 */
export function mimeFromFilename(filename: string | undefined): string | null {
  if (!filename) return null;
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx < 1) return null;
  return EXT_TO_MIME[filename.slice(dotIdx).toLowerCase()] ?? null;
}

/**
 * Inspect ZIP buffer to detect Office Open XML documents (.docx/.xlsx/.pptx).
 *
 * Office files are ZIP containers whose first entry is `[Content_Types].xml`.
 * We read the first ZIP local-file-header to confirm, then search subsequent
 * bytes for `word/`, `xl/`, or `ppt/` directory markers to determine the type.
 *
 * Works with both full file buffers and small peek headers (≥ 256 bytes).
 * Returns null if the ZIP is not an Office document.
 */
export function detectOfficeFromZipBuffer(buf: Buffer): string | null {
  // ZIP local file header: 30 bytes fixed + variable filename
  if (buf.length < 38) return null;

  // PK\x03\x04 already verified upstream, but double-check for standalone use
  if (buf[0] !== 0x50 || buf[1] !== 0x4B || buf[2] !== 0x03 || buf[3] !== 0x04) return null;

  const filenameLen = buf.readUInt16LE(26);
  if (filenameLen === 0 || buf.length < 30 + filenameLen) return null;

  const firstFilename = buf.subarray(30, 30 + filenameLen).toString('utf8');
  if (firstFilename !== '[Content_Types].xml') return null;

  // Confirmed Office Open XML — determine specific type from directory markers
  const tail = buf.subarray(30 + filenameLen).toString('latin1');

  if (tail.includes('word/'))
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (tail.includes('xl/'))
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (tail.includes('ppt/'))
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  // Office XML but can't determine sub-type — default to docx (most common)
  return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}
