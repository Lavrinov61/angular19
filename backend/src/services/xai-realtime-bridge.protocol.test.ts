import { describe, expect, it } from 'vitest';

import {
  buildXaiAudioAppend,
  buildXaiResponseCancel,
  buildXaiResponseCreate,
  buildXaiSessionUpdate,
  buildVoximplantMediaMessage,
  buildVoximplantStartMessage,
  buildXaiForceMessage,
  getXaiOutputAudioPayload,
  parseVoximplantBridgeMessage,
  transcodeXaiAudioToVoximplant,
} from './xai-realtime-bridge.protocol.js';

describe('xAI realtime bridge protocol', () => {
  it('configures xAI for bidirectional telephone mulaw audio', () => {
    expect(buildXaiSessionUpdate({
      voice: 'om17cury',
      instructions: 'Говори по-русски.',
    })).toEqual({
      type: 'session.update',
      session: {
        voice: 'om17cury',
        instructions: 'Говори по-русски.',
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
    });
  });

  it('maps Voximplant media frames to xAI audio append events', () => {
    const voxPcmuBase64 = Buffer.from([0xff, 0x7f, 0x00, 0x80]).toString('base64');
    const message = parseVoximplantBridgeMessage(JSON.stringify({
      event: 'media',
      sequenceNumber: 7,
      media: {
        chunk: 3,
        timestamp: 40,
        payload: voxPcmuBase64,
      },
    }));

    expect(message).toEqual({
      type: 'voximplant.media',
      sequenceNumber: 7,
      chunk: 3,
      timestamp: 40,
      payload: voxPcmuBase64,
    });
    expect(message?.type).toBe('voximplant.media');
    if (message?.type !== 'voximplant.media') {
      throw new Error('expected Voximplant media message');
    }
    expect(buildXaiAudioAppend(message)).toEqual({
      type: 'input_audio_buffer.append',
      audio: voxPcmuBase64,
    });
  });

  it('maps xAI output audio deltas back to Voximplant media frames', () => {
    const xaiPcmuBase64 = Buffer.from([0xff, 0xff, 0x7f, 0x7f, 0x00, 0x80]).toString('base64');
    const payload = getXaiOutputAudioPayload({
      type: 'response.output_audio.delta',
      delta: xaiPcmuBase64,
    });

    expect(payload).toBe(xaiPcmuBase64);
    expect(transcodeXaiAudioToVoximplant(payload ?? '')).toBe(xaiPcmuBase64);
    expect(buildVoximplantStartMessage(0)).toEqual({
      event: 'start',
      sequenceNumber: 0,
      start: {
        mediaFormat: {
          encoding: 'ULAW',
          sampleRate: 8000,
        },
      },
    });
    expect(buildVoximplantMediaMessage({
      sequenceNumber: 1,
      chunk: 1,
      timestamp: 20,
      payload: payload ?? '',
    })).toEqual({
      event: 'media',
      sequenceNumber: 1,
      media: {
        chunk: 1,
        timestamp: 20,
        payload: xaiPcmuBase64,
      },
    });
  });

  it('maps bridge control messages to xAI response control events', () => {
    expect(parseVoximplantBridgeMessage(JSON.stringify({
      customEvent: 'barge_in',
    }))).toEqual({
      type: 'control.barge_in',
    });
    expect(buildXaiResponseCancel()).toEqual({ type: 'response.cancel' });
    expect(buildXaiResponseCreate()).toEqual({ type: 'response.create' });
    expect(buildXaiResponseCreate('Скажи ровно: «Здравствуйте!»')).toEqual({
      type: 'response.create',
      response: {
        instructions: 'Скажи ровно: «Здравствуйте!»',
      },
    });
    expect(buildXaiForceMessage('Здравствуйте! Это Своё Фото.')).toEqual({
      type: 'conversation.item.create',
      item: {
        type: 'force_message',
        role: 'assistant',
        interruptible: true,
        content: [
          {
            type: 'output_text',
            text: 'Здравствуйте! Это Своё Фото.',
          },
        ],
      },
    });
  });
});
