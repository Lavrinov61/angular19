import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SurveyTurnMessage } from './service-survey-turn.service.js';

const { mockChatWithTools, mockSynthesize, mockUpload, mockPresign } = vi.hoisted(() => ({
  mockChatWithTools: vi.fn(),
  mockSynthesize: vi.fn(),
  mockUpload: vi.fn(),
  mockPresign: vi.fn(),
}));

vi.mock('../config/index.js', () => ({
  config: {
    ai: { openrouterApiKey: 'test-key' },
    voximplant: {
      serviceSurvey: {
        greeting: 'GREETING_TEXT',
        maxTurns: 3,
        voiceEngine: 'remote',
        voiceModel: 'x-ai/grok-voice-tts-1.0',
        voiceName: 'Eve',
        voiceInstructions: '',
        brainModel: 'x-ai/grok-4.20',
      },
    },
  },
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('./ai-providers/openrouter.provider.js', () => ({
  OpenRouterProvider: class {
    chatWithTools = mockChatWithTools;
  },
}));

vi.mock('./ai-providers/openrouter-tts.service.js', () => ({
  synthesizeSpeech: mockSynthesize,
}));

vi.mock('./storage.service.js', () => ({
  storageService: { upload: mockUpload, generatePresignedGetUrl: mockPresign },
}));

const { runSurveyTurn, __resetSurveyTurnCache } = await import('./service-survey-turn.service.js');

function history(...pairs: [SurveyTurnMessage['role'], string][]): SurveyTurnMessage[] {
  return pairs.map(([role, text]) => ({ role, text }));
}

describe('runSurveyTurn', () => {
  beforeEach(() => {
    __resetSurveyTurnCache();
    mockChatWithTools.mockReset();
    mockSynthesize.mockReset().mockResolvedValue({ buffer: Buffer.from('x'), mime: 'audio/mpeg', ext: 'mp3', durationMs: 1000 });
    mockUpload.mockReset().mockResolvedValue({ url: 'https://svoefoto.ru/media/audio.mp3' });
    mockPresign.mockReset().mockResolvedValue('https://svoefoto.ru/s3-proxy/audio.mp3?sig=test');
  });

  it('первый ход (пустая история): приветствие, мозг НЕ вызывается, есть озвучка', async () => {
    const r = await runSurveyTurn({ sessionId: 's1', turnIndex: 1, history: [] });
    expect(r.replyText).toBe('GREETING_TEXT');
    expect(r.end).toBe(false);
    expect(r.audioUrl).toBe('https://svoefoto.ru/s3-proxy/audio.mp3?sig=test');
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it('ход с репликой клиента: вызывает мозг и возвращает его реплику', async () => {
    mockChatWithTools.mockResolvedValue({ text: 'Рад это слышать!', toolCalls: [] });
    const r = await runSurveyTurn({
      sessionId: 's2',
      turnIndex: 2,
      history: history(['bot', 'GREETING_TEXT'], ['client', 'Всё отлично']),
    });
    expect(mockChatWithTools).toHaveBeenCalledOnce();
    expect(r.replyText).toBe('Рад это слышать!');
    expect(r.end).toBe(false);
    expect(r.audioUrl).toBe('https://svoefoto.ru/s3-proxy/audio.mp3?sig=test');
  });

  it('достигнут лимит ходов: прощание и end=true, мозг НЕ вызывается', async () => {
    const r = await runSurveyTurn({
      sessionId: 's3',
      turnIndex: 4,
      history: history(
        ['bot', 'g'], ['client', 'a'],
        ['bot', 'r1'], ['client', 'b'],
        ['bot', 'r2'], ['client', 'c'], // 3 реплики клиента = maxTurns
      ),
    });
    expect(r.end).toBe(true);
    expect(r.replyText).toContain('Спасибо');
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it('идемпотентность по (sessionId, turnIndex): второй вызов из кэша', async () => {
    mockChatWithTools.mockResolvedValue({ text: 'Ответ', toolCalls: [] });
    const input = { sessionId: 's4', turnIndex: 2, history: history(['bot', 'g'], ['client', 'x']) };
    const r1 = await runSurveyTurn(input);
    const r2 = await runSurveyTurn(input);
    expect(r1).toEqual(r2);
    expect(mockChatWithTools).toHaveBeenCalledOnce();
  });

  it('сбой синтеза речи: audioUrl=null (фолбэк на встроенный TTS), реплика сохраняется', async () => {
    mockChatWithTools.mockResolvedValue({ text: 'Ответ мозга', toolCalls: [] });
    mockSynthesize.mockRejectedValue(new Error('tts down'));
    const r = await runSurveyTurn({
      sessionId: 's5',
      turnIndex: 2,
      history: history(['bot', 'g'], ['client', 'x']),
    });
    expect(r.audioUrl).toBeNull();
    expect(r.replyText).toBe('Ответ мозга');
  });

  it('пустой ответ мозга: запасная реплика', async () => {
    mockChatWithTools.mockResolvedValue({ text: '', toolCalls: [] });
    const r = await runSurveyTurn({
      sessionId: 's6',
      turnIndex: 2,
      history: history(['bot', 'g'], ['client', 'x']),
    });
    expect(r.replyText).toContain('Спасибо');
  });
});
