// Форматирование и валидация российского номера телефона.
// Единый источник правды для полей ввода телефона (формат +7 (XXX) XXX-XX-XX).

/** Извлекает до 10 значимых цифр номера, отбрасывая ведущую 7/8 у 11-значного ввода. */
export function extractRuPhoneDigits(value: string): string {
  let digits = (value ?? '').replace(/\D/g, '');
  // Ведущую 7/8 убираем только когда это явно код страны (11+ цифр),
  // чтобы не «съесть» легитимный 10-значный номер, начинающийся на 7/8.
  if (digits.length > 10 && (digits[0] === '7' || digits[0] === '8')) {
    digits = digits.slice(1);
  }
  return digits.slice(0, 10);
}

/** Красивый формат +7 (XXX) XXX-XX-XX. Работает и для частично набранного номера. */
export function formatRuPhone(value: string): string {
  const d = extractRuPhoneDigits(value);
  if (d.length === 0) return '';
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 6);
  const p3 = d.slice(6, 8);
  const p4 = d.slice(8, 10);
  let out = `+7 (${p1}`;
  if (d.length >= 3) out += ')';
  if (p2) out += ` ${p2}`;
  if (p3) out += `-${p3}`;
  if (p4) out += `-${p4}`;
  return out;
}

/** true, если введён полный 10-значный номер. */
export function isCompleteRuPhone(value: string): boolean {
  return extractRuPhoneDigits(value).length === 10;
}

/** Канонический формат для бэкенда: '7XXXXXXXXXX' или null, если номер неполный. */
export function toFullRuPhone(value: string): string | null {
  const d = extractRuPhoneDigits(value);
  return d.length === 10 ? `7${d}` : null;
}

// --- Живая маска ввода (+7 (XXX) XXX-XX-XX) ---------------------------------
// Поле, отформатированное нашей маской, ВСЕГДА начинается с литерала "+7 (".
// Поэтому при повторном проходе цифру "7" из префикса нельзя считать значащей
// (как делает extractRuPhoneDigits для частичного ввода). Эта функция убирает
// ведущую 7/8, если строка визуально несёт наш префикс, даже когда номер неполный.
const COUNTRY_PREFIX_RE = /^\s*\+?\s*[78]\s*[(\s]/;

function maskedDigits(value: string): string {
  const v = value ?? '';
  let digits = v.replace(/\D/g, '');
  const hasCountryPrefix =
    COUNTRY_PREFIX_RE.test(v) || (digits.length > 10 && (digits[0] === '7' || digits[0] === '8'));
  if (hasCountryPrefix && (digits[0] === '7' || digits[0] === '8')) {
    digits = digits.slice(1);
  }
  return digits.slice(0, 10);
}

/** Позиция курсора сразу после n-й значащей цифры в отформатированной строке. */
function caretAfterNthDigit(formatted: string, n: number): number {
  if (formatted === '') return 0;
  if (n <= 0) return Math.min(4, formatted.length); // сразу за префиксом "+7 ("
  let seen = 0;
  // Пропускаем 3-символьный префикс "+7 " — его цифра 7 не значащая.
  for (let i = 3; i < formatted.length; i++) {
    const c = formatted.charCodeAt(i);
    if (c >= 48 && c <= 57) {
      seen += 1;
      if (seen === n) {
        // Перешагиваем сразу следующие за цифрой разделители — курсор «прилипает» к концу.
        let pos = i + 1;
        while (pos < formatted.length && (formatted.charCodeAt(pos) < 48 || formatted.charCodeAt(pos) > 57)) {
          pos += 1;
        }
        return pos;
      }
    }
  }
  return formatted.length;
}

export interface RuPhoneMaskResult {
  /** Отформатированное значение для записи в поле. */
  readonly value: string;
  /** Извлечённые значащие цифры — сохраните их для следующего вызова (previousDigits). */
  readonly digits: string;
  /** Позиция курсора внутри value. */
  readonly caret: number;
}

/**
 * Пересчёт значения поля телефона на КАЖДЫЙ ввод (live-маска).
 * @param rawValue        текущее сырое значение input после ввода пользователя
 * @param selectionStart  позиция курсора в сыром значении
 * @param inputType       InputEvent.inputType ('deleteContentBackward' и т.п. или undefined)
 * @param previousDigits  digits из предыдущего вызова — нужны, чтобы backspace по разделителю
 *                        (например по ')') удалял соседнюю цифру, а не «застревал».
 */
export function applyRuPhoneMask(
  rawValue: string,
  selectionStart: number,
  inputType: string | null | undefined,
  previousDigits: string,
): RuPhoneMaskResult {
  let digits = maskedDigits(rawValue);

  // Сколько значащих цифр стоит перед курсором (для восстановления позиции).
  let digitsBeforeCaret = (rawValue.slice(0, Math.max(0, selectionStart)).match(/\d/g) ?? []).length;
  if (COUNTRY_PREFIX_RE.test(rawValue) && digitsBeforeCaret > 0) {
    digitsBeforeCaret -= 1; // ведущая 7 префикса в счёт не идёт
  }

  // Удаление, при котором исчез только разделитель (число цифр не изменилось) —
  // дотираем соседнюю значащую цифру, иначе клавиша «проглатывается».
  if (digits.length === previousDigits.length && previousDigits.length > 0) {
    if (inputType === 'deleteContentBackward' && digitsBeforeCaret > 0) {
      const idx = digitsBeforeCaret - 1;
      digits = digits.slice(0, idx) + digits.slice(idx + 1);
      digitsBeforeCaret = idx;
    } else if (inputType === 'deleteContentForward' && digitsBeforeCaret < digits.length) {
      digits = digits.slice(0, digitsBeforeCaret) + digits.slice(digitsBeforeCaret + 1);
    }
  }

  const value = formatRuPhone(digits);
  return { value, digits, caret: caretAfterNthDigit(value, digitsBeforeCaret) };
}
