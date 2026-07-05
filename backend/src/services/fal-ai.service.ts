/**
 * fal-ai.service.ts — Low-level wrapper for fal.ai Queue API.
 * Uses fetch() + AbortController for timeout control.
 */

import { config } from '../config/index.js';
import { withServiceCall, SERVICE_BREAKERS } from '../utils/circuit-breaker.js';

interface FalSubmitResponse {
  request_id: string;
  status_url: string;
  response_url: string;
}

export type FalQueueStatus = 'SUBMITTED' | 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface FalStatusUpdate {
  status: FalQueueStatus;
  requestId?: string;
  error?: string;
  logs?: Array<{ message: string; timestamp: string }>;
  queuePosition?: number;
}

interface FalStatusResponse {
  status: Exclude<FalQueueStatus, 'SUBMITTED'>;
  request_id?: string;
  error?: string;
  logs?: Array<{ message: string; timestamp: string }>;
  queue_position?: number;
}

interface FalRunInput {
  [key: string]: unknown;
}

interface FalRunOptions {
  timeoutMs?: number;
  onStatus?: (status: FalStatusUpdate) => void;
}

interface HeaderMap {
  [key: string]: string;
}

const FAL_FETCH_MAX_ATTEMPTS = 3;
const FAL_DOWNLOAD_MAX_ATTEMPTS = 3;
const FAL_RETRY_BASE_DELAY_MS = 350;

export interface FalResult {
  images?: Array<{ url: string; width?: number; height?: number; content_type?: string }>;
  image?: { url: string; width?: number; height?: number; content_type?: string };
  [key: string]: unknown;
}

class FalAIServiceImpl {
  private readonly apiKey: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  readonly enabled: boolean;

  constructor() {
    this.apiKey = config.fal.apiKey;
    this.enabled = config.fal.enabled;
    this.pollIntervalMs = config.fal.pollIntervalMs;
    this.timeoutMs = config.fal.timeoutMs;
  }

  async submit(modelId: string, input: FalRunInput): Promise<FalSubmitResponse> {
    this.ensureEnabled();
    return withServiceCall(SERVICE_BREAKERS.falAi, async () => {
      const res = await this.fetchFal(`https://queue.fal.run/${modelId}`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`fal.ai submit failed (${res.status}): ${text}`);
      }
      return res.json() as Promise<FalSubmitResponse>;
    });
  }

  async waitForResult(statusUrl: string, responseUrl: string, opts?: FalRunOptions): Promise<FalResult> {
    const timeout = opts?.timeoutMs ?? this.timeoutMs;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const statusRes = await this.fetchFal(statusUrl);
      if (!statusRes.ok) {
        const text = await statusRes.text();
        throw new Error(`fal.ai status check failed (${statusRes.status}): ${text}`);
      }
      const status = (await statusRes.json()) as FalStatusResponse;
      opts?.onStatus?.(toStatusUpdate(status));

      if (status.status === 'COMPLETED') {
        const resultRes = await this.fetchFal(responseUrl);
        if (!resultRes.ok) {
          const text = await resultRes.text();
          throw new Error(`fal.ai result fetch failed (${resultRes.status}): ${text}`);
        }
        return resultRes.json() as Promise<FalResult>;
      }

      if (status.status === 'FAILED') {
        throw new Error(`fal.ai job failed: ${status.error || 'unknown error'}`);
      }

      await this.sleep(this.pollIntervalMs);
    }

    throw new Error(`fal.ai job timed out after ${timeout}ms`);
  }

  async run(modelId: string, input: FalRunInput, opts?: FalRunOptions): Promise<FalResult> {
    const { request_id, status_url, response_url } = await this.submit(modelId, input);
    opts?.onStatus?.({ status: 'SUBMITTED', requestId: request_id });
    return this.waitForResult(status_url, response_url, opts);
  }

  async downloadImage(url: string): Promise<Buffer> {
    const res = await this.fetchWithRetry({
      url,
      timeoutMs: 30_000,
      maxAttempts: FAL_DOWNLOAD_MAX_ATTEMPTS,
      label: 'fal.ai image download',
    });
    if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
    return Buffer.from(await res.arrayBuffer());
  }

  private async fetchFal(url: string, init?: RequestInit): Promise<Response> {
    return this.fetchWithRetry({
      url,
      init: {
        ...init,
        headers: {
          'Authorization': `Key ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...((init?.headers as HeaderMap | undefined) || {}),
        },
      },
      timeoutMs: 60_000,
      maxAttempts: FAL_FETCH_MAX_ATTEMPTS,
      label: 'fal.ai request',
    });
  }

  private async fetchWithRetry(input: {
    url: string;
    init?: RequestInit;
    timeoutMs: number;
    maxAttempts: number;
    label: string;
  }): Promise<Response> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), input.timeoutMs);
      try {
        const response = await fetch(input.url, {
          ...input.init,
          signal: ctrl.signal,
        });
        if (!isRetryableStatus(response.status) || attempt === input.maxAttempts) {
          return response;
        }
      } catch (err: unknown) {
        lastError = err;
        if (attempt === input.maxAttempts) {
          throw new Error(`${input.label} failed after ${attempt} attempts: ${errorMessage(err)}`);
        }
      } finally {
        clearTimeout(timer);
      }

      await this.sleep(FAL_RETRY_BASE_DELAY_MS * attempt);
    }

    throw new Error(`${input.label} failed: ${errorMessage(lastError)}`);
  }

  private ensureEnabled(): void {
    if (!this.enabled) throw new Error('fal.ai is not configured (FAL_API_KEY missing)');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function toStatusUpdate(status: FalStatusResponse): FalStatusUpdate {
  return {
    status: status.status,
    ...(status.request_id ? { requestId: status.request_id } : {}),
    ...(status.error ? { error: status.error } : {}),
    ...(status.logs ? { logs: status.logs } : {}),
    ...(typeof status.queue_position === 'number' ? { queuePosition: status.queue_position } : {}),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export const falAIService = new FalAIServiceImpl();
