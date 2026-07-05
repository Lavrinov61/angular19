export type FileCategory =
  | 'pdf' | 'word' | 'excel' | 'text' | 'csv'
  | 'archive' | 'presentation' | 'image' | 'video' | 'audio' | 'unknown';

export function getFileCategory(urlOrFilename: string, mimeType?: string | null): FileCategory {
  const ext = urlOrFilename.split('.').pop()?.toLowerCase()?.split('?')[0] ?? '';
  switch (ext) {
    case 'pdf': return 'pdf';
    case 'doc': case 'docx': case 'docm': case 'dot': case 'dotx': case 'dotm':
    case 'odt': case 'ott': case 'rtf': return 'word';
    case 'xls': case 'xlsx': case 'xlsm': case 'xlsb': case 'xlt': case 'xltx': case 'xltm':
    case 'ods': case 'ots': return 'excel';
    case 'ppt': case 'pptx': case 'pptm': case 'pps': case 'ppsx': case 'ppsm':
    case 'pot': case 'potx': case 'potm': case 'odp': case 'otp': return 'presentation';
    case 'txt': case 'log': return 'text';
    case 'csv': case 'tsv': return 'csv';
    case 'zip': case 'rar': case '7z': case 'tar': case 'gz': return 'archive';
    case 'jpg': case 'jpeg': case 'png': case 'gif': case 'webp':
    case 'avif': case 'heic': case 'bmp': case 'tif': case 'tiff': return 'image';
    case 'mp4': case 'mov': case 'avi': case 'mkv': case 'webm': return 'video';
    case 'mp3': case 'ogg': case 'wav': case 'aac': case 'm4a': case 'opus': return 'audio';
  }
  // Fallback: resolve from MIME type when extension is unknown (.bin, missing, etc.)
  if (mimeType) {
    const mime = normalizedMime(mimeType);
    const mimeCat = MIME_TO_CATEGORY[mime];
    if (mimeCat) return mimeCat;
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
  }
  return 'unknown';
}

const BROWSER_PREVIEW_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/pjpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
]);

const BROWSER_PREVIEW_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp']);

