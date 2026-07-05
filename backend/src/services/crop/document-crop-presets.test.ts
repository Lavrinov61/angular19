import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('../../database/db.js', () => ({
  default: dbMock,
}));

import {
  PASSPORT_RF_PRESET,
  PHOTO_4X6_PRESET,
  PHOTO_9X12_PRESET,
  PHOTO_3X4_PRESET,
  VISA_SCHENGEN_PRESET,
  loadCropPreset,
  loadKnownDocumentTypes,
} from './document-crop-presets.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PASSPORT_RF_PRESET (встроенная константа)', () => {
  it('содержит числа владельца: 35×45, отступ 5, голова 32, 800dpi', () => {
    expect(PASSPORT_RF_PRESET).toMatchObject({
      slug: 'passport_rf',
      photoWmm: 35,
      photoHmm: 45,
      topMarginMm: 5,
      headHeightMm: 32,
      dpi: 800,
      jpegQuality: 92,
    });
  });
});

describe('встроенные пресеты документов', () => {
  it('содержит Визу Шенген 35×45: отступ 3мм, лицо 32мм, 800dpi', () => {
    expect(VISA_SCHENGEN_PRESET).toMatchObject({
      slug: 'visa_schengen',
      label: 'Виза Шенген 35×45',
      photoWmm: 35,
      photoHmm: 45,
      topMarginMm: 3,
      headHeightMm: 32,
      dpi: 800,
      jpegQuality: 92,
    });
  });

  it('содержит Фото 3×4: отступ 3мм, лицо 26мм, 800dpi', () => {
    expect(PHOTO_3X4_PRESET).toMatchObject({
      slug: 'photo_3x4',
      label: 'Фото 3×4',
      photoWmm: 30,
      photoHmm: 40,
      topMarginMm: 3,
      headHeightMm: 26,
      dpi: 800,
      jpegQuality: 92,
    });
  });

  it('содержит Фото 9×12 и Фото 4×6 для рабочего места кадрирования', () => {
    expect(PHOTO_9X12_PRESET).toMatchObject({
      slug: 'photo_9x12',
      label: 'Фото 9×12',
      photoWmm: 90,
      photoHmm: 120,
      topMarginMm: 10,
      headHeightMm: 65,
      dpi: 800,
      jpegQuality: 92,
    });
    expect(PHOTO_4X6_PRESET).toMatchObject({
      slug: 'photo_4x6',
      label: 'Фото 4×6',
      photoWmm: 40,
      photoHmm: 60,
      topMarginMm: 5,
      headHeightMm: 34,
      dpi: 800,
      jpegQuality: 92,
    });
  });
});

describe('loadCropPreset', () => {
  it('возвращает пресет из БД, конвертируя numeric-строки в числа', async () => {
    dbMock.queryOne.mockResolvedValue({
      slug: 'passport_rf',
      label: 'Паспорт РФ 35×45',
      photo_w_mm: '35.00',
      photo_h_mm: '45.00',
      top_margin_mm: '5.00',
      head_height_mm: '32.00',
      dpi: 800,
      jpeg_quality: 92,
    });
    const preset = await loadCropPreset('passport_rf');
    expect(preset).toEqual({
      slug: 'passport_rf',
      label: 'Паспорт РФ 35×45',
      photoWmm: 35,
      photoHmm: 45,
      topMarginMm: 5,
      headHeightMm: 32,
      dpi: 800,
      jpegQuality: 92,
    });
  });

  it('fallback на встроенный пресет, если строки в БД нет', async () => {
    dbMock.queryOne.mockResolvedValue(null);
    const preset = await loadCropPreset('passport_rf');
    expect(preset).toEqual(PASSPORT_RF_PRESET);
  });

  it('fallback на встроенный пресет, если БД бросает ошибку', async () => {
    dbMock.queryOne.mockRejectedValue(new Error('db down'));
    const preset = await loadCropPreset('passport_rf');
    expect(preset).toEqual(PASSPORT_RF_PRESET);
  });

  it('fallback на встроенные пресеты новых форматов, если строки в БД нет', async () => {
    dbMock.queryOne.mockResolvedValue(null);

    await expect(loadCropPreset('visa_schengen')).resolves.toEqual(VISA_SCHENGEN_PRESET);
    await expect(loadCropPreset('photo_3x4')).resolves.toEqual(PHOTO_3X4_PRESET);
    await expect(loadCropPreset('photo_9x12')).resolves.toEqual(PHOTO_9X12_PRESET);
    await expect(loadCropPreset('photo_4x6')).resolves.toEqual(PHOTO_4X6_PRESET);
  });

  it('unknown slug → null (ни в БД, ни в fallback)', async () => {
    dbMock.queryOne.mockResolvedValue(null);
    const preset = await loadCropPreset('visa_usa');
    expect(preset).toBeNull();
  });
});

describe('loadKnownDocumentTypes', () => {
  it('объединяет слаги из БД и встроенные', async () => {
    dbMock.query.mockResolvedValue([{ slug: 'passport_rf' }, { slug: 'visa_schengen' }]);
    const known = await loadKnownDocumentTypes();
    expect(known.has('passport_rf')).toBe(true);
    expect(known.has('visa_schengen')).toBe(true);
  });

  it('при ошибке БД возвращает хотя бы встроенные слаги (содержит passport_rf)', async () => {
    dbMock.query.mockRejectedValue(new Error('db down'));
    const known = await loadKnownDocumentTypes();
    expect(known.has('passport_rf')).toBe(true);
    expect(known.has('visa_schengen')).toBe(true);
    expect(known.has('photo_3x4')).toBe(true);
    expect(known.has('photo_9x12')).toBe(true);
    expect(known.has('photo_4x6')).toBe(true);
  });

  it('всегда содержит built-in слаги, даже если БД вернула пусто', async () => {
    dbMock.query.mockResolvedValue([]);
    const known = await loadKnownDocumentTypes();
    expect(known.has('passport_rf')).toBe(true);
    expect(known.has('visa_schengen')).toBe(true);
    expect(known.has('photo_3x4')).toBe(true);
    expect(known.has('photo_9x12')).toBe(true);
    expect(known.has('photo_4x6')).toBe(true);
  });
});
