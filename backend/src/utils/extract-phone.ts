import { normalizePhone } from '../services/contact.service.js';

/**
 * Extract the first Russian phone number from free-form text.
 * Returns normalized 11-digit string (7xxxxxxxxxx) or null.
 *
 * Detects: +7xxx, 8xxx, 7xxx with separators (spaces, dashes, parens, dots).
 * Rejects dates, order numbers, and sequences > 14 digits.
 */
export function extractPhoneFromText(text: string): string | null {
  if (!text || text.length < 10) return null;

  // Match Russian phone patterns: +7/8/7 followed by 10 digits with optional separators
  const phoneRegex = /(?:^|[\s,;(])(\+?[78][\s\-.()*]*(?:\d[\s\-.()*]*){9}\d)(?=[\s,;)!?.:]|$)/;
  const match = text.match(phoneRegex);
  if (!match) {
    // Fallback: bare 10 digits starting with 9 (implicit +7)
    const bare = text.match(/(?:^|[\s,;(])(9\d{9})(?=[\s,;)!?.:]|$)/);
    if (!bare) return null;
    const digits = bare[1].replace(/\D/g, '');
    return normalizePhone(digits);
  }

  const raw = match[1].trim();
  const digits = raw.replace(/\D/g, '');

  // Reject too short or too long (credit cards, long IDs)
  if (digits.length < 10 || digits.length > 11) return null;

  return normalizePhone(digits);
}
