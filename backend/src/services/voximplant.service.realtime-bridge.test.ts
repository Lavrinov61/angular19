import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const { startSdkScenariosMock } = vi.hoisted(() => ({
  startSdkScenariosMock: vi.fn(),
}));

vi.mock('../config/index.js', () => ({
  config: {
    jwt: {
      secret: 'test-jwt-secret',
    },
    voximplant: {
      accountId: '1',
      apiKey: 'key',
      apiBaseUrl: 'https://api.voximplant.com/platform_api',
      enabled: true,
      serviceSurvey: {
        enabled: true,
        outboundRuleId: '42',
        callerId: '+78633226575',
        question: 'q',
        maxAnswerMs: 45_000,
        conversational: true,
        greeting: 'hello',
        maxTurns: 6,
        voiceEngine: 'grok_realtime',
        voiceModel: 'x-ai/grok-voice-tts-1.0',
        voiceName: 'Eve',
        voiceInstructions: '',
        brainModel: 'x-ai/grok-4.20',
        realtimeModel: 'grok-voice-think-fast-1.0',
        realtimeVoice: 'om17cury',
        realtimeInstructions: 'Говори по-русски.',
        realtimeBridgeUrl: 'https://svoefoto.ru/api/telephony/service-survey/realtime',
        realtimeBridgeTokenTtlMs: 60_000,
      },
    },
  },
}));

vi.mock('./voximplant-management-sdk.service.js', () => ({
  getSdkCallHistory: vi.fn(),
  isVoximplantSdkConfigured: () => true,
  startSdkScenarios: startSdkScenariosMock,
}));

vi.mock('../utils/circuit-breaker.js', () => ({
  fetchWithCB: vi.fn(),
}));

const customDataSchema = z.object({
  type: z.literal('service_survey'),
  sessionId: z.string(),
  voiceEngine: z.literal('grok_realtime'),
  realtimeBridgeUrl: z.never().optional(),
});

const sdkRequestSchema = z.object({
  ruleId: z.number(),
  scriptCustomData: z.string(),
});

let startVoximplantServiceSurveyCall: typeof import('./voximplant.service.js')['startVoximplantServiceSurveyCall'];

beforeAll(async () => {
  ({ startVoximplantServiceSurveyCall } = await import('./voximplant.service.js'));
});

beforeEach(() => {
  vi.mocked(startSdkScenariosMock).mockReset();
  vi.mocked(startSdkScenariosMock).mockResolvedValue({
    result: { started: true },
    callSessionHistoryId: 123,
  });
});

describe('startVoximplantServiceSurveyCall native Grok customData', () => {
  it('does not include a backend media bridge URL for grok_realtime calls', async () => {
    await startVoximplantServiceSurveyCall({
      destinationPhone: '89896238448',
      sessionId: 'service-survey-1',
    });

    const request = sdkRequestSchema.parse(vi.mocked(startSdkScenariosMock).mock.calls[0]?.[0]);
    const customData = customDataSchema.parse(JSON.parse(request.scriptCustomData));

    expect(customData.realtimeBridgeUrl).toBeUndefined();
  });
});
