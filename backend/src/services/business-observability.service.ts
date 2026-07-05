import { config } from '../config/index.js';
import { getRequestId } from '../middleware/request-context.js';
import { fetchWithTimeout } from '../utils/fetch-timeout.js';
import { createLogger } from '../utils/logger.js';
import {
  businessCriticalAlertsTotal,
  businessEventDurationSeconds,
  businessEventsTotal,
} from './metrics.service.js';

const log = createLogger('business-observability');
const DEFAULT_ALERT_COOLDOWN_MS = 15 * 60 * 1000;
const MAX_METADATA_KEYS = 20;
const MAX_METADATA_DEPTH = 3;
const MAX_STRING_LENGTH = 500;

const sensitiveKeyPattern = /(authorization|cookie|token|secret|password|passwd|session_cookie|email|mail|phone|visitor_name|customer_name|client_name|card|pan|cvv|cvc|passport|address|ip)$/i;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phonePattern = /(?:\+?\d[\d\s().-]{8,}\d)/g;
const longNumberPattern = /\b\d{13,19}\b/g;

const lastAlertTimes = new Map<string, number>();

export type BusinessEventSeverity = 'debug' | 'info' | 'warn' | 'error' | 'critical';
export type BusinessEventOutcome = 'started' | 'success' | 'failure' | 'skipped' | 'duplicate' | 'recovered';

export interface BusinessAlertOptions {
  readonly key?: string;
  readonly title?: string;
  readonly cooldownMs?: number;
}

export interface BusinessObservabilityEvent {
  readonly domain: string;
  readonly event: string;
  readonly outcome: BusinessEventOutcome;
  readonly severity?: BusinessEventSeverity;
  readonly actorId?: string | null;
  readonly entityType?: string | null;
  readonly entityId?: string | null;
  readonly orderId?: string | null;
  readonly chatSessionId?: string | null;
  readonly paymentId?: string | null;
  readonly requestId?: string | null;
  readonly durationMs?: number | null;
  readonly error?: unknown;
  readonly metadata?: Record<string, unknown> | null;
  readonly alert?: boolean | BusinessAlertOptions;
}

export interface BusinessLogPayload extends Record<string, unknown> {
  event_type: 'business';
  domain: string;
  event: string;
  outcome: BusinessEventOutcome;
  severity: BusinessEventSeverity;
  actorId?: string;
  entityType?: string;
  entityId?: string;
  orderId?: string;
  chatSessionId?: string;
  paymentId?: string;
  requestId?: string;
  durationMs?: number;
  error?: string;
  errorName?: string;
  metadata?: Record<string, unknown>;
}

type BusinessStringField = 'actorId' | 'entityType' | 'entityId' | 'orderId' | 'chatSessionId' | 'paymentId' | 'requestId';

export function recordBusinessEvent(event: BusinessObservabilityEvent): void {
  let payload: BusinessLogPayload;
  try {
    payload = buildBusinessLogPayload(event);
  } catch (err) {
    safeInternalError('business_observability_payload_failed', err);
    return;
  }

  try {
    businessEventsTotal
      .labels(payload.domain, payload.event, payload.outcome, payload.severity)
      .inc();
    if (typeof payload.durationMs === 'number' && Number.isFinite(payload.durationMs) && payload.durationMs >= 0) {
      businessEventDurationSeconds
        .labels(payload.domain, payload.event, payload.outcome)
        .observe(payload.durationMs / 1000);
    }
  } catch (err) {
    safeInternalError('business_observability_metrics_failed', err, payload);
  }

  try {
    writeBusinessLog(payload);
  } catch (err) {
    safeInternalError('business_observability_log_failed', err);
  }

  if (event.alert || payload.severity === 'critical') {
    void dispatchBusinessAlert(event, payload).catch(err => {
      safeInternalError('business_alert_dispatch_failed', err, payload);
    });
  }
}

export function buildBusinessLogPayload(event: BusinessObservabilityEvent): BusinessLogPayload {
  const severity = event.severity ?? defaultSeverityForOutcome(event.outcome);
  const payload: BusinessLogPayload = {
    event_type: 'business',
    domain: event.domain,
    event: event.event,
    outcome: event.outcome,
    severity,
  };

  setString(payload, 'actorId', event.actorId);
  setString(payload, 'entityType', event.entityType);
  setString(payload, 'entityId', event.entityId);
  setString(payload, 'orderId', event.orderId);
  setString(payload, 'chatSessionId', event.chatSessionId);
  setString(payload, 'paymentId', event.paymentId);
  setString(payload, 'requestId', event.requestId ?? getRequestId());

  if (typeof event.durationMs === 'number' && Number.isFinite(event.durationMs) && event.durationMs >= 0) {
    payload.durationMs = event.durationMs;
  }

  const errorInfo = toErrorInfo(event.error);
  if (errorInfo.message) {
    payload.error = errorInfo.message;
  }
  if (errorInfo.name) {
    payload.errorName = errorInfo.name;
  }

  const metadata = sanitizeMetadata(event.metadata);
  if (metadata && Object.keys(metadata).length > 0) {
    payload.metadata = metadata;
  }

  return payload;
}

