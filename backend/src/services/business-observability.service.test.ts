import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    logger,
    requestId: 'req-123',
    businessEventInc: vi.fn(),
    businessEventLabels: vi.fn(() => ({ inc: vi.fn() })),
    businessDurationObserve: vi.fn(),
    businessDurationLabels: vi.fn(() => ({ observe: vi.fn() })),
    businessCriticalInc: vi.fn(),
    businessCriticalLabels: vi.fn(() => ({ inc: vi.fn() })),
    fetchWithTimeout: vi.fn(),
  };
});

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => mocks.logger),
}));

vi.mock('../middleware/request-context.js', () => ({
  getRequestId: () => mocks.requestId,
}));

vi.mock('./metrics.service.js', () => ({
  businessEventsTotal: {
    labels: mocks.businessEventLabels,
  },
  businessEventDurationSeconds: {
    labels: mocks.businessDurationLabels,
  },
  businessCriticalAlertsTotal: {
    labels: mocks.businessCriticalLabels,
  },
}));

vi.mock('../config/index.js', () => ({
  config: {
    telegram: {
      botToken: 'test-bot-token',
      adminChatIds: ['1001'],
      apiUrl: 'https://telegram.test',
    },
  },
}));

vi.mock('../utils/fetch-timeout.js', () => ({
  fetchWithTimeout: mocks.fetchWithTimeout,
}));

import {
  __resetBusinessObservabilityForTests,
  formatBusinessAlertText,
  recordBusinessEvent,
} from './business-observability.service.js';

describe('business-observability.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestId = 'req-123';
    mocks.businessEventInc = vi.fn();
    mocks.businessEventLabels.mockReturnValue({ inc: mocks.businessEventInc });
    mocks.businessDurationObserve = vi.fn();
    mocks.businessDurationLabels.mockReturnValue({ observe: mocks.businessDurationObserve });
    mocks.businessCriticalInc = vi.fn();
    mocks.businessCriticalLabels.mockReturnValue({ inc: mocks.businessCriticalInc });
    mocks.fetchWithTimeout.mockResolvedValue(new Response('{}', { status: 200 }));
    __resetBusinessObservabilityForTests();
  });

  it('records structured business events to logs and Prometheus without PII metadata', () => {
    recordBusinessEvent({
      domain: 'orders',
      event: 'photo_print.created',
      outcome: 'success',
      severity: 'info',
      actorId: 'employee-1',
      entityType: 'photo_print_order',
      entityId: 'order-row-1',
      orderId: 'CRM-260528-ABCD',
      chatSessionId: 'chat-session-1',
      durationMs: 1500,
      metadata: {
        source: 'crm',
        phone: '+79990001122',
        email: 'client@example.test',
        token: 'secret-token',
      },
    });

    expect(mocks.businessEventLabels).toHaveBeenCalledWith('orders', 'photo_print.created', 'success', 'info');
    expect(mocks.businessEventInc).toHaveBeenCalledOnce();
    expect(mocks.businessDurationLabels).toHaveBeenCalledWith('orders', 'photo_print.created', 'success');
    expect(mocks.businessDurationObserve).toHaveBeenCalledWith(1.5);

    expect(mocks.logger.info).toHaveBeenCalledOnce();
    const [message, payload] = mocks.logger.info.mock.calls[0] ?? [];
    expect(message).toBe('business_event');
    expect(payload).toMatchObject({
      event_type: 'business',
      domain: 'orders',
      event: 'photo_print.created',
      outcome: 'success',
      severity: 'info',
      actorId: 'employee-1',
      entityType: 'photo_print_order',
      entityId: 'order-row-1',
      orderId: 'CRM-260528-ABCD',
      chatSessionId: 'chat-session-1',
      requestId: 'req-123',
      durationMs: 1500,
      metadata: {
        source: 'crm',
      },
    });
    expect(JSON.stringify(payload)).not.toContain('+79990001122');
    expect(JSON.stringify(payload)).not.toContain('client@example.test');
    expect(JSON.stringify(payload)).not.toContain('secret-token');
  });

  it('sends critical alerts once per cooldown key and escapes alert text', async () => {
    recordBusinessEvent({
      domain: 'payments',
      event: 'cloudpayments.amount_mismatch',
      outcome: 'failure',
      severity: 'critical',
      orderId: 'CRM-260528-PAY1',
      paymentId: 'cp-1',
      error: new Error('amount < expected'),
      metadata: {
        expectedAmount: 1000,
        actualAmount: 900,
        card_pan: '4111111111111111',
      },
      alert: {
        key: 'payments:CRM-260528-PAY1:amount_mismatch',
        title: 'CloudPayments amount mismatch',
        cooldownMs: 60_000,
      },
    });

    await vi.waitFor(() => expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(1));
    expect(mocks.businessCriticalLabels).toHaveBeenCalledWith('payments', 'cloudpayments.amount_mismatch');
    expect(mocks.businessCriticalInc).toHaveBeenCalledOnce();

    const [url, options] = mocks.fetchWithTimeout.mock.calls[0] ?? [];
    expect(url).toBe('https://telegram.test/bottest-bot-token/sendMessage');
    const body = JSON.parse(String((options as RequestInit).body));
    expect(body.text).toContain('CloudPayments amount mismatch');
    expect(body.text).toContain('amount &lt; expected');
    expect(body.text).toContain('CRM-260528-PAY1');
    expect(body.text).not.toContain('4111111111111111');

    recordBusinessEvent({
      domain: 'payments',
      event: 'cloudpayments.amount_mismatch',
      outcome: 'failure',
      severity: 'critical',
      orderId: 'CRM-260528-PAY1',
      alert: {
        key: 'payments:CRM-260528-PAY1:amount_mismatch',
        title: 'CloudPayments amount mismatch',
        cooldownMs: 60_000,
      },
    });

    await new Promise(resolve => setImmediate(resolve));
    expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('formats alert text with safe business context only', () => {
    const text = formatBusinessAlertText({
      domain: 'chat',
      event: 'order.insert_failed',
      outcome: 'failure',
      severity: 'critical',
      orderId: 'chat-session-1-99',
      chatSessionId: 'session-1',
      error: 'db <down>',
      metadata: {
        reason: 'insert conflict',
        customer_phone: '+79990001122',
        password: 'secret',
      },
    }, 'Chat order insert failed');

    expect(text).toContain('Chat order insert failed');
    expect(text).toContain('db &lt;down&gt;');
    expect(text).toContain('insert conflict');
    expect(text).not.toContain('+79990001122');
    expect(text).not.toContain('secret');
  });
});
