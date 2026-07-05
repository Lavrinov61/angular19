import { describe, it, expect, beforeEach } from 'vitest';
import {
  getMetrics,
  getContentType,
  getMetricsRegistry,
  httpRequestDuration,
  httpRequestsTotal,
  dbQueryDuration,
  dbQueryErrors,
  bullmqQueueDepth,
  wsConnectedClients,
  businessEventsTotal,
  businessEventDurationSeconds,
  businessCriticalAlertsTotal,
} from './metrics.service.js';

describe('MetricsService', () => {
  beforeEach(() => {
    // Reset all metrics before each test
    getMetricsRegistry().resetMetrics();
  });

  it('getMetrics() returns Prometheus text format', async () => {
    const output = await getMetrics();
    expect(typeof output).toBe('string');
    // Should contain default Node.js metrics
    expect(output).toContain('node_');
    // Should contain app label
    expect(output).toContain('magnus-photo-api');
  });

  it('getContentType() returns Prometheus content type', () => {
    const ct = getContentType();
    expect(ct).toContain('text/plain');
  });

  it('httpRequestDuration records observations', async () => {
    httpRequestDuration.observe({ method: 'GET', route: '/api/health', status_code: '200' }, 0.05);
    httpRequestDuration.observe({ method: 'POST', route: '/api/orders', status_code: '201' }, 0.15);

    const output = await getMetrics();
    expect(output).toContain('http_request_duration_seconds');
    expect(output).toContain('/api/health');
  });

  it('httpRequestsTotal increments', async () => {
    httpRequestsTotal.inc({ method: 'GET', route: '/api/health', status_code: '200' });
    httpRequestsTotal.inc({ method: 'GET', route: '/api/health', status_code: '200' });

    const output = await getMetrics();
    expect(output).toContain('http_requests_total');
  });

  it('dbQueryDuration records observations', async () => {
    dbQueryDuration.observe({ operation: 'SELECT' }, 0.01);
    dbQueryDuration.observe({ operation: 'INSERT' }, 0.025);

    const output = await getMetrics();
    expect(output).toContain('db_query_duration_seconds');
  });

  it('dbQueryErrors increments', async () => {
    dbQueryErrors.inc();
    dbQueryErrors.inc();

    const output = await getMetrics();
    expect(output).toContain('db_query_errors_total');
  });

  it('bullmqQueueDepth sets gauge values', async () => {
    bullmqQueueDepth.set({ queue: 'outbound-telegram', state: 'waiting' }, 5);
    bullmqQueueDepth.set({ queue: 'outbound-telegram', state: 'failed' }, 2);

    const output = await getMetrics();
    expect(output).toContain('bullmq_queue_depth');
    expect(output).toContain('outbound-telegram');
  });

  it('wsConnectedClients sets gauge', async () => {
    wsConnectedClients.set(42);

    const output = await getMetrics();
    expect(output).toContain('ws_connected_clients');
    expect(output).toContain('42');
  });

  it('business observability metrics expose low-cardinality labels', async () => {
    businessEventsTotal.labels('orders', 'photo_print.created', 'success', 'info').inc();
    businessEventDurationSeconds.labels('orders', 'photo_print.created', 'success').observe(0.25);
    businessCriticalAlertsTotal.labels('payments', 'cloudpayments.amount_mismatch').inc();

    const output = await getMetrics();
    expect(output).toContain('business_events_total');
    expect(output).toContain('business_event_duration_seconds');
    expect(output).toContain('business_critical_alerts_total');
    expect(output).toContain('photo_print.created');
    expect(output).not.toContain('CRM-');
  });
});
