import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

// Мок storage: keyFromUrl/downloadToBuffer. Реальный sharp используем по-настоящему — проверяем
// P0-1 (двухпроходность: итог РОВНО target, не target+extend) на синтетическом изображении.
const storageMock = vi.hoisted(() => ({
  keyFromUrl: vi.fn(),
  downloadToBuffer: vi.fn(),
}));

vi.mock('../storage.service.js', () => ({
  storageService: storageMock,
}));

// БД-пресеты не нужны — fallback на встроенный PASSPORT_RF_PRESET; мокаем db, чтобы loadCropPreset/
// loadKnownDocumentTypes падали в fallback (встроенный passport_rf).
const dbMock = vi.hoisted(() => ({
  query: vi.fn().mockRejectedValue(new Error('no db in test')),
  queryOne: vi.fn().mockRejectedValue(new Error('no db in test')),
}));

vi.mock('../../database/db.js', () => ({
  default: dbMock,
}));

import { executeCropDocument } from './crop-document.executor.js';

/** Синтетическое JPEG-изображение заданного размера. */
async function makeImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 130, b: 140 } },
  })
    .jpeg()
    .toBuffer();
}

const VALID_URL = 'https://svoefoto.ru/media/chat/test.jpg';

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.keyFromUrl.mockReturnValue('chat/test.jpg');
});

describe('executeCropDocument — guard и валидация', () => {
  it('не-S3 url → ошибка guard (keyFromUrl=null)', async () => {
    storageMock.keyFromUrl.mockReturnValue(null);
    await expect(
      executeCropDocument('https://evil.example.com/x.jpg', {
        documentType: 'passport_rf',
        crownY: 200,
        chinY: 520,
        centerX: 400,
      }),
    ).rejects.toThrow(/from our storage/);
    expect(storageMock.downloadToBuffer).not.toHaveBeenCalled();
  });

  it('координаты вне границ → bounds-fail (уровень 2)', async () => {
    const img = await makeImage(800, 900);
    storageMock.downloadToBuffer.mockResolvedValue({ buffer: img });
    await expect(
      executeCropDocument(VALID_URL, {
        documentType: 'passport_rf',
        crownY: 200,
        chinY: 1200, // > height 900
        centerX: 400,
      }),
    ).rejects.toThrow(/validation failed/i);
  });

  it('неизвестный тип документа → ошибка (уровень 2)', async () => {
    const img = await makeImage(800, 900);
    storageMock.downloadToBuffer.mockResolvedValue({ buffer: img });
    await expect(
      executeCropDocument(VALID_URL, {
        documentType: 'visa_usa',
        crownY: 200,
        chinY: 520,
        centerX: 400,
      }),
    ).rejects.toThrow();
  });
});

describe('executeCropDocument — happy path (нормальный кейс, всё в кадре)', () => {
  it('даёт результат РОВНО 1102×1417 @ 800 dpi, без extend', async () => {
    // pxPerMm=10: crown=200, chin=520, center=400, img 800×900 → extract={225,150,350,450}, extend=0.
    const img = await makeImage(800, 900);
    storageMock.downloadToBuffer.mockResolvedValue({ buffer: img });

    const { buffer, plan } = await executeCropDocument(VALID_URL, {
      documentType: 'passport_rf',
      crownY: 200,
      chinY: 520,
      centerX: 400,
    });

    expect(plan.extend).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    expect(plan.target).toEqual({ width: 1102, height: 1417 });

    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(1102);
    expect(meta.height).toBe(1417);
    expect(meta.density).toBe(800);
    expect(meta.format).toBe('jpeg');
  });
});

describe('executeCropDocument — P0-1 двухпроходность (edge: рамка за верхним краем)', () => {
  it('при extend.top>0 итоговая высота РОВНО 531 (НЕ 531+extend)', async () => {
    // Макушка близко к краю: crown=20, chin=340 (pxPerMm=10), topMargin 5мм=50px → idealTop=20-50=-30 → extend.top>0.
    const img = await makeImage(800, 900);
    storageMock.downloadToBuffer.mockResolvedValue({ buffer: img });

    const { buffer, plan } = await executeCropDocument(VALID_URL, {
      documentType: 'passport_rf',
      crownY: 20,
      chinY: 340,
      centerX: 400,
    });

    expect(plan.extend.top).toBeGreaterThan(0);
    expect(plan.warnings.some((w) => w.code === 'extend_top')).toBe(true);

    const meta = await sharp(buffer).metadata();
    // P0-1: даже с extend сверху итог == target.height, а НЕ target.height + extend.top.
    expect(meta.width).toBe(1102);
    expect(meta.height).toBe(1417);
    expect(meta.density).toBe(800);
  });

  it('при extend.bottom>0 итоговая высота РОВНО 531 (страховка от регрессии однопроходности вниз)', async () => {
    // Изображение НИЗКОЕ: 800×560. crown=200, chin=520 (pxPerMm=10) — оба в границах [0,560].
    // cropH=450, idealTop=200-50=150, 150+450=600 > 560 → extend.bottom=40. Однопроходный sharp дал бы
    // 413×571; двухпроходный — ровно 413×531.
    const img = await makeImage(800, 560);
    storageMock.downloadToBuffer.mockResolvedValue({ buffer: img });

    const { buffer, plan } = await executeCropDocument(VALID_URL, {
      documentType: 'passport_rf',
      crownY: 200,
      chinY: 520,
      centerX: 400,
    });

    expect(plan.extend.bottom).toBeGreaterThan(0);
    expect(plan.warnings.some((w) => w.code === 'extend_bottom')).toBe(true);

    const meta = await sharp(buffer).metadata();
    // P0-1 (вниз): итог == target.height, а НЕ target.height + extend.bottom.
    expect(meta.width).toBe(1102);
    expect(meta.height).toBe(1417);
    expect(meta.density).toBe(800);
  });
});

describe('executeCropDocument — битый буфер (не-картинка)', () => {
  it('не-картиночный буфер → понятная ошибка, не краш', async () => {
    // Валидный S3-url (guard проходит), но downloadToBuffer отдаёт мусор → validateImageBuffer отбраковывает.
    storageMock.downloadToBuffer.mockResolvedValue({ buffer: Buffer.from('this is not an image') });
    await expect(
      executeCropDocument(VALID_URL, {
        documentType: 'passport_rf',
        crownY: 200,
        chinY: 520,
        centerX: 400,
      }),
    ).rejects.toThrow(/Invalid image for crop/);
  });
});