function normalizedMime(mimeType?: string | null): string {
  return mimeType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

export function isBrowserPreviewableImage(urlOrFilename: string | null | undefined, mimeType?: string | null): boolean {
  const mime = normalizedMime(mimeType);
  if (mime) {
    if (BROWSER_PREVIEW_IMAGE_MIMES.has(mime)) return true;
    if (mime.startsWith('image/')) return false;
  }
  const ext = urlOrFilename?.split('?')[0]?.split('.').pop()?.toLowerCase() ?? '';
  return BROWSER_PREVIEW_IMAGE_EXTS.has(ext);
}

export function getFileIcon(urlOrFilename: string, mimeType?: string | null): string {
  const cat = getFileCategory(urlOrFilename, mimeType);
  switch (cat) {
    case 'pdf': return 'picture_as_pdf';
    case 'word': return 'description';
    case 'excel': return 'table_chart';
    case 'presentation': return 'slideshow';
    case 'text': return 'article';
    case 'csv': return 'grid_on';
    case 'archive': return 'folder_zip';
    case 'image': return 'image';
    case 'video': return 'videocam';
    case 'audio': return 'audiotrack';
    default: return 'insert_drive_file';
  }
}

export function getFileLabel(urlOrFilename: string, mimeType?: string | null): string {
  const cat = getFileCategory(urlOrFilename, mimeType);
  switch (cat) {
    case 'pdf': return 'PDF';
    case 'word': return 'Word';
    case 'excel': return 'Excel';
    case 'presentation': return 'PowerPoint';
    case 'text': return 'Текст';
    case 'csv': return 'CSV';
    case 'archive': return 'Архив';
    default: return 'Файл';
  }
}

export function isPdf(urlOrFilename: string): boolean {
  return getFileCategory(urlOrFilename) === 'pdf';
}

const URI_ENCODED_BYTE = /%[0-9a-f]{2}/i;
const URI_ENCODED_BYTE_RUN = /((?:%[0-9a-f]{2})+)/gi;

export function decodeFileName(value: string): string {
  if (!URI_ENCODED_BYTE.test(value)) return value;

  try {
    return decodeURIComponent(value);
  } catch {
    return value.replace(URI_ENCODED_BYTE_RUN, part => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
  }
}

/** MIME placeholders that should NOT be used as file names */
const PLACEHOLDER_PATTERNS = [
  /^\[Файл:\s*\]$/,
  /^\[Файл\]$/,
  /^\[Фото\]$/,
  /^\[Видео\]$/,
  /^\[Голосовое сообщение\]$/,
  /^\[Стикер\]$/,
  /^\[Документ\]$/,
];

function isPlaceholderContent(content: string): boolean {
  return PLACEHOLDER_PATTERNS.some(p => p.test(content.trim()));
}

const CATEGORY_LABELS: Record<FileCategory, string> = {
  pdf: 'Документ PDF',
  word: 'Документ Word',
  excel: 'Таблица Excel',
  presentation: 'Презентация',
  text: 'Текстовый файл',
  csv: 'Таблица CSV',
  archive: 'Архив',
  image: 'Изображение',
  video: 'Видео',
  audio: 'Аудио',
  unknown: 'Файл',
};

function fileNameFromMarker(content: string): string | null {
  const match = content.trim().match(/^\[(?:Файл|Документ|Фото|Видео|Аудио):\s*(.+)\]$/);
  const value = match?.[1]?.trim();
  return value || null;
}

const MIME_TO_CATEGORY: Record<string, FileCategory> = {
  'application/pdf': 'pdf',
  'application/msword': 'word',
  'application/x-msword': 'word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'application/vnd.ms-word.document.macroenabled.12': 'word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template': 'word',
  'application/vnd.ms-word.template.macroenabled.12': 'word',
  'application/rtf': 'word',
  'text/rtf': 'word',
  'application/x-rtf': 'word',
  'text/richtext': 'word',
  'application/vnd.oasis.opendocument.text': 'word',
  'application/vnd.oasis.opendocument.text-template': 'word',
  'application/vnd.ms-excel': 'excel',
  'application/msexcel': 'excel',
  'application/x-msexcel': 'excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
  'application/vnd.ms-excel.sheet.macroenabled.12': 'excel',
  'application/vnd.ms-excel.sheet.binary.macroenabled.12': 'excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template': 'excel',
  'application/vnd.ms-excel.template.macroenabled.12': 'excel',
  'application/vnd.oasis.opendocument.spreadsheet': 'excel',
  'application/vnd.oasis.opendocument.spreadsheet-template': 'excel',
  'application/vnd.ms-powerpoint': 'presentation',
  'application/mspowerpoint': 'presentation',
  'application/powerpoint': 'presentation',
  'application/x-mspowerpoint': 'presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'presentation',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12': 'presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow': 'presentation',
  'application/vnd.ms-powerpoint.slideshow.macroenabled.12': 'presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.template': 'presentation',
  'application/vnd.ms-powerpoint.template.macroenabled.12': 'presentation',
  'application/vnd.oasis.opendocument.presentation': 'presentation',
  'application/vnd.oasis.opendocument.presentation-template': 'presentation',
  'application/zip': 'archive',
  'application/x-rar-compressed': 'archive',
  'application/x-7z-compressed': 'archive',
  'text/plain': 'text',
  'text/csv': 'csv',
  'application/csv': 'csv',
  'text/tab-separated-values': 'csv',
};

/**
 * Human-readable file name with smart fallback chain:
 * 1. content (if meaningful, not a placeholder)
 * 2. Filename extracted from URL path
 * 3. MIME-based label ("Документ PDF", "Изображение", etc.)
 * 4. Final fallback: "Файл"
 */
export function humanFileName(content: string | null, url: string | null, mimeType?: string): string {
  const markerName = content ? fileNameFromMarker(content) : null;
  if (markerName) return decodeFileName(markerName);

  // 1. Use content if it's meaningful
  if (content && content.trim() && !isPlaceholderContent(content) && content !== url) {
    return decodeFileName(content.trim());
  }

  // 2. Try extracting a real filename from URL (not UUID-like)
  if (url) {
    const lastSegment = decodeFileName(url.split('/').pop()?.split('?')[0] ?? '');
    // Check if the filename has a recognizable extension and isn't just a UUID
    const dotIdx = lastSegment.lastIndexOf('.');
    if (dotIdx > 0) {
      const name = lastSegment.substring(0, dotIdx);
      // If the name part is not a UUID-like hash (>20 hex chars), use it
      const isUuidLike = /^[a-f0-9-]{20,}$/i.test(name);
      if (!isUuidLike && name.length > 0) {
        return lastSegment;
      }
      // Even if UUID, determine label from extension
      const cat = getFileCategory(lastSegment);
      if (cat !== 'unknown') {
        return CATEGORY_LABELS[cat];
      }
    }
  }

  // 3. MIME-based label
  if (mimeType) {
    const mime = normalizedMime(mimeType);
    const exactCat = MIME_TO_CATEGORY[mime];
    if (exactCat) return CATEGORY_LABELS[exactCat];
    if (mime.startsWith('image/')) return CATEGORY_LABELS.image;
    if (mime.startsWith('video/')) return CATEGORY_LABELS.video;
    if (mime.startsWith('audio/')) return CATEGORY_LABELS.audio;
  }

  // 4. Final fallback
  return 'Файл';
}

/** Map MIME type to file extension (for ZIP naming) */
export function mimeToExt(mimeType: string): string {
  const mime = normalizedMime(mimeType);
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/avif': '.avif',
    'image/heic': '.heic',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/webm': '.webm',
    'video/x-msvideo': '.avi',
    'audio/mpeg': '.mp3',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'audio/aac': '.aac',
    'audio/mp4': '.m4a',
    'audio/opus': '.opus',
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/x-msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-word.document.macroenabled.12': '.docm',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.template': '.dotx',
    'application/vnd.ms-word.template.macroenabled.12': '.dotm',
    'application/rtf': '.rtf',
    'text/rtf': '.rtf',
    'application/x-rtf': '.rtf',
    'text/richtext': '.rtf',
    'application/vnd.oasis.opendocument.text': '.odt',
    'application/vnd.oasis.opendocument.text-template': '.ott',
    'application/vnd.ms-excel': '.xls',
    'application/msexcel': '.xls',
    'application/x-msexcel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-excel.sheet.macroenabled.12': '.xlsm',
    'application/vnd.ms-excel.sheet.binary.macroenabled.12': '.xlsb',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.template': '.xltx',
    'application/vnd.ms-excel.template.macroenabled.12': '.xltm',
    'application/vnd.oasis.opendocument.spreadsheet': '.ods',
    'application/vnd.oasis.opendocument.spreadsheet-template': '.ots',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/mspowerpoint': '.ppt',
    'application/powerpoint': '.ppt',
    'application/x-mspowerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/vnd.ms-powerpoint.presentation.macroenabled.12': '.pptm',
    'application/vnd.openxmlformats-officedocument.presentationml.slideshow': '.ppsx',
    'application/vnd.ms-powerpoint.slideshow.macroenabled.12': '.ppsm',
    'application/vnd.openxmlformats-officedocument.presentationml.template': '.potx',
    'application/vnd.ms-powerpoint.template.macroenabled.12': '.potm',
    'application/vnd.oasis.opendocument.presentation': '.odp',
    'application/vnd.oasis.opendocument.presentation-template': '.otp',
    'application/zip': '.zip',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'application/csv': '.csv',
    'text/tab-separated-values': '.tsv',
    'application/octet-stream': '.bin',
  };
  return map[mime] || '.bin';
}
