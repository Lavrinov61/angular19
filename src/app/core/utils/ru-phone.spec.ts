import { describe, expect, it } from 'vitest';
import { applyRuPhoneMask, extractRuPhoneDigits, formatRuPhone, isCompleteRuPhone, toFullRuPhone } from './ru-phone';

describe('ru-phone', () => {
  describe('extractRuPhoneDigits', () => {
    it('keeps 10 significant digits', () => {
      expect(extractRuPhoneDigits('9198890715')).toBe('9198890715');
    });

    it('drops the country code from an 11-digit number', () => {
      expect(extractRuPhoneDigits('79198890715')).toBe('9198890715');
      expect(extractRuPhoneDigits('89198890715')).toBe('9198890715');
    });

    it('strips formatting characters', () => {
      expect(extractRuPhoneDigits('+7 (919) 889-07-15')).toBe('9198890715');
    });

    it('does not strip a legit 10-digit number that starts with 7', () => {
      expect(extractRuPhoneDigits('7000000000')).toBe('7000000000');
    });

    it('caps overflow at 10 digits', () => {
      expect(extractRuPhoneDigits('791988907159999')).toBe('9198890715');
    });
  });

  describe('formatRuPhone', () => {
    it('formats a full number', () => {
      expect(formatRuPhone('79198890715')).toBe('+7 (919) 889-07-15');
    });

    it('formats partial input progressively', () => {
      expect(formatRuPhone('919')).toBe('+7 (919)');
      expect(formatRuPhone('9198')).toBe('+7 (919) 8');
      expect(formatRuPhone('919889')).toBe('+7 (919) 889');
      expect(formatRuPhone('9198890')).toBe('+7 (919) 889-0');
    });

    it('returns empty string for empty input', () => {
      expect(formatRuPhone('')).toBe('');
      expect(formatRuPhone('abc')).toBe('');
    });
  });

  describe('isCompleteRuPhone', () => {
    it('is true only for 10 significant digits', () => {
      expect(isCompleteRuPhone('+7 (919) 889-07-15')).toBe(true);
      expect(isCompleteRuPhone('9198890715')).toBe(true);
      expect(isCompleteRuPhone('919889071')).toBe(false);
      expect(isCompleteRuPhone('')).toBe(false);
    });
  });

  describe('toFullRuPhone', () => {
    it('returns canonical 7XXXXXXXXXX or null', () => {
      expect(toFullRuPhone('+7 (919) 889-07-15')).toBe('79198890715');
      expect(toFullRuPhone('8 919 889 07 15')).toBe('79198890715');
      expect(toFullRuPhone('919')).toBeNull();
    });
  });

  describe('applyRuPhoneMask', () => {
    // Имитация набора цифры за цифрой в пустом поле: каждый ход подаём
    // (предыдущий результат + новая цифра в конце) и проверяем формат + позицию курсора.
    it('formats digit-by-digit and keeps the caret at the end', () => {
      let value = '';
      let digits = '';
      const type = (d: string) => {
        const raw = value + d;
        const r = applyRuPhoneMask(raw, raw.length, 'insertText', digits);
        value = r.value;
        digits = r.digits;
        return r;
      };

      expect(type('9').value).toBe('+7 (9');
      expect(type('1').value).toBe('+7 (91');
      expect(type('9').value).toBe('+7 (919)');
      let r = type('8');
      expect(r.value).toBe('+7 (919) 8');
      expect(r.caret).toBe(r.value.length);
      // добиваем до полного
      ['8', '9', '0', '7', '1', '5'].forEach(d => (r = type(d)));
      expect(r.value).toBe('+7 (919) 889-07-15');
      expect(r.caret).toBe(r.value.length);
      expect(r.digits).toBe('9198890715');
    });

    it('does not absorb the +7 prefix digit on re-entry (idempotent)', () => {
      // Повторный проход уже отформатированного частичного значения не должен превращать
      // "+7 (12" в "+7 (712" (баг неидемпотентности formatRuPhone на частичном вводе).
      const r = applyRuPhoneMask('+7 (12', 6, 'insertText', '1');
      expect(r.value).toBe('+7 (12');
      expect(r.digits).toBe('12');
    });

    it('strips a pasted 11-digit number with country code', () => {
      const r = applyRuPhoneMask('89198890715', 11, 'insertFromPaste', '');
      expect(r.value).toBe('+7 (919) 889-07-15');
      expect(r.digits).toBe('9198890715');
    });

    it('backspace over a separator deletes the adjacent digit, not just the separator', () => {
      // Было "+7 (919)", пользователь жмёт backspace → браузер убирает ')' → "+7 (919".
      // Маска должна удалить и цифру 9, дав "+7 (91".
      const r = applyRuPhoneMask('+7 (919', 7, 'deleteContentBackward', '919');
      expect(r.value).toBe('+7 (91');
      expect(r.digits).toBe('91');
    });

    it('backspace that actually removed a digit just reformats', () => {
      const r = applyRuPhoneMask('+7 (91', 6, 'deleteContentBackward', '919');
      expect(r.value).toBe('+7 (91');
      expect(r.digits).toBe('91');
    });

    it('clears to empty when the last digit is removed', () => {
      const r = applyRuPhoneMask('', 0, 'deleteContentBackward', '9');
      expect(r.value).toBe('');
      expect(r.digits).toBe('');
      expect(r.caret).toBe(0);
    });
  });
});
