import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

const { mockDb } = vi.hoisted(() => {
  const mockDb = {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
  };
  return { mockDb };
});

vi.mock('../../database/db.js', () => ({ default: mockDb, pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../config/index.js', () => ({
  config: { jwt: { secret: 'test-jwt-secret-for-tests', expiresIn: '15m' }, redis: { host: '' } },
}));

// Rate-limit store mocked to in-memory no-op (avoid Redis dependency).
vi.mock('../../middleware/rate-limit-store.js', () => ({
  createRateLimitStore: () => undefined,
}));

const { mockStorage, mockEstimate } = vi.hoisted(() => ({
  mockStorage: {
    generatePresignedPutUrl: vi.fn().mockResolvedValue({ url: 'https://svoefoto.ru/s3-proxy/put?sig', key: 'k' }),
    listObjectsByPrefix: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
    headObject: vi.fn().mockResolvedValue({ contentLength: 1024, contentType: 'application/pdf' }),
  },
  mockEstimate: vi.fn(),
}));

vi.mock('../../services/storage.service.js', () => ({ storageService: mockStorage }));
vi.mock('../../services/edu-print-estimate.service.js', () => ({ estimateEduPrint: mockEstimate }));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../../test-utils/create-test-app.js');
  const { default: router } = await import('./print-estimate.routes.js');
  app = createTestApp(router);
});

const { makeClientUser, authHeader } = await import('../../test-utils/mock-auth.js');

const CLIENT = makeClientUser({ id: 'u1' });
const DB_CLIENT = { id: 'u1', email: 'client@example.com', role: 'client', is_active: true, display_name: 'C', phone: null, force_password_change: false, last_password_change: null };

function asAuthenticated(): void {
  vi.mocked(mockDb.queryOne).mockResolvedValue(DB_CLIENT);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.generatePresignedPutUrl.mockResolvedValue({ url: 'https://svoefoto.ru/s3-proxy/put?sig', key: 'k' });
  mockStorage.listObjectsByPrefix.mockResolvedValue([]);
  mockStorage.headObject.mockResolvedValue({ contentLength: 1024, contentType: 'application/pdf' });
});

describe('POST /presign', () => {
  it('401 без авторизации', async () => {
    const res = await request(app).post('/presign').send({ fileName: 'a.pdf', contentType: 'application/pdf', fileSize: 1000 });
    expect(res.status).toBe(401);
  });

  it('выдаёт ключ с префиксом userId', async () => {
    asAuthenticated();
    const res = await request(app)
      .post('/presign')
      .set(authHeader(CLIENT))
      .send({ fileName: 'ref.pdf', contentType: 'application/pdf', fileSize: 1048576 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.s3Key).toMatch(/^print-estimates\/u1\/[0-9a-f-]+\.pdf$/);
    expect(res.body.data.uploadUrl).toContain('s3-proxy');
  });

  it('отклоняет неподдерживаемый MIME', async () => {
    asAuthenticated();
    const res = await request(app)
      .post('/presign')
      .set(authHeader(CLIENT))
      .send({ fileName: 'a.exe', contentType: 'application/x-msdownload', fileSize: 1000 });
    expect(res.status).toBe(400);
  });

  it('отклоняет слишком большой файл (zod max)', async () => {
    asAuthenticated();
    const res = await request(app)
      .post('/presign')
      .set(authHeader(CLIENT))
      .send({ fileName: 'a.pdf', contentType: 'application/pdf', fileSize: 60 * 1024 * 1024 });
    expect(res.status).toBe(400);
  });
});

describe('POST / (estimate)', () => {
  it('401 без авторизации', async () => {
    const res = await request(app).post('/').send({ s3Key: 'print-estimates/u1/x.pdf', colorMode: 'auto' });
    expect(res.status).toBe(401);
  });

  it('403 при чужом s3Key (IDOR-binding)', async () => {
    asAuthenticated();
    const res = await request(app)
      .post('/')
      .set(authHeader(CLIENT))
      .send({ s3Key: 'print-estimates/u2/x.pdf', colorMode: 'auto' });
    expect(res.status).toBe(403);
    expect(mockEstimate).not.toHaveBeenCalled();
  });

  it('403 при произвольном префиксе ключа', async () => {
    asAuthenticated();
    const res = await request(app)
      .post('/')
      .set(authHeader(CLIENT))
      .send({ s3Key: 'chat/secret.pdf', colorMode: 'auto' });
    expect(res.status).toBe(403);
  });

  it('403 при path-traversal (.. в ключе), несмотря на валидный префикс', async () => {
    asAuthenticated();
    const res = await request(app)
      .post('/')
      .set(authHeader(CLIENT))
      .send({ s3Key: 'print-estimates/u1/../u2/evil.pdf', colorMode: 'auto' });
    expect(res.status).toBe(403);
    expect(mockEstimate).not.toHaveBeenCalled();
    expect(mockStorage.headObject).not.toHaveBeenCalled();
  });

  it('400 при невалидном colorMode (zod enum)', async () => {
    asAuthenticated();
    const res = await request(app)
      .post('/')
      .set(authHeader(CLIENT))
      .send({ s3Key: 'print-estimates/u1/x.pdf', colorMode: 'rainbow' });
    expect(res.status).toBe(400);
    expect(mockEstimate).not.toHaveBeenCalled();
  });

  it('410 если объект не существует', async () => {
    asAuthenticated();
    mockStorage.headObject.mockResolvedValue(null);
    const res = await request(app)
      .post('/')
      .set(authHeader(CLIENT))
      .send({ s3Key: 'print-estimates/u1/x.pdf', colorMode: 'auto' });
    expect(res.status).toBe(410);
    expect(mockEstimate).not.toHaveBeenCalled();
  });

  it('200 со своим ключом → зовёт estimateEduPrint', async () => {
    asAuthenticated();
    mockEstimate.mockResolvedValue({ pageCount: 1, pages: [], summary: {}, allowance: null, subscription: { active: false } });
    const res = await request(app)
      .post('/')
      .set(authHeader(CLIENT))
      .send({ s3Key: 'print-estimates/u1/x.pdf', colorMode: 'color' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockEstimate).toHaveBeenCalledWith({ userId: 'u1', s3Key: 'print-estimates/u1/x.pdf', colorMode: 'color' });
  });

  it('colorMode по умолчанию auto', async () => {
    asAuthenticated();
    mockEstimate.mockResolvedValue({ pageCount: 1, pages: [], summary: {}, allowance: null, subscription: { active: false } });
    await request(app)
      .post('/')
      .set(authHeader(CLIENT))
      .send({ s3Key: 'print-estimates/u1/x.pdf' });
    expect(mockEstimate).toHaveBeenCalledWith(expect.objectContaining({ colorMode: 'auto' }));
  });
});
