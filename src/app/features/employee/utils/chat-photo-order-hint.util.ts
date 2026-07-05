export interface ChatPhotoOrderHint {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly label: string;
  readonly sourceText: string;
  readonly whiteBorder: boolean;
}

const DECIMAL_NUMBER = String.raw`\d{1,3}(?:[,.]\d+)?`;
const X_SIZE_RE = new RegExp(String.raw`\b(${DECIMAL_NUMBER})\s*(?:x|х|×|\*)\s*[,;:]?\s*(${DECIMAL_NUMBER})\b`, 'iu');
const CONTEXT_COLON_SIZE_RE = new RegExp(
  String.raw`(?:размер|формат|нужно|надо|просил[аи]?|печать|фото)[^\d]{0,40}(${DECIMAL_NUMBER})\s*:\s*(${DECIMAL_NUMBER})\b`,
  'iu',
);
const HALF_STANDARD_RE = /половин[\p{L}\p{M}\p{N}_-]*(?:\s+[\p{L}\p{M}\p{N}_-]+){0,5}\s+(?:стандартн[\p{L}\p{M}\p{N}_-]*\s+)?фото|половин[\p{L}\p{M}\p{N}_-]*(?:\s+[\p{L}\p{M}\p{N}_-]+){0,5}\s+10\s*(?:x|х|×)\s*15|10\s*(?:x|х|×)\s*15(?:\s+[\p{L}\p{M}\p{N}_-]+){0,5}\s+половин[\p{L}\p{M}\p{N}_-]*/iu;
const WHITE_BORDER_RE = /бел[\p{L}\p{M}\p{N}_-]*\s+рамк[\p{L}\p{M}\p{N}_-]*|с\s+рамк[\p{L}\p{M}\p{N}_-]*|white\s+border/iu;

export function parseChatPhotoOrderHint(text: string | null | undefined): ChatPhotoOrderHint | null {
  const normalized = normalizeHintText(text);
  if (!normalized) return null;

  const whiteBorder = WHITE_BORDER_RE.test(normalized);

  if (HALF_STANDARD_RE.test(normalized)) {
    return buildHint(75, 100, normalized, whiteBorder);
  }

  const xMatch = normalized.match(X_SIZE_RE);
  if (xMatch) {
    const hint = buildHintFromMatch(xMatch, normalized, whiteBorder);
    if (hint) return hint;
  }

  const colonMatch = normalized.match(CONTEXT_COLON_SIZE_RE);
  if (colonMatch) {
    return buildHintFromMatch(colonMatch, normalized, whiteBorder);
  }

  return null;
}

export function formatPhotoOrderSizeLabel(widthMm: number, heightMm: number): string {
  return `${formatMmAsCm(widthMm)}×${formatMmAsCm(heightMm)} см`;
}

function buildHintFromMatch(match: RegExpMatchArray, sourceText: string, whiteBorder: boolean): ChatPhotoOrderHint | null {
  const widthMm = parsePhotoDimensionToMm(match[1]);
  const heightMm = parsePhotoDimensionToMm(match[2]);
  if (widthMm === null || heightMm === null) return null;
  return buildHint(widthMm, heightMm, sourceText, whiteBorder);
}

function buildHint(widthMm: number, heightMm: number, sourceText: string, whiteBorder: boolean): ChatPhotoOrderHint {
  return {
    widthMm,
    heightMm,
    label: formatPhotoOrderSizeLabel(widthMm, heightMm),
    sourceText: sourceText.slice(0, 240),
    whiteBorder,
  };
}

function parsePhotoDimensionToMm(value: string | undefined): number | null {
  const numeric = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  // Operators and clients usually write centimeters ("10,5x10,5").
  // If they write a large integer ("105x105"), treat it as millimeters.
  const mm = numeric > 60 ? numeric : numeric * 10;
  if (mm < 10 || mm > 600) return null;
  return Math.round(mm);
}

function formatMmAsCm(mm: number): string {
  const cm = mm / 10;
  const value = Number.isInteger(cm) ? String(cm) : cm.toFixed(1);
  return value.replace('.', ',');
}

function normalizeHintText(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}
