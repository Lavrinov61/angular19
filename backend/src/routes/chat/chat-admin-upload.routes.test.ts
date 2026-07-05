import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { PassThrough } from 'stream';

const { mockDb, mockPool, mockStorageService } = vi.hoisted(() => {
  const mockClient = {
    query: vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          id: 'msg-1',
          content: 'bad.zip',
          sender_type: 'operator',
          sender_name: 'Operator',
          message_type: 'file',
          created_at: new Date().toISOString(),
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ channel: 'web', metadata: {}, visitor_name: 'Visitor', status: 'open' }] }),
  };
  const mockDb = {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn(),
    transaction: vi.fn().mockImplementation(async (fn: (client: typeof mockClient) => unknown) => fn(mockClient)),
  };
  const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  const mockStorageService = {
    generatePresignedPutUrl: vi.fn(),
    headObject: vi.fn(),
    getReadStream: vi.fn(),
    getPublicUrl: vi.fn().mockImplementation((key: string) => `https://svoefoto.ru/media/${key}`),
    isS3Url: vi.fn().mockReturnValue(false),
    resolveSignedUrl: vi.fn(),
  };
  return { mockDb, mockPool, mockStorageService };
});

vi.mock('../../database/db.js', () => ({ default: mockDb, pool: mockPool }));
vi.mock('../../services/storage.service.js', () => ({ storageService: mockStorageService }));
vi.mock('../../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../services/auth-cache.service.js', () => ({
  getAuthCache: vi.fn().mockResolvedValue(null),
  setAuthCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../config/index.js', () => ({
  config: {
    jwt: { secret: 'test-jwt-secret-for-tests', expiresIn: '15m' },
    redis: { host: '', port: 6379 },
  },
}));
vi.mock('../../services/chat-broadcast.service.js', () => ({
  broadcastChatMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./chat-shared.js', () => ({
  ALLOWED_MIME_TYPES: new Set(['application/zip']),
}));
vi.mock('../../services/connectors/pipeline/outbound-worker.js', () => ({
  enqueueOutbound: vi.fn().mockResolvedValue('outbound-1'),
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../../test-utils/create-test-app.js');
  const { default: router } = await import('./chat-admin-upload.routes.js');
  app = createTestApp(router);
});

import { authHeader, makeEmployeeUser } from '../../test-utils/mock-auth.js';

const DB_EMPLOYEE = {
  id: 'employee-id',
  email: 'employee@example.com',
  role: 'employee',
  is_active: true,
  display_name: 'Employee',
  phone: null,
  force_password_change: false,
  last_password_change: null,
};

function resetMocks() {
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(DB_EMPLOYEE);
  vi.mocked(mockPool.query).mockReset().mockResolvedValue({ rows: [] });
  vi.mocked(mockDb.transaction).mockClear();
  vi.mocked(mockStorageService.generatePresignedPutUrl).mockReset();
  vi.mocked(mockStorageService.headObject).mockReset();
  vi.mocked(mockStorageService.getReadStream).mockReset();
  vi.mocked(mockStorageService.getPublicUrl).mockReset().mockImplementation((key: string) => `https://svoefoto.ru/media/${key}`);
  vi.mocked(mockStorageService.isS3Url).mockReset().mockReturnValue(false);
  vi.mocked(mockStorageService.resolveSignedUrl).mockReset();
}

describe('POST /admin/sessions/:sessionId/upload/complete', () => {
  beforeEach(resetMocks);

  it('rejects a zip object that has no end-of-central-directory record', async () => {
    const employee = makeEmployeeUser();
    vi.mocked(mockStorageService.headObject).mockResolvedValue({
      contentLength: 24_721_134,
      contentType: 'application/zip',
    });
    vi.mocked(mockStorageService.getReadStream).mockResolvedValue(PassThrough.from(Buffer.from('not a zip archive')));

    const res = await request(app)
      .post('/admin/sessions/session-1/upload/complete')
      .set(authHeader(employee))
      .send({
        files: [{
          s3Key: 'chat/bad.zip',
          fileName: 'B79A6937.CR2.zip',
          contentType: 'application/zip',
          fileSize: 24_721_134,
        }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('invalid zip archive');
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});
