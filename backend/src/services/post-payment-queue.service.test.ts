import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock BullMQ ─────────────────────────────────────────────────────────────

const { mockAddBulk, mockGetJobCounts, mockClose, capturedProcessor } = vi.hoisted(() => ({
  mockAddBulk: vi.fn().mockResolvedValue([]),
  mockGetJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0, delayed: 0, failed: 0 }),
  mockClose: vi.fn().mockResolvedValue(undefined),
  // Захват процессора воркера (2-й аргумент конструктора Worker) — чтобы прогонять job напрямую.
  capturedProcessor: { fn: null as null | ((job: { name: string; data: unknown }) => Promise<unknown>) },
}));

vi.mock('bullmq', () => {
  function MockQueue() {
    return { addBulk: mockAddBulk, getJobCounts: mockGetJobCounts, name: 'order-post-payment' };
  }
  function MockWorker(_name: string, processor: (job: { name: string; data: unknown }) => Promise<unknown>) {
    capturedProcessor.fn = processor;
    return { on: vi.fn(), close: mockClose };
  }
  return { Queue: MockQueue, Worker: MockWorker };
});

// ─── Mock dependencies ───────────────────────────────────────────────────────

vi.mock('../config/index.js', () => ({
  config: {
    redis: { host: 'localhost', port: 6379, password: '', tls: undefined },
    bridge: { url: 'http://localhost:5052' },
  },
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../database/db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    queryOne: vi.fn().mockResolvedValue(null),
  },
}));

const { mockAutomateOrderShipping } = vi.hoisted(() => ({
  mockAutomateOrderShipping: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./payment.service.js', () => ({
  confirmPartnerReferral: vi.fn().mockResolvedValue(undefined),
  findCustomerAndRecord: vi.fn().mockResolvedValue(undefined),
  createCrmTask: vi.fn().mockResolvedValue(undefined),
  scheduleReview: vi.fn().mockResolvedValue(undefined),
  sendBridgeAttribution: vi.fn().mockResolvedValue(undefined),
  processPhotoPrintOrder: vi.fn().mockResolvedValue(undefined),
  automateOrderShipping: mockAutomateOrderShipping,
  awardOrderPoints: vi.fn().mockResolvedValue(undefined),
  sendPaymentEmailConfirmation: vi.fn().mockResolvedValue(undefined),
  createPaymentPushNotification: vi.fn().mockResolvedValue(undefined),
  saveCardToken: vi.fn().mockResolvedValue(undefined),
  notifyChatOrderPaidService: vi.fn().mockResolvedValue(undefined),
  getOrderUserId: vi.fn().mockResolvedValue(null),
}));

// Развилка доставки в job 'shipping' (S4): мок Яндекс-claim для проверки выбора провайдера.
const { mockCreateYandexClaim } = vi.hoisted(() => ({
  mockCreateYandexClaim: vi.fn().mockResolvedValue({ created: true, claimId: 'claim-1' }),
}));
vi.mock('./delivery/yandex-delivery.service.js', () => ({
  createYandexClaim: mockCreateYandexClaim,
}));

// Прочие зависимости процессора воркера (не относятся к развилке shipping, но импортируются модулем).
vi.mock('./photo-worker-queue.js', () => ({
  enqueuePhotoProcessing: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../utils/error-tracker.js', () => ({
  captureException: vi.fn(),
}));
vi.mock('../utils/circuit-breaker.js', () => ({
  fetchWithCB: vi.fn(),
  SERVICE_BREAKERS: { cloudpayments: {} },
}));
vi.mock('../middleware/request-context.js', () => ({
  getRequestId: vi.fn().mockReturnValue('req-test'),
  runWithRequestId: vi.fn(<T>(_id: string | undefined, fn: () => Promise<T>) => fn()),
}));

import {
  enqueuePostPaymentJobs,
  startPostPaymentWorker,
  type OrderPaymentData,
} from './post-payment-queue.service.js';

// ─── Test data ───────────────────────────────────────────────────────────────

interface EnqueuedJob {
  name: string;
  data?: unknown;
  opts: {
    attempts?: number;
  };
}

function normalizeEnqueuedJob(value: unknown): EnqueuedJob | null {
  if (typeof value !== 'object' || value === null) return null;
  if (!('name' in value) || typeof value.name !== 'string') return null;

  const rawOpts = 'opts' in value && typeof value.opts === 'object' && value.opts !== null
    ? value.opts
    : null;
  const attempts = rawOpts && 'attempts' in rawOpts && typeof rawOpts.attempts === 'number'
    ? rawOpts.attempts
    : undefined;

  return {
    name: value.name,
    data: 'data' in value ? value.data : undefined,
    opts: { attempts },
  };
}

function enqueuedJobs(): EnqueuedJob[] {
  const firstCall = mockAddBulk.mock.calls[0];
  const payload = firstCall?.[0];
  if (!Array.isArray(payload)) return [];
  return payload.map(normalizeEnqueuedJob).filter((job): job is EnqueuedJob => job !== null);
}

