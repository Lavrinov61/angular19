/**
 * Маскирует телефон для сотрудников: +7 (950) ***-**-16
 * Полный номер виден только admin
 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  const last2 = digits.slice(-2);
  // Формат: +7 (XXX) ***-**-XX
  if (digits.length === 11 && digits.startsWith('7')) {
    return `+7 (${digits.slice(1, 4)}) ***-**-${last2}`;
  }
  return `${'*'.repeat(digits.length - 2)}${last2}`;
}
