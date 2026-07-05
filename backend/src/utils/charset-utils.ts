/**
 * Charset detection & fix utilities for Cyrillic email content.
 * Handles mis-decoded windows-1251 / koi8-r / iso-8859-5 emails
 * that arrive without proper Content-Type charset declaration.
 */

import iconv from 'iconv-lite';

/**
 * Check if text looks like mis-decoded Cyrillic (Latin-1 Supplement artifacts).
 * When Cyrillic bytes are decoded as Latin-1, they produce chars in U+00C0..U+00FF range.
 * If >30% of visible chars fall there, it's likely mis-decoded.
 */
export function looksLikeMisdecodedCyrillic(text: string): boolean {
  let visible = 0;
  let latin1Supplement = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Skip whitespace / control
    if (code <= 0x20) continue;
    visible++;
    if (code >= 0x80 && code <= 0xff) {
      latin1Supplement++;
    }
  }

  if (visible === 0) return false;
  return latin1Supplement / visible > 0.3;
}

/**
 * Extract charset from Content-Type header in raw MIME source.
 * Only scans the first 4KB to stay fast.
 */
export function extractCharsetFromMime(rawSource: Buffer): string | null {
  // Read first 4KB as ASCII (headers are always ASCII-compatible)
  const head = rawSource.subarray(0, 4096).toString('ascii');

  // Find Content-Type header with charset parameter
  const match = head.match(/Content-Type:\s*[^;\r\n]+;\s*charset\s*=\s*"?([^"\s;\r\n]+)"?/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Check if a buffer is valid UTF-8.
 */
function isValidUtf8(buf: Buffer): boolean {
  try {
    const decoded = buf.toString('utf8');
    // Re-encode and compare — if round-trips cleanly, it's valid UTF-8
    const reEncoded = Buffer.from(decoded, 'utf8');
    return buf.equals(reEncoded);
  } catch {
    return false;
  }
}

/**
 * Heuristic Cyrillic charset detection.
 * Decodes buffer as each candidate encoding, counts Cyrillic codepoints (U+0400..U+04FF),
 * and picks the encoding with the most hits.
 */
export function detectCyrillicCharset(buf: Buffer): 'windows-1251' | 'koi8-r' | 'iso-8859-5' | 'utf-8' {
  // If it's valid UTF-8 with Cyrillic, prefer that
  if (isValidUtf8(buf)) {
    const utf8Text = buf.toString('utf8');
    let cyrCount = 0;
    for (let i = 0; i < utf8Text.length; i++) {
      const code = utf8Text.charCodeAt(i);
      if (code >= 0x0400 && code <= 0x04ff) cyrCount++;
    }
    if (cyrCount > 0) return 'utf-8';
  }

  const candidates = ['windows-1251', 'koi8-r', 'iso-8859-5'] as const;
  let bestCharset: 'windows-1251' | 'koi8-r' | 'iso-8859-5' = 'windows-1251';
  let bestScore = 0;

  for (const charset of candidates) {
    const decoded = iconv.decode(buf, charset);
    let score = 0;
    for (let i = 0; i < decoded.length; i++) {
      const code = decoded.charCodeAt(i);
      if (code >= 0x0400 && code <= 0x04ff) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCharset = charset;
    }
  }

  return bestCharset;
}

/**
 * Main fix function: if Content-Type has no charset and body looks like Cyrillic,
 * inject `; charset=<detected>` into the Content-Type header.
 * If charset is already declared, returns buffer unchanged.
 */
export function fixMimeCharset(rawSource: Buffer): Buffer {
  // Already has charset declared — don't touch
  const existingCharset = extractCharsetFromMime(rawSource);
  if (existingCharset) return rawSource;

  // Find the body separator (blank line)
  const headerEnd = findHeaderEnd(rawSource);
  if (headerEnd < 0) return rawSource;

  // Extract body bytes for detection
  const bodyBytes = rawSource.subarray(headerEnd);
  if (bodyBytes.length === 0) return rawSource;

  // Quick check: does the body have high bytes (non-ASCII)?
  let highBytes = 0;
  const scanLen = Math.min(bodyBytes.length, 4096);
  for (let i = 0; i < scanLen; i++) {
    if (bodyBytes[i]! >= 0x80) highBytes++;
  }
  if (highBytes < 5) return rawSource; // Likely pure ASCII, no fix needed

  // Detect charset from body
  const detected = detectCyrillicCharset(bodyBytes);
  if (detected === 'utf-8') return rawSource; // UTF-8 is the default, no injection needed

  // Inject charset into the first Content-Type header
  const headerStr = rawSource.subarray(0, headerEnd).toString('ascii');
  const ctMatch = headerStr.match(/^(Content-Type:\s*[^;\r\n]+)([\r\n])/im);
  if (!ctMatch) return rawSource;

  const insertPos = headerStr.indexOf(ctMatch[1]!) + ctMatch[1]!.length;
  const charsetParam = `; charset=${detected}`;

  const before = rawSource.subarray(0, insertPos);
  const after = rawSource.subarray(insertPos);

  return Buffer.concat([before, Buffer.from(charsetParam, 'ascii'), after]);
}

/**
 * Find the offset of the header/body separator (\r\n\r\n or \n\n).
 */
function findHeaderEnd(buf: Buffer): number {
  // Look for \r\n\r\n
  for (let i = 0; i < buf.length - 3; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a && buf[i + 2] === 0x0d && buf[i + 3] === 0x0a) {
      return i + 4;
    }
  }
  // Fallback: \n\n
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0x0a && buf[i + 1] === 0x0a) {
      return i + 2;
    }
  }
  return -1;
}
