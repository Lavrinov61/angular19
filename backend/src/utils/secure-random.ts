import { randomBytes } from 'crypto';

/**
 * Криптографически безопасная генерация случайной строки.
 * Использует crypto.randomBytes() вместо Math.random().
 */
export function secureRandomString(length: number, charset: string): string {
  const bytes = randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[bytes[i]! % charset.length];
  }
  return result;
}

/** Генерация Order ID: PP-YYMMDD-XXXX */
export function generateOrderId(): string {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const random = secureRandomString(4, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  return `PP-${year}${month}${day}-${random}`;
}

/** Генерация реферального кода (6 символов, без 0/O/1/I для читаемости) */
export function generateReferralCode(): string {
  return secureRandomString(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
}

/** Генерация 6-значного числового кода подтверждения */
export function generateConfirmationCode(): string {
  const bytes = randomBytes(4);
  const num = bytes.readUInt32BE(0) % 900000 + 100000;
  return String(num);
}

/** Генерация уникального ID для сообщений */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${randomBytes(6).toString('hex')}`;
}
