import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const { fetchWithTimeoutMock } = vi.hoisted(() => ({
  fetchWithTimeoutMock: vi.fn(),
}));

vi.mock('../config/index.js', () => ({
  config: {
    openai: {
      apiKey: 'test-openai-key',
      baseUrl: 'https://api.openai.com',
      enabled: true,
      realtime: {
        model: 'gpt-realtime',
        voice: 'alloy',
        tokenTtlSeconds: 600,
        timeoutMs: 15000,
      },
    },
  },
}));

vi.mock('../utils/fetch-timeout.js', () => ({
  fetchWithTimeout: fetchWithTimeoutMock,
}));

let createOpenAiRealtimeClientSecret: typeof import('./openai-realtime.service.js')['createOpenAiRealtimeClientSecret'];

const requestBodySchema = z.object({
  expires_after: z.object({
    anchor: z.string(),
    seconds: z.number().int(),
  }),
  session: z.object({
    type: z.string(),
    model: z.string(),
    instructions: z.string(),
    audio: z.object({
      output: z.object({
        voice: z.string(),
      }),
    }),
  }),
});

beforeAll(async () => {
  ({ createOpenAiRealtimeClientSecret } = await import('./openai-realtime.service.js'));
});

beforeEach(() => {
  vi.mocked(fetchWithTimeoutMock).mockReset();
});

describe('createOpenAiRealtimeClientSecret', () => {
  it('creates a client secret with configured defaults', async () => {
    vi.mocked(fetchWithTimeoutMock).mockResolvedValue(
      new Response(JSON.stringify({
        value: 'ek_test',
        expires_at: 1_800_000_000,
        session: {
          id: 'sess_1',
          object: 'realtime.session',
          type: 'realtime',
          model: 'gpt-realtime',
          output_modalities: ['audio'],
          audio: {
            output: {
              voice: 'alloy',
            },
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await createOpenAiRealtimeClientSecret({
      instructions: 'Keep answers short.',
    });

    expect(result.value).toBe('ek_test');
    expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(1);
    expect(fetchWithTimeoutMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/realtime/client_secrets',
      expect.objectContaining({
        method: 'POST',
        timeout: 15000,
        headers: {
          'Authorization': 'Bearer test-openai-key',
          'Content-Type': 'application/json',
        },
      }),
    );

    const rawRequestBody = vi.mocked(fetchWithTimeoutMock).mock.calls[0]?.[1]?.body;
    const requestBody = requestBodySchema.parse(JSON.parse(String(rawRequestBody)));

    expect(requestBody).toEqual({
      expires_after: {
        anchor: 'created_at',
        seconds: 600,
      },
      session: {
        type: 'realtime',
        model: 'gpt-realtime',
        instructions: 'Keep answers short.',
        audio: {
          output: {
            voice: 'alloy',
          },
        },
      },
    });
  });

  it('surfaces upstream request failures as AppError', async () => {
    vi.mocked(fetchWithTimeoutMock).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'bad request' } }), {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(createOpenAiRealtimeClientSecret()).rejects.toMatchObject({
      statusCode: 502,
      code: 'OPENAI_REALTIME_REQUEST_FAILED',
    });
  });
});
