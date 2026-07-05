/**
 * G.711 μ-law ↔ linear PCM16 helpers.
 *
 * Не используйте эти helpers на основном xAI realtime пути с `audio/pcmu`:
 * Voximplant WebSocket-медиа и xAI `audio/pcmu` оба передают μ-law 8 кГц.
 * Они нужны только для диагностики или если внешний endpoint явно ждёт PCM16.
 *
 * Алгоритмы — стандартный G.711 (BIAS 0x84, CLIP 32635), без внешних зависимостей.
 */

const BIAS = 0x84;
const CLIP = 32635;

/** Один линейный сэмпл PCM16 → один байт μ-law. */
export function linearToMulaw(sampleInput: number): number {
  let sample = sampleInput;
  let sign = 0;
  if (sample < 0) {
    sample = -sample;
    sign = 0x80;
  }
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;

  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent -= 1, expMask >>= 1) {
    // сдвигаем маску, пока не найдём старший установленный бит
  }

  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** Один байт μ-law → один линейный сэмпл PCM16. */
export function mulawToLinear(mulawByteInput: number): number {
  const mulawByte = ~mulawByteInput & 0xff;
  const sign = mulawByte & 0x80;
  const exponent = (mulawByte >> 4) & 0x07;
  const mantissa = mulawByte & 0x0f;
  let sample = ((mantissa << 3) + BIAS) << exponent;
  sample -= BIAS;
  return sign ? -sample : sample;
}

/**
 * μ-law base64 → линейный PCM16 LE base64.
 */
export function mulawBase64ToPcm16Base64(mulawBase64: string): string {
  const mulaw = Buffer.from(mulawBase64, 'base64');
  const pcm = Buffer.allocUnsafe(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i += 1) {
    pcm.writeInt16LE(mulawToLinear(mulaw[i]!), i * 2);
  }
  return pcm.toString('base64');
}

/**
 * Линейный PCM16 LE base64 → μ-law base64.
 * Нечётный хвостовой байт (неполный сэмпл) отбрасывается.
 */
export function pcm16Base64ToMulawBase64(pcm16Base64: string): string {
  const pcm = Buffer.from(pcm16Base64, 'base64');
  const sampleCount = pcm.length >> 1;
  const mulaw = Buffer.allocUnsafe(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    mulaw[i] = linearToMulaw(pcm.readInt16LE(i * 2));
  }
  return mulaw.toString('base64');
}
