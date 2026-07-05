import { z } from 'zod';

const mediaPayloadSchema = z.string().min(1);

const voximplantMediaSchema = z.object({
  event: z.literal('media'),
  sequenceNumber: z.number().int().nonnegative().optional(),
  media: z.object({
    chunk: z.number().int().nonnegative().optional(),
    timestamp: z.number().nonnegative().optional(),
    payload: mediaPayloadSchema,
  }).passthrough(),
}).passthrough();

const voximplantStartSchema = z.object({
  event: z.literal('start'),
  sequenceNumber: z.number().int().nonnegative().optional(),
  start: z.object({
    mediaFormat: z.object({
      encoding: z.string().optional(),
      sampleRate: z.number().int().positive().optional(),
      channels: z.number().int().positive().optional(),
    }).passthrough().optional(),
    customParameters: z.record(z.string()).optional(),
  }).passthrough().optional(),
}).passthrough();

const voximplantStopSchema = z.object({
  event: z.literal('stop'),
  sequenceNumber: z.number().int().nonnegative().optional(),
}).passthrough();

const bridgeControlSchema = z.object({
  customEvent: z.enum(['barge_in']),
}).passthrough();

const xaiOutputAudioSchema = z.object({
  type: z.union([
    z.literal('response.output_audio.delta'),
    z.literal('response.audio.delta'),
  ]),
  delta: mediaPayloadSchema.optional(),
  audio: mediaPayloadSchema.optional(),
}).passthrough();

export interface VoximplantMediaMessage {
  type: 'voximplant.media';
  sequenceNumber: number;
  chunk: number;
  timestamp: number;
  payload: string;
}

export interface VoximplantStartEvent {
  type: 'voximplant.start';
  sequenceNumber: number;
}

export interface VoximplantStopEvent {
  type: 'voximplant.stop';
  sequenceNumber: number;
}

export interface BridgeBargeInEvent {
  type: 'control.barge_in';
}

export type VoximplantBridgeMessage =
  | VoximplantMediaMessage
  | VoximplantStartEvent
  | VoximplantStopEvent
  | BridgeBargeInEvent;

export interface XaiSessionUpdateInput {
  voice: string;
  instructions: string;
}

export interface VoximplantMediaFrameInput {
  sequenceNumber: number;
  chunk: number;
  timestamp: number;
  payload: string;
}

export function parseVoximplantBridgeMessage(raw: string): VoximplantBridgeMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const media = voximplantMediaSchema.safeParse(parsed);
  if (media.success) {
    return {
      type: 'voximplant.media',
      sequenceNumber: media.data.sequenceNumber ?? 0,
      chunk: media.data.media.chunk ?? 0,
      timestamp: media.data.media.timestamp ?? 0,
      payload: media.data.media.payload,
    };
  }

  const start = voximplantStartSchema.safeParse(parsed);
  if (start.success) {
    return {
      type: 'voximplant.start',
      sequenceNumber: start.data.sequenceNumber ?? 0,
    };
  }

  const stop = voximplantStopSchema.safeParse(parsed);
  if (stop.success) {
    return {
      type: 'voximplant.stop',
      sequenceNumber: stop.data.sequenceNumber ?? 0,
    };
  }

  const control = bridgeControlSchema.safeParse(parsed);
  if (control.success && control.data.customEvent === 'barge_in') {
    return { type: 'control.barge_in' };
  }

  return null;
}

export function buildXaiSessionUpdate(input: XaiSessionUpdateInput): object {
  return {
    type: 'session.update',
    session: {
      voice: input.voice,
      instructions: input.instructions,
      turn_detection: {
        type: 'server_vad',
        threshold: 0.85,
        silence_duration_ms: 350,
        prefix_padding_ms: 300,
      },
      audio: {
        input: {
          format: {
            type: 'audio/pcmu',
          },
          transcription: {
            language_hint: 'ru',
          },
        },
        output: {
          format: {
            type: 'audio/pcmu',
          },
          speed: 1.2,
        },
      },
      tools: [
        {
          type: 'function',
          name: 'hangup_call',
          description: 'Завершить звонок, когда разговор окончен',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      ],
    },
  };
}

export function buildXaiAudioAppend(message: Pick<VoximplantMediaMessage, 'payload'>): object {
  // Voximplant и xAI говорят одним форматом: PCMU/μ-law 8 кГц.
  return {
    type: 'input_audio_buffer.append',
    audio: message.payload,
  };
}

/**
 * Аудио от xAI в `audio/pcmu` уже является μ-law 8 кГц, как ждёт Voximplant.
 * Оставляем функцию как явную границу формата на выходном пути моста.
 */
export function transcodeXaiAudioToVoximplant(pcmuBase64: string): string {
  return pcmuBase64;
}

export function buildXaiResponseCreate(instructions?: string): object {
  if (!instructions) return { type: 'response.create' };
  return {
    type: 'response.create',
    response: {
      instructions,
    },
  };
}

export function buildXaiForceMessage(text: string): object {
  return {
    type: 'conversation.item.create',
    item: {
      type: 'force_message',
      role: 'assistant',
      interruptible: true,
      content: [
        {
          type: 'output_text',
          text,
        },
      ],
    },
  };
}

export function buildXaiResponseCancel(): object {
  return { type: 'response.cancel' };
}

export function getXaiOutputAudioPayload(event: unknown): string | null {
  const parsed = xaiOutputAudioSchema.safeParse(event);
  if (!parsed.success) return null;

  return parsed.data.delta ?? parsed.data.audio ?? null;
}

export function buildVoximplantStartMessage(sequenceNumber: number): object {
  // Зеркалим ТОЧНЫЙ формат, который VoxEngine сам шлёт нам (encoding 'ULAW',
  // sampleRate 8000, без channels) — иначе VoxEngine может проигрывать не на той
  // частоте (ускоренно). Подтверждено диагностикой входящего 'start' VoxEngine.
  return {
    event: 'start',
    sequenceNumber,
    start: {
      mediaFormat: {
        encoding: 'ULAW',
        sampleRate: 8000,
      },
    },
  };
}

export function buildVoximplantMediaMessage(input: VoximplantMediaFrameInput): object {
  return {
    event: 'media',
    sequenceNumber: input.sequenceNumber,
    media: {
      chunk: input.chunk,
      timestamp: input.timestamp,
      payload: input.payload,
    },
  };
}
