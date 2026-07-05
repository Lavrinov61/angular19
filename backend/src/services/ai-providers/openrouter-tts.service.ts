/**
 * TTS через OpenRouter — синтез речи для голосового опроса-заботы.
 *
 * OpenRouter имеет выделенный OpenAI-совместимый endpoint `/api/v1/audio/speech`
 * (docs: openrouter.ai/docs/guides/overview/multimodal/tts). Возвращает СЫРОЙ
 * байтовый поток аудио (не JSON). Параметры: model, input, voice, response_format
 * ('mp3'|'pcm', дефолт pcm), speed, provider. Мы берём mp3 — он напрямую играется
 * в Voximplant через createURLPlayer.
 *
 * Доступные TTS-модели на нашем ключе (проверено 2026-06-03):
 *   - x-ai/grok-voice-tts-1.0  — ГОЛОС GROK (мечта владельца, без ключа xAI!),
 *       голоса Eve/Ara/Rex/Sal/Leo, 20+ языков, $15/M символов;
 *   - openai/gpt-4o-mini-tts-2025-12-15 — голос OpenAI (alloy/shimmer/coral/...),
 *       поддерживает provider.options.openai.instructions (тон).
 * ВАЖНО про id: суффикс версии/даты обязателен (без него «Model does not exist»).
 *
 * Сменить движок/голос = config.voximplant.serviceSurvey.voiceModel/voiceName.
 * См. файл памяти voximplant-voice-agent-stack-2026-06-03.
 */

import { config } from '../../config/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('openrouter-tts');
const OPENROUTER_TTS_URL = 'https://openrouter.ai/api/v1/audio/speech';
const TTS_TIMEOUT_MS = 20000;

export interface SynthesizedSpeech {
  /** Готовый аудио-буфер (mp3) для проигрывания через URLPlayer. */
  buffer: Buffer;
  mime: 'audio/mpeg';
  ext: 'mp3';
  /** Грубая оценка длительности (точную Voximplant ловит по PlaybackFinished). */
  durationMs: number;
}

interface SpeechRequestBody {
  model: string;
  input: string;
  voice: string;
  response_format: 'mp3';
  provider?: { options?: { openai?: { instructions?: string } } };
}

/**
 * Синтезирует речь из текста (mp3). Бросает при ошибке/пустом ответе — вызывающий
 * код делает фолбэк на встроенный TTS Voximplant (call.say).
 */
export async function synthesizeSpeech(text: string): Promise<SynthesizedSpeech> {
  const clean = text.trim();
  if (!clean) throw new Error('synthesizeSpeech: пустой текст');

  const apiKey = config.ai.openrouterApiKey;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY не настроен');

  const { voiceModel, voiceName, voiceInstructions } = config.voximplant.serviceSurvey;
  const body: SpeechRequestBody = {
    model: voiceModel,
    input: clean,
    voice: voiceName,
    response_format: 'mp3',
  };
  // instructions поддерживает только OpenAI TTS; для Grok/прочих провайдер их игнорит.
  if (voiceInstructions && voiceModel.startsWith('openai/')) {
    body.provider = { options: { openai: { instructions: voiceInstructions } } };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(OPENROUTER_TTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://svoefoto.ru',
        'X-Title': 'Svoe Foto Voice Survey',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    // Не-200 возвращает JSON-ошибку, не аудио.
    const errText = (await response.text()).slice(0, 300);
    throw new Error(`OpenRouter TTS HTTP ${response.status}: ${errText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error('OpenRouter TTS: пустой аудио-ответ');
  }

  // ~70 мс на символ русского текста — достаточно для логов/страховочных таймеров.
  const durationMs = Math.max(1500, clean.length * 70);
  log.info('TTS синтез готов', { model: voiceModel, voice: voiceName, chars: clean.length, bytes: buffer.length });
  return { buffer, mime: 'audio/mpeg', ext: 'mp3', durationMs };
}
