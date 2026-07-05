import { describe, it, expect } from 'vitest';
import { normalizePhone } from './chat-order.service.js';

describe('normalizePhone', () => {
  it('+7XXXXXXXXXX → сохраняет формат', () => {
    expect(normalizePhone('+79011234567')).toBe('+79011234567');
  });

  it('89011234567 → +79011234567', () => {
    expect(normalizePhone('89011234567')).toBe('+79011234567');
  });

  it('79011234567 → +79011234567', () => {
    expect(normalizePhone('79011234567')).toBe('+79011234567');
  });

  it('9011234567 (10 цифр) → +79011234567', () => {
    expect(normalizePhone('9011234567')).toBe('+79011234567');
  });

  it('+7 (901) 123-45-67 → +79011234567', () => {
    expect(normalizePhone('+7 (901) 123-45-67')).toBe('+79011234567');
  });

  it('8-901-123-45-67 → +79011234567', () => {
    expect(normalizePhone('8-901-123-45-67')).toBe('+79011234567');
  });

  it('слишком короткий номер → null', () => {
    expect(normalizePhone('123')).toBeNull();
  });

  it('12 цифр → null', () => {
    expect(normalizePhone('790112345678')).toBeNull();
  });

  it('пустая строка → null', () => {
    expect(normalizePhone('')).toBeNull();
  });

  it('текст без цифр → null', () => {
    expect(normalizePhone('нет номера')).toBeNull();
  });
});
