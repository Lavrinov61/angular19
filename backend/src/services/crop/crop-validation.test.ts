import { describe, expect, it } from 'vitest';
import { validateCropInput, MIN_FACE_HEIGHT_PX } from './crop-validation.js';

// Каноническая спецификация: см. 30-architecture.md, раздел «Анти-тампер — ДВА УРОВНЯ».
const KNOWN = new Set(['passport_rf']);
const IMG = { width: 800, height: 900 };

describe('validateCropInput — уровень 1 (без image, без bounds)', () => {
  it('happy: валидный вход → valid + нормализованные values', () => {
    const res = validateCropInput(
      { documentType: 'passport_rf', crownY: 200, chinY: 520, centerX: 400 },
      KNOWN
    );
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.values).toEqual({
      documentType: 'passport_rf',
      crownY: 200,
      chinY: 520,
      centerX: 400,
      rotationDeg: 0,
    });
  });

  it('инвариант 1: неизвестный documentType → unknown_document_type', () => {
    const res = validateCropInput(
      { documentType: 'visa_usa', crownY: 200, chinY: 520, centerX: 400 },
      KNOWN
    );
    expect(res.valid).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain('unknown_document_type');
  });

  it('инвариант 2: нечисловые/NaN координаты → non_finite_coordinate', () => {
    const res = validateCropInput(
      { documentType: 'passport_rf', crownY: '200', chinY: NaN, centerX: Infinity },
      KNOWN
    );
    expect(res.valid).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain('non_finite_coordinate');
  });

  it('инвариант 3: crownY >= chinY → crown_not_above_chin', () => {
    const res = validateCropInput(
      { documentType: 'passport_rf', crownY: 520, chinY: 200, centerX: 400 },
      KNOWN
    );
    expect(res.valid).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain('crown_not_above_chin');
  });

  it('инвариант 3: crownY == chinY (не строго меньше) → crown_not_above_chin', () => {
    const res = validateCropInput(
      { documentType: 'passport_rf', crownY: 300, chinY: 300, centerX: 400 },
      KNOWN
    );
    expect(res.valid).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain('crown_not_above_chin');
  });

  it('инвариант 4: высота лица < MIN_FACE_HEIGHT_PX → face_height_too_small', () => {
    const res = validateCropInput(
      { documentType: 'passport_rf', crownY: 300, chinY: 300 + MIN_FACE_HEIGHT_PX - 1, centerX: 400 },
      KNOWN
    );
    expect(res.valid).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain('face_height_too_small');
  });

  it('инвариант 4: высота лица ровно MIN_FACE_HEIGHT_PX → валидно', () => {
    const res = validateCropInput(
      { documentType: 'passport_rf', crownY: 300, chinY: 300 + MIN_FACE_HEIGHT_PX, centerX: 400 },
      KNOWN
    );
    expect(res.valid).toBe(true);
  });

  it('без image: bounds НЕ проверяются (координаты за краем проходят уровень 1)', () => {
    const res = validateCropInput(
      { documentType: 'passport_rf', crownY: -50, chinY: 99999, centerX: 99999 },
      KNOWN
    );
    // -50 < 99999, высота огромна → уровень 1 проходит (bounds не его дело)
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('множественные ошибки накапливаются списком (не fail-fast)', () => {
    const res = validateCropInput(
      { documentType: 'nope', crownY: 'x', chinY: null, centerX: undefined },
      KNOWN
    );
    expect(res.valid).toBe(false);
    const codes = res.errors.map((e) => e.code);
    expect(codes).toContain('unknown_document_type');
    expect(codes).toContain('non_finite_coordinate');
    expect(res.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('принимает массив слагов как knownTypes (не только Set)', () => {
    const res = validateCropInput(
      { documentType: 'passport_rf', crownY: 200, chinY: 520, centerX: 400 },
      ['passport_rf']
    );
    expect(res.valid).toBe(true);
  });

  it('rotationDeg опционален и проходит, когда в диапазоне нескольких градусов', () => {
    const res = validateCropInput(
      { documentType: 'passport_rf', crownY: 200, chinY: 520, centerX: 400, rotationDeg: -3.5 },
      KNOWN
    );
    expect(res.valid).toBe(true);
    expect(res.values).toMatchObject({ rotationDeg: -3.5 });
  });

  it('rotationDeg вне диапазона [-10,10] → rotation_out_of_range', () => {
    const res = validateCropInput(
      { documentType: 'passport_rf', crownY: 200, chinY: 520, centerX: 400, rotationDeg: 15 },
      KNOWN
    );
    expect(res.valid).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain('rotation_out_of_range');
  });
});

describe('validateCropInput — уровень 2 (с image, +bounds)', () => {
  it('happy: координаты в пределах → valid', () => {
    const res = validateCropInput(
      { documentType: 'passport_rf', crownY: 200, chinY: 520, centerX: 400 },
      KNOWN,
      IMG
    );
    expect(res.valid).toBe(true);
  });

  it('инвариант 5: crownY вне [0,height] → coordinate_out_of_bounds', () => {
    const res = validateCropInput(
      { documentType: 'passport_rf', crownY: -1, chinY: 520, centerX: 400 },
      KNOWN,
      IMG
    );
    expect(res.valid).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain('coordinate_out_of_bounds');
  });

  it('инвариант 5: chinY > height → coordinate_out_of_bounds', () => {
    const res = validateCropInput(
      { documentType: 'passport_rf', crownY: 200, chinY: 1000, centerX: 400 },
      KNOWN,
      IMG
    );
    expect(res.valid).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain('coordinate_out_of_bounds');
  });

  it('инвариант 5: centerX > width → coordinate_out_of_bounds', () => {
    const res = validateCropInput(
      { documentType: 'passport_rf', crownY: 200, chinY: 520, centerX: 900 },
      KNOWN,
      IMG
    );
    expect(res.valid).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain('coordinate_out_of_bounds');
  });

  it('граница: координаты ровно на краю (0 и height/width) → валидно', () => {
    const res = validateCropInput(
      { documentType: 'passport_rf', crownY: 0, chinY: 900, centerX: 800 },
      KNOWN,
      IMG
    );
    expect(res.valid).toBe(true);
  });
});
