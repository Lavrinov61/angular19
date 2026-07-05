import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CircuitBreakerStatus {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures: number;
  lastError: string | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
}

export interface ChannelDayMetrics {
  sent: number;
  received: number;
  delivered: number;
  failed: number;
  avgDeliveryMs: number;
}

export type HealthLevel = 'healthy' | 'degraded' | 'down' | 'idle';

export interface WebhookFreshnessSignal {
  lastReceivedAt: string | null;
  total24h: number;
  errors24h: number;
  errorRate: number;
}

export interface InboundHealthSignal {
  lastReceivedAt: string | null;
  lastProcessedAt: string | null;
  lastMessageAt: string | null;
  received24h: number;
  processed24h: number;
  processedMessages24h: number;
  failed24h: number;
  skipped24h: number;
  errorRate: number;
  lastError: string | null;
}

export interface QueueHealthSignal {
  pendingCount: number;
  failedCount: number;
  deadLetterCount: number;
  oldestPendingAgeSeconds: number | null;
}

export interface QueueCountsSignal {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

export interface PipelineQueuesSignal {
  inbound: QueueCountsSignal;
  status: QueueCountsSignal;
  outbound: QueueCountsSignal;
  media: QueueCountsSignal;
  mediaDlq: QueueCountsSignal;
  avScan: QueueCountsSignal;
}

export interface TokenHealthSignal {
  accountName: string;
  tokenExpiresAt: string | null;
  tokenRefreshedAt: string | null;
  daysUntilExpiry: number | null;
  lastHealthCheckAt: string | null;
  healthCheckOk: boolean | null;
  healthCheckError: string | null;
}

export interface TelegramBotApiSignal {
  mode: 'polling' | 'webhook';
  getMeOk: boolean | null;
  botUsername: string | null;
  pendingUpdateCount: number | null;
  webhookUrl: string | null;
  webhookUrlSet: boolean;
  expectedWebhookUrl: string | null;
  lastError: string | null;
  checkedAt: string | null;
}

export interface ClamAvSignal {
  available: boolean;
  mode: 'clamdscan' | 'clamscan' | 'unavailable';
  error: string | null;
  checkedAt: string;
}

export interface MediaHealthSignal {
  total24h: number;
  failed24h: number;
  avPendingCount: number;
  avError24h: number;
  avInfected24h: number;
  clamAv: ClamAvSignal;
}

export interface ChannelHealthDetail {
  channel: string;
  health: HealthLevel;
  connectorEnabled: boolean;
  disabled: boolean;
  circuitBreaker: CircuitBreakerStatus;
  webhook: WebhookFreshnessSignal;
  inbound: InboundHealthSignal;
  queue: QueueHealthSignal;
  queues: PipelineQueuesSignal;
  token: TokenHealthSignal | null;
  telegram: TelegramBotApiSignal | null;
  media: MediaHealthSignal;
  summary: string;
}

export interface ChannelStatus {
  channel: string;
  connectorEnabled: boolean;
  disabled: boolean;
  health: HealthLevel;
  summary: string;
  circuitBreaker: CircuitBreakerStatus;
  queueDepth: number;
  inbound: InboundHealthSignal | null;
  queues: PipelineQueuesSignal | null;
  telegram: TelegramBotApiSignal | null;
  media: MediaHealthSignal | null;
  metrics24h: ChannelDayMetrics;
}

export interface ChannelDetailedStats {
  channel: string;
  days: { date: string; metrics: ChannelDayMetrics }[];
  recentErrors: { id: string; content: string; last_error: string; attempts: number; created_at: string }[];
}

export interface DeadLetterMessage {
  id: string;
  channel: string;
  content: string;
  last_error: string;
  attempts: number;
  created_at: string;
  session_id: string;
  external_chat_id: string;
  message_type: string;
  attachment_url: string | null;
  source_message_id: string;
}

export interface DeadLetterResponse {
  success: boolean;
  data: DeadLetterMessage[];
  pagination: { page: number; limit: number; total: number };
}

@Injectable({ providedIn: 'root' })
export class ChannelAdminApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/admin/channels';

  getChannels(): Observable<{ success: boolean; data: ChannelStatus[] }> {
    return this.http.get<{ success: boolean; data: ChannelStatus[] }>(this.base);
  }

  getChannelStats(channel: string): Observable<{ success: boolean; data: ChannelDetailedStats }> {
    return this.http.get<{ success: boolean; data: ChannelDetailedStats }>(`${this.base}/${channel}/stats`);
  }

  toggleChannel(channel: string, enabled: boolean): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.base}/${channel}/toggle`, { enabled });
  }

  getDeadLetters(params: { page?: number; limit?: number; channel?: string }): Observable<DeadLetterResponse> {
    const qp = new URLSearchParams();
    if (params.page) qp.set('page', String(params.page));
    if (params.limit) qp.set('limit', String(params.limit));
    if (params.channel) qp.set('channel', params.channel);
    return this.http.get<DeadLetterResponse>(`${this.base}/dead-letters?${qp}`);
  }

  retryDeadLetter(id: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.base}/dead-letters/${id}/retry`, {});
  }

  retryDeadLettersBatch(filter: { channel?: string; limit?: number }): Observable<{ success: boolean; data: { retried: number } }> {
    return this.http.post<{ success: boolean; data: { retried: number } }>(`${this.base}/dead-letters/retry-batch`, filter);
  }

  getChannelHealth(channel: string): Observable<{ success: boolean; data: ChannelHealthDetail }> {
    return this.http.get<{ success: boolean; data: ChannelHealthDetail }>(`${this.base}/${channel}/health`);
  }

  getHealth(): Observable<{ success: boolean; status: string; channels: Record<string, unknown> }> {
    return this.http.get<{ success: boolean; status: string; channels: Record<string, unknown> }>(`${this.base}/health`);
  }
}
