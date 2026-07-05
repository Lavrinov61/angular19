import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RustDetectCropLinesResult } from './photo-retouch-tool.service.js';

const toolMock = vi.hoisted(() => ({
  detectCropLinesRust: vi.fn(),
}));

vi.mock('./photo-retouch-tool.service.js', () => ({
  detectCropLinesRust: toolMock.detectCropLinesRust,
}));

import { detectCropLines } from './crop-detect.service.js';

/** Базовый «лицо найдено» результат воркера с crop-полями. */
function detectResult(over: Partial<RustDetectCropLinesResult> = {}): RustDetectCropLinesResult {
  return {
    imageWidth: 800,
    imageHeight: 900,
    crownY: 80,
    chinY: 520,
    centerX: 400,
    tilt: 1.2,
    faceDetected: true,
    verdict: 'ok',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('detectCropLines', () => {
  it('лицо найдено → проецирует crownY/chinY/centerX/tilt из Rust tool', async () => {
    toolMock.detectCropLinesRust.mockResolvedValue(detectResult());
    const dto = await detectCropLines('https://svoefoto.ru/media/x.jpg');
    expect(dto).toEqual({
      imageWidth: 800,
      imageHeight: 900,
      crownY: 80,
      chinY: 520,
      centerX: 400,
      tilt: 1.2,
      faceDetected: true,
      verdict: 'ok',
    });
  });

  it('лицо НЕ найдено → координаты null, faceDetected=false', async () => {
    toolMock.detectCropLinesRust.mockResolvedValue(
      detectResult({
        faceDetected: false,
        verdict: 'no_face',
      }),
    );
    const dto = await detectCropLines('https://svoefoto.ru/media/x.jpg');
    expect(dto.faceDetected).toBe(false);
    expect(dto.verdict).toBe('no_face');
    expect(dto.crownY).toBeNull();
    expect(dto.chinY).toBeNull();
    expect(dto.centerX).toBeNull();
    expect(dto.tilt).toBeNull();
    expect(dto.imageWidth).toBe(800);
    expect(dto.imageHeight).toBe(900);
  });

  it('отрицательный tilt (наклон в другую сторону) передаётся со знаком', async () => {
    toolMock.detectCropLinesRust.mockResolvedValue(detectResult({ tilt: -4.5, verdict: 'tilted' }));
    const dto = await detectCropLines('https://svoefoto.ru/media/x.jpg');
    expect(dto.tilt).toBe(-4.5);
    expect(dto.verdict).toBe('tilted');
  });

  it('Rust tool вернул null-линии → DTO не подставляет формульные fallback-координаты', async () => {
    toolMock.detectCropLinesRust.mockResolvedValue(detectResult({
      crownY: null,
      centerX: null,
      tilt: null,
    }));
    const dto = await detectCropLines('https://svoefoto.ru/media/x.jpg');
    expect(dto.faceDetected).toBe(true);
    expect(dto.crownY).toBeNull();
    expect(dto.centerX).toBeNull();
    expect(dto.tilt).toBeNull();
    expect(dto.chinY).toBe(520);
  });
});