function makePaymentData(overrides: Partial<OrderPaymentData> = {}): OrderPaymentData {
  return {
    orderId: 'SF-20260310-001',
    orderDbId: '123',
    amount: 1500,
    cardInfo: '424242****4242 (Visa)',
    payerEmail: 'test@example.com',
    transactionId: '999888',
    contactName: 'Иван Иванов',
    contactPhone: '+79014178668',
    contactEmail: 'test@example.com',
    chatSessionId: null,
    isChatOrder: false,
    items: [{ format: '10x15', paperType: 'glossy', quantity: 5 }],
    serviceName: 'Печать фото',
    priority: 'normal',
    deliveryMethod: null,
    deliveryAddress: null,
    deliveryProvider: null,
    partnerPromoCode: null,
    mode: 'simple',
    totalPrice: 1500,
    telegramUserId: null,
    telegramUsername: null,
    orderData: {
      id: '123' as import('../types/generated/public/PhotoPrintOrders.js').PhotoPrintOrdersId,
      order_id: 'SF-20260310-001', mode: 'simple',
      contact_name: 'Иван Иванов', contact_phone: '+79014178668',
      contact_email: 'test@example.com', comments: null, total_price: '1500',
      items: [], status: 'processing', priority: 'normal',
      processed_by: null, processed_at: null, completed_at: null,
      assigned_employee_id: null, assigned_at: null, queue_position: null,
      estimated_ready_at: null, processing_started_at: null, processing_duration_minutes: null,
      payment_status: 'paid', payment_id: '999888', payment_amount: '1500',
      paid_at: new Date().toISOString(), receipt_url: null, payment_card_info: '424242****4242 (Visa)',
      paid_amount: '1500', payment_mode: 'full', payment_reminder_sent: false, payment_reminder_count: 0, fail_reason: null,
      delivery_cost: '0', delivery_address: null, delivery_postal_code: null,
      delivery_method: 'electronic', tracking_number: null, shipment_id: null,
      shipment_status: 'none', label_url: null, shipment_created_at: null,
      shipment_weight_grams: null, customer_id: null, service_type: null,
      chat_session_id: null, telegram_user_id: null, telegram_username: null,
      promo_code: null, promo_discount: '0', partner_promo_code: null,
      uniform_type: null, photo_format: null,
      reminder_sent_at: null, final_reminder_sent_at: null,
      source: 'online', description: null, campaign_id: null, deadline_at: null, tip_amount: '0',
      document_template_id: null, photo_size: null, medals_required: false,
      medals_description: null, wishes: null, employee_reminder: null,
      reminder_ab_variant: null, initiated_by: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
    token: null,
    cardFirstSix: null,
    cardLastFour: null,
    cardType: null,
    cardExpDate: null,
    receiptUrl: null,
    createdAt: '2026-03-10T12:00:00Z',
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('enqueuePostPaymentJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueues base jobs for a simple print order', async () => {
    const data = makePaymentData();
    await enqueuePostPaymentJobs(data);

    expect(mockAddBulk).toHaveBeenCalledOnce();
    const jobs = enqueuedJobs();
    const names = jobs.map(j => j.name);

    // Always present
    expect(names).toContain('customer-stats');
    expect(names).toContain('loyalty-points');
    expect(names).toContain('push-notification');

    // Print order → CRM task + photo-processing
    expect(names).toContain('crm-task');
    expect(names).toContain('photo-processing');

    // Email present (payerEmail set)
    expect(names).toContain('email-confirmation');

    // Chat-specific should NOT be present
    expect(names).not.toContain('chat-notification');
    expect(names).not.toContain('review-schedule');
    expect(names).not.toContain('attribution');

    // No partner promo
    expect(names).not.toContain('partner-confirm');
    // No delivery
    expect(names).not.toContain('shipping');
    // No card token
    expect(names).not.toContain('save-card');
  });

  it('enqueues chat-specific jobs for chat orders', async () => {
    const data = makePaymentData({
      isChatOrder: true,
      chatSessionId: 'session-abc',
    });
    await enqueuePostPaymentJobs(data);

    const jobs = enqueuedJobs();
    const names = jobs.map(j => j.name);

    expect(names).toContain('chat-notification');
    expect(names).toContain('crm-task');
    expect(names).toContain('review-schedule');
    expect(names).toContain('attribution');

    // No photo-processing for chat orders
    expect(names).not.toContain('photo-processing');
  });

  it('enqueues partner-confirm when promo code present', async () => {
    const data = makePaymentData({ partnerPromoCode: 'PARTNER10' });
    await enqueuePostPaymentJobs(data);

    const jobs = enqueuedJobs();
    const names = jobs.map(j => j.name);
    expect(names).toContain('partner-confirm');
  });

  it('enqueues shipping when non-pickup delivery address present', async () => {
    const data = makePaymentData({ deliveryMethod: 'postal', deliveryAddress: 'ул. Соборная, 21' });
    await enqueuePostPaymentJobs(data);

    const jobs = enqueuedJobs();
    const names = jobs.map(j => j.name);
    expect(names).toContain('shipping');
  });

  it('does not enqueue shipping for pickup orders', async () => {
    const data = makePaymentData({ deliveryMethod: 'pickup', deliveryAddress: 'Соборный 21' });
    await enqueuePostPaymentJobs(data);

    const jobs = enqueuedJobs();
    const names = jobs.map(j => j.name);
    expect(names).not.toContain('shipping');
  });

  it('enqueues save-card when token + card details present', async () => {
    const data = makePaymentData({
      token: 'tok_abc123',
      cardFirstSix: '424242',
      cardLastFour: '4242',
      cardType: 'Visa',
      cardExpDate: '12/28',
    });
    await enqueuePostPaymentJobs(data);

    const jobs = enqueuedJobs();
    const names = jobs.map(j => j.name);
    expect(names).toContain('save-card');
  });

  it('skips email-confirmation when no email provided', async () => {
    const data = makePaymentData({ payerEmail: null, contactEmail: null });
    await enqueuePostPaymentJobs(data);

    const jobs = enqueuedJobs();
    const names = jobs.map(j => j.name);
    expect(names).not.toContain('email-confirmation');
  });

  it('all jobs have correct retry opts', async () => {
    const data = makePaymentData({
      isChatOrder: true,
      chatSessionId: 'sess-1',
      partnerPromoCode: 'P1',
      deliveryAddress: 'addr',
      token: 't', cardFirstSix: '123456', cardLastFour: '7890',
    });
    await enqueuePostPaymentJobs(data);

    const jobs = enqueuedJobs();
    for (const job of jobs) {
      expect(job.opts.attempts).toBe(5);
    }
  });

  it('passes full OrderPaymentData to each job', async () => {
    const data = makePaymentData();
    await enqueuePostPaymentJobs(data);

    const jobs = enqueuedJobs();
    for (const job of jobs) {
      const payload = job.data;
      const orderId = typeof payload === 'object' && payload !== null && 'orderId' in payload
        ? payload.orderId
        : null;
      const amount = typeof payload === 'object' && payload !== null && 'amount' in payload
        ? payload.amount
        : null;
      expect(orderId).toBe('SF-20260310-001');
      expect(amount).toBe(1500);
    }
  });
});

// ─── Развилка доставки в job 'shipping' (S4) ─────────────────────────────────

describe('post-payment shipping fork (yandex vs postal)', () => {
  /** Прогнать захваченный процессор воркера на одном job. */
  async function runJob(name: string, data: OrderPaymentData): Promise<void> {
    startPostPaymentWorker();
    const processor = capturedProcessor.fn;
    if (!processor) throw new Error('worker processor was not captured');
    await processor({ name, data });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateYandexClaim.mockResolvedValue({ created: true, claimId: 'claim-1' });
  });

  it('yandex provider is a no-op in post-payment (claim вызывает оператор вручную при status=ready)', async () => {
    const data = makePaymentData({
      deliveryMethod: 'courier',
      deliveryAddress: 'г Ростов-на-Дону, ул Большая Садовая, д 1',
      deliveryProvider: 'yandex',
    });

    await runJob('shipping', data);

    // Авто-claim ОТКЛЮЧЁН: курьера вызывает оператор кнопкой на доске доставки,
    // только когда печать готова. Ручной путь: POST /api/delivery/shipments/:id/dispatch.
    expect(mockCreateYandexClaim).not.toHaveBeenCalled();
    // Путь Почты тоже не задет.
    expect(mockAutomateOrderShipping).not.toHaveBeenCalled();
  });

  it('routes shipping to automateOrderShipping when provider is not yandex (postal)', async () => {
    const data = makePaymentData({
      deliveryMethod: 'postal',
      deliveryAddress: 'г Москва, ул Тверская, д 1',
      deliveryProvider: null,
    });

    await runJob('shipping', data);

    expect(mockAutomateOrderShipping).toHaveBeenCalledOnce();
    expect(mockAutomateOrderShipping).toHaveBeenCalledWith('SF-20260310-001');
    expect(mockCreateYandexClaim).not.toHaveBeenCalled();
  });

  it('yandex no-op остаётся no-op при повторном прогоне (ни claim, ни Почта)', async () => {
    const data = makePaymentData({
      deliveryMethod: 'courier',
      deliveryAddress: 'г Ростов-на-Дону, ул Пушкинская, д 10',
      deliveryProvider: 'yandex',
    });

    await runJob('shipping', data);
    await runJob('shipping', data);

    // Повтор job 'shipping' для yandex безопасен: развилка не запускает ни авто-claim, ни Почту.
    expect(mockCreateYandexClaim).not.toHaveBeenCalled();
    expect(mockAutomateOrderShipping).not.toHaveBeenCalled();
  });
});
