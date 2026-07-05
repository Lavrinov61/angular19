import { z } from 'zod';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { fetchWithTimeout } from '../utils/fetch-timeout.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('openai-realtime');

const outputModalitySchema = z.enum(['audio', 'text']);

const clientSecretResponseSchema = z.object({
  value: z.string().min(1),
  expires_at: z.number().int(),
  session: z.object({
    id: z.string().min(1),
    object: z.string().min(1),
    type: z.string().min(1),
    model: z.string().min(1),
    instructions: z.string().nullable().optional(),
    output_modalities: z.array(outputModalitySchema).nullable().optional(),
    audio: z.object({
      output: z.object({
        voice: z.string().nullable().optional(),
      }).partial().optional(),
    }).partial().nullable().optional(),
  }).passthrough(),
});

export type OpenAiRealtimeOutputModality = z.infer<typeof outputModalitySchema>;

export interface CreateOpenAiRealtimeClientSecretInput {
  model?: string;
  voice?: string;
  instructions?: string;
  outputModalities?: OpenAiRealtimeOutputModality[];
  ttlSeconds?: number;
}

export type OpenAiRealtimeClientSecret = z.infer<typeof clientSecretResponseSchema>;

interface OpenAiClientSecretRequest {
  expires_after?: {
    anchor: 'created_at';
    seconds: number;
  };
  session: {
    type: 'realtime';
    model: string;
    instructions?: string;
    output_modalities?: OpenAiRealtimeOutputModality[];
    audio?: {
      output: {
        voice: string;
      };
    };
  };
}

function buildRealtimeClientSecretsUrl(): string {
  const baseUrl = config.openai.baseUrl.replace(/\/+$/, '');
  return `${baseUrl}/v1/realtime/client_secrets`;
}

function buildRequestBody(input: CreateOpenAiRealtimeClientSecretInput): OpenAiClientSecretRequest {
  const ttlSeconds = input.ttlSeconds ?? config.openai.realtime.tokenTtlSeconds;
  const model = input.model ?? config.openai.realtime.model;
  const voice = input.voice ?? config.openai.realtime.voice;

  const requestBody: OpenAiClientSecretRequest = {
    session: {
      type: 'realtime',
      model,
    },
  };

  if (ttlSeconds > 0) {
    requestBody.expires_after = {
      anchor: 'created_at',
      seconds: ttlSeconds,
    };
  }

  if (input.instructions) {
    requestBody.session.instructions = input.instructions;
  }

  if (input.outputModalities && input.outputModalities.length > 0) {
    requestBody.session.output_modalities = input.outputModalities;
  }

  if (voice) {
    requestBody.session.audio = {
      output: {
        voice,
      },
    };
  }

  return requestBody;
}

function ensureConfigured(): void {
  if (!config.openai.enabled || !config.openai.apiKey) {
    throw new AppError(503, 'OpenAI Realtime is not configured', 'OPENAI_REALTIME_NOT_CONFIGURED');
  }
}

export async function createOpenAiRealtimeClientSecret(
  input: CreateOpenAiRealtimeClientSecretInput = {},
): Promise<OpenAiRealtimeClientSecret> {
  ensureConfigured();

  const response = await fetchWithTimeout(buildRealtimeClientSecretsUrl(), {
    method: 'POST',
    timeout: config.openai.realtime.timeoutMs,
    headers: {
      'Authorization': `Bearer ${config.openai.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildRequestBody(input)),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    logger.error('OpenAI Realtime client secret request failed', {
      status: response.status,
      statusText: response.statusText,
      error: errorText.slice(0, 400),
    });
    throw new AppError(502, 'OpenAI Realtime token request failed', 'OPENAI_REALTIME_REQUEST_FAILED');
  }

  const rawResponse: unknown = await response.json();
  const parsedResponse = clientSecretResponseSchema.safeParse(rawResponse);

  if (!parsedResponse.success) {
    logger.error('OpenAI Realtime client secret response validation failed', {
      issues: parsedResponse.error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    throw new AppError(502, 'OpenAI Realtime returned an invalid response', 'OPENAI_REALTIME_INVALID_RESPONSE');
  }

  return parsedResponse.data;
}
