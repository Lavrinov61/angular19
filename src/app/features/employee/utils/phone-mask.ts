/**
 * Mask a phone number for non-admin operators.
 * Format: +7 (950) ***-**-16
 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  const last2 = digits.slice(-2);
  if (digits.length === 11 && digits.startsWith('7')) {
    return `+7 (${digits.slice(1, 4)}) ***-**-${last2}`;
  }
  return `${'*'.repeat(digits.length - 2)}${last2}`;
}

/**
 * Mask phone numbers found within arbitrary text (chat messages).
 * Replaces Russian phone patterns with masked versions.
 */
export function maskPhonesInText(text: string): string {
  return text.replace(
    /(\+?[78][\s\-.()*]*(?:\d[\s\-.()*]*){9}\d)/g,
    (match) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length >= 10 && digits.length <= 11) {
        const normalized = digits.length === 10
          ? '7' + digits
          : (digits.startsWith('8') ? '7' + digits.slice(1) : digits);
        return maskPhone(normalized) ?? match;
      }
      return match;
    },
  );
}

export function normalizeRussianPhoneDigits(value: string | null | undefined): string {
  const raw = (value ?? '').replace(/\D/g, '');
  if (!raw) return '';

  let digits = raw;
  if (digits.startsWith('8')) {
    digits = `7${digits.slice(1)}`;
  } else if (!digits.startsWith('7')) {
    digits = `7${digits}`;
  }

  return digits.slice(0, 11);
}

export function formatRussianPhoneInput(value: string | null | undefined): string {
  const digits = normalizeRussianPhoneDigits(value);
  if (!digits) return '';
  if (digits.length <= 1) return '+7';

  const area = digits.slice(1, 4);
  const first = digits.slice(4, 7);
  const second = digits.slice(7, 9);
  const third = digits.slice(9, 11);

  let formatted = '+7';
  if (area) formatted += ` (${area}`;
  if (area.length === 3) formatted += ')';
  if (first) formatted += ` ${first}`;
  if (second) formatted += `-${second}`;
  if (third) formatted += `-${third}`;

  return formatted;
}

export function isCompleteRussianPhone(value: string | null | undefined): boolean {
  return normalizeRussianPhoneDigits(value).length === 11;
}

export function normalizeRussianPhoneForDial(value: string | null | undefined): string {
  const digits = normalizeRussianPhoneDigits(value);
  return digits.length === 11 ? `+${digits}` : formatRussianPhoneInput(value);
}