export function formatBusinessAlertText(
  event: BusinessObservabilityEvent,
  title = 'Business critical event',
): string {
  const payload = buildBusinessLogPayload(event);
  const lines = [
    `<b>${escapeHtml(title)}</b>`,
    `domain: <code>${escapeHtml(payload.domain)}</code>`,
    `event: <code>${escapeHtml(payload.event)}</code>`,
    `outcome: <code>${escapeHtml(payload.outcome)}</code>`,
    `severity: <code>${escapeHtml(payload.severity)}</code>`,
  ];

  appendLine(lines, 'orderId', payload.orderId);
  appendLine(lines, 'entityId', payload.entityId);
  appendLine(lines, 'chatSessionId', payload.chatSessionId);
  appendLine(lines, 'paymentId', payload.paymentId);
  appendLine(lines, 'requestId', payload.requestId);
  appendLine(lines, 'error', payload.error);

  if (payload.metadata && Object.keys(payload.metadata).length > 0) {
    lines.push(`metadata: <code>${escapeHtml(JSON.stringify(payload.metadata))}</code>`);
  }

  return lines.join('\n');
}

export function __resetBusinessObservabilityForTests(): void {
  lastAlertTimes.clear();
}

function defaultSeverityForOutcome(outcome: BusinessEventOutcome): BusinessEventSeverity {
  if (outcome === 'failure') return 'error';
  if (outcome === 'skipped' || outcome === 'duplicate') return 'warn';
  return 'info';
}

function setString(target: BusinessLogPayload, key: BusinessStringField, value: string | null | undefined): void {
  if (typeof value === 'string' && value.trim()) {
    target[key] = sanitizeFreeText(value.trim());
  }
}

function toErrorInfo(error: unknown): { message?: string; name?: string } {
  if (!error) return {};
  if (error instanceof Error) {
    return {
      message: sanitizeFreeText(error.message),
      name: sanitizeFreeText(error.name),
    };
  }
  if (typeof error === 'string') {
    return { message: sanitizeFreeText(error) };
  }
  return { message: sanitizeFreeText(String(error)) };
}

function sanitizeMetadata(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata).slice(0, MAX_METADATA_KEYS)) {
    if (sensitiveKeyPattern.test(key)) continue;
    const safeValue = sanitizeMetadataValue(value, 0);
    if (safeValue !== undefined) {
      sanitized[key] = safeValue;
    }
  }
  return sanitized;
}

function sanitizeMetadataValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (depth >= MAX_METADATA_DEPTH) return '[truncated]';

  if (typeof value === 'string') {
    return sanitizeFreeText(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.slice(0, 10).map(item => sanitizeMetadataValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>).slice(0, MAX_METADATA_KEYS)) {
      if (sensitiveKeyPattern.test(key)) continue;
      const safeValue = sanitizeMetadataValue(nestedValue, depth + 1);
      if (safeValue !== undefined) {
        out[key] = safeValue;
      }
    }
    return out;
  }
  return sanitizeFreeText(String(value));
}

function sanitizeFreeText(value: string): string {
  return value
    .replace(emailPattern, '[redacted_email]')
    .replace(longNumberPattern, '[redacted_number]')
    .replace(phonePattern, '[redacted_phone]')
    .slice(0, MAX_STRING_LENGTH);
}

function writeBusinessLog(payload: BusinessLogPayload): void {
  if (payload.severity === 'critical' || payload.severity === 'error') {
    log.error('business_event', payload);
    return;
  }
  if (payload.severity === 'warn') {
    log.warn('business_event', payload);
    return;
  }
  if (payload.severity === 'debug') {
    log.debug('business_event', payload);
    return;
  }
  log.info('business_event', payload);
}

async function dispatchBusinessAlert(
  event: BusinessObservabilityEvent,
  payload: BusinessLogPayload,
): Promise<void> {
  const options = resolveAlertOptions(event.alert);
  const key = options.key ?? `${payload.domain}:${payload.event}:${payload.orderId ?? payload.entityId ?? payload.paymentId ?? 'global'}`;
  const cooldownMs = options.cooldownMs ?? DEFAULT_ALERT_COOLDOWN_MS;
  const now = Date.now();
  const lastSent = lastAlertTimes.get(key) ?? 0;
  if (now - lastSent < cooldownMs) return;
  lastAlertTimes.set(key, now);

  businessCriticalAlertsTotal.labels(payload.domain, payload.event).inc();

  if (!config.telegram.botToken || config.telegram.adminChatIds.length === 0) {
    log.warn('business_alert_skipped_no_telegram_config', { key, domain: payload.domain, event: payload.event });
    return;
  }

  const text = formatBusinessAlertText(event, options.title);
  for (let i = 0; i < config.telegram.adminChatIds.length; i += 1) {
    try {
      await fetchWithTimeout(`${config.telegram.apiUrl}/bot${config.telegram.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.telegram.adminChatIds[i],
          text: `<b>Business Alert</b>\n\n${text}`,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        timeout: 10_000,
      });
    } catch (err) {
      safeInternalError('business_alert_send_failed', err, payload);
    }
  }
}

function resolveAlertOptions(alert: boolean | BusinessAlertOptions | undefined): BusinessAlertOptions {
  if (!alert || alert === true) return {};
  return alert;
}

function appendLine(lines: string[], key: string, value: string | undefined): void {
  if (!value) return;
  lines.push(`${key}: <code>${escapeHtml(value)}</code>`);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeInternalError(message: string, error: unknown, payload?: BusinessLogPayload): void {
  try {
    log.error(message, {
      message,
      domain: payload?.domain,
      event: payload?.event,
      error: toErrorInfo(error).message,
    });
  } catch {
    // Observability must never break the business flow.
  }
}
