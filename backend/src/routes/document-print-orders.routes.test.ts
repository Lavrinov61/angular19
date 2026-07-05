import type { NextFunction, Request, Response } from 'express';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

const mockDb = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

const crmMocks = vi.hoisted(() => ({
  enqueueCrmEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../database/db.js', () => ({
  default: mockDb,
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock('../middleware/upload-limiter.js', () => ({
  createUploadLimiter: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
}));

vi.mock('../services/storage.service.js', () => ({
  storageService: {
    generatePresignedPutUrl: vi.fn().mockResolvedValue({ url: 'https://storage.example/upload' }),
    getPublicUrl: vi.fn((key: string) => `https://storage.example/${key}`),
    headObject: vi.fn().mockResolvedValue({ contentLength: 12345 }),
  },
}));

vi.mock('../services/av-scan-worker.js', () => ({
  enqueueAvScan: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/crm-event-queue.service.js', () => crmMocks);

vi.mock('../utils/secure-random.js', () => ({
  generateOrderId: vi.fn().mockReturnValue('DP-TEST-001'),
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./document-print-orders.routes.js');
  app = createTestApp(router);
});

function resetMocks(): void {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
  crmMocks.enqueueCrmEvent.mockReset().mockResolvedValue(undefined);
}

describe('document print direct uploads', () => {
  beforeEach(resetMocks);

  it('creates presigned upload targets for PDF files without auth', async () => {
    const res = await request(app)
      .post('/direct-upload/presign')
      .send({
        files: [
          {
            fileName: 'dogovor.pdf',
            contentType: 'application/pdf',
            fileSize: 1024,
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.uploads[0]).toMatchObject({
      uploadUrl: 'https://storage.example/upload',
      contentType: 'application/pdf',
    });
    expect(res.body.data.uploads[0].s3Key).toContain('document-print/');
  });

  it('completes document uploads without auth', async () => {
    const res = await request(app)
      .post('/direct-upload/complete')
      .send({
        files: [
          {
            fileName: 'dogovor.pdf',
            contentType: 'application/pdf',
            fileSize: 1024,
            s3Key: 'document-print/dogovor.pdf',
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.files[0]).toMatchObject({
      fileName: 'dogovor.pdf',
      s3Key: 'document-print/dogovor.pdf',
      uploadedUrl: 'https://storage.example/document-print/dogovor.pdf',
    });
  });
});

describe('POST / — create anonymous document print order', () => {
  beforeEach(resetMocks);

  it('creates a website order without auth and returns a payment link', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce({
        id: 'studio-id',
        name: 'Соборный 21',
        address: 'пр. Соборный, 21',
        location_code: 'soborny-21',
        status: 'open',
      })
      .mockResolvedValueOnce({
        id: 'photo-print-order-row',
        order_id: 'DP-TEST-001',
        total_price: '20.00',
      });

    const res = await request(app)
      .post('/')
      .send({
        contact: {
          name: 'Иван Иванов',
          phone: '+79001234567',
        },
        pickupLocationId: 'soborny-21',
        print: {
          paperSize: 'a4',
          colorMode: 'bw',
          sides: 'single',
          copies: 2,
        },
        files: [
          {
            fileName: 'dogovor.pdf',
            contentType: 'application/pdf',
            fileSize: 1024,
            s3Key: 'document-print/dogovor.pdf',
            uploadedUrl: 'https://storage.example/document-print/dogovor.pdf',
            pageCount: 1,
          },
        ],
        source: 'website',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        orderId: 'DP-TEST-001',
        paymentUrl: '/pay/DP-TEST-001',
        totalPrice: 20,
      },
    });

    const insertSql = String(mockDb.queryOne.mock.calls[1]?.[0]);
    const insertParams = mockDb.queryOne.mock.calls[1]?.[1];
    expect(insertSql).toContain('INSERT INTO photo_print_orders');
    expect(insertParams).toContain('document_print');
    expect(crmMocks.enqueueCrmEvent).toHaveBeenCalledWith(
      'order',
      'DP-TEST-001',
      'order_created',
      expect.objectContaining({
        metadata: expect.objectContaining({
          source: 'website',
          serviceType: 'document_print',
        }),
      }),
    );
  });

  it('rejects orders without uploaded files', async () => {
    const res = await request(app)
      .post('/')
      .send({
        contact: { name: 'Иван Иванов', phone: '+79001234567' },
        pickupLocationId: 'soborny-21',
        print: { paperSize: 'a4', colorMode: 'bw', sides: 'single', copies: 1 },
        files: [],
      });

    expect(res.status).toBe(400);
  });
});
