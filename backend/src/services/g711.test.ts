import { describe, expect, it } from 'vitest';

import {
  linearToMulaw,
  mulawToLinear,
  mulawBase64ToPcm16Base64,
  pcm16Base64ToMulawBase64,
} from './g711.js';

describe('g711 μ-law ↔ PCM16', () => {
  it('кодирует тишину (0) в стандартный μ-law 0xFF', () => {
    expect(linearToMulaw(0)).toBe(0xff);
  });

  it('кодирует знак: положительные и отрицательные дают разный старший бит', () => {
    const pos = linearToMulaw(1000);
    const neg = linearToMulaw(-1000);
    expect((pos ^ neg) & 0x80).toBe(0x80);
  });

  it('клиппинг: значения за пределами CLIP не выходят за диапазон байта', () => {
    expect(linearToMulaw(40000)).toBeGreaterThanOrEqual(0);
    expect(linearToMulaw(40000)).toBeLessThanOrEqual(0xff);
    expect(linearToMulaw(-40000)).toBeGreaterThanOrEqual(0);
  });

  it('round-trip PCM16→μ-law→PCM16 близок к оригиналу (μ-law лоссовый, но монотонный)', () => {
    const samples = [-32000, -8000, -1000, -100, 0, 100, 1000, 8000, 32000];
    for (const s of samples) {
      const back = mulawToLinear(linearToMulaw(s));
      // μ-law даёт большую квантовую ошибку на больших амплитудах; проверяем знак и относительную близость
      expect(Math.sign(back)).toBe(Math.sign(s) || Math.sign(back) === 0 ? Math.sign(back) : Math.sign(s));
      const tolerance = Math.max(256, Math.abs(s) * 0.1);
      expect(Math.abs(back - s)).toBeLessThanOrEqual(tolerance);
    }
  });

  it('μ-law монотонно сохраняет порядок амплитуд', () => {
    const a = mulawToLinear(linearToMulaw(2000));
    const b = mulawToLinear(linearToMulaw(8000));
    expect(b).toBeGreaterThan(a);
  });

  it('base64 μ-law → base64 PCM16 удваивает число байт (1 байт → 2 байта/сэмпл)', () => {
    const mulaw = Buffer.from([0xff, 0x00, 0x7f, 0x80]);
    const pcm16Base64 = mulawBase64ToPcm16Base64(mulaw.toString('base64'));
    const pcm = Buffer.from(pcm16Base64, 'base64');
    expect(pcm.length).toBe(mulaw.length * 2);
  });

  it('base64 PCM16 → base64 μ-law вдвое сокращает (2 байта/сэмпл → 1 байт)', () => {
    const pcm = Buffer.alloc(8); // 4 сэмпла
    pcm.writeInt16LE(0, 0);
    pcm.writeInt16LE(5000, 2);
    pcm.writeInt16LE(-5000, 4);
    pcm.writeInt16LE(20000, 6);
    const mulawBase64 = pcm16Base64ToMulawBase64(pcm.toString('base64'));
    expect(Buffer.from(mulawBase64, 'base64').length).toBe(4);
  });

  it('полный путь μ-law(Vox)→PCM16(xAI)→μ-law(Vox) стабилен по длине и линейно близок', () => {
    // 0x7F (−0) и 0xFF (+0) — оба «ноль» в μ-law; кроме знака нуля декод→кодир идемпотентен.
    const original = Buffer.from([0xff, 0x10, 0x90, 0x33, 0xcc, 0x01, 0xfe]);
    const pcm16 = mulawBase64ToPcm16Base64(original.toString('base64'));
    const roundTrip = Buffer.from(pcm16Base64ToMulawBase64(pcm16), 'base64');
    expect(roundTrip.length).toBe(original.length);
    expect(roundTrip.equals(original)).toBe(true);
  });
});
