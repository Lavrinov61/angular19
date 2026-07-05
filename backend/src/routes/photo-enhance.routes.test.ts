import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

const { mockPool } = vi.hoisted(() => {
  const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn(), end: vi.fn() };
  return { mockPool };
});

vi.mock('../database/db.js', () => ({
  default: { query: vi.fn().mockResolvedValue([]), queryOne: vi.fn().mockResolvedValue(null) },
  pool: mockPool,
}));
vi.mock('../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));
vi.mock('../config/index.js', () => ({
  config: {
    jwt: { secret: 'test-jwt-secret-for-tests', expiresIn: '15m' },
    redis: { host: '' },
    upload: { dir: '/tmp/test-uploads' },
  },
}));

// Mock child_process to avoid running actual Sharp processes
vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    cb(null, JSON.stringify({ width: 800, height: 600, size: 100000 }), '');
  }),
}));

// Mock fs to avoid file system access
vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined), // file exists
  },
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./photo-enhance.routes.js');
  app = createTestApp(router);
});

function resetMocks() {
  vi.mocked(mockPool.query).mockReset().mockResolvedValue({ rows: [] });
}

const DB_FILE = {
  id: 'file-1',
  user_id: null,
  file_name: 'photo.jpg',
  original_name: 'photo.jpg',
  file_path: '/tmp/test-uploads/photo.jpg',
  file_size: 500000,
  mime_type: 'image/jpeg',
  storage_type: 'local',
};

// ─── POST /enhance — enhance photo ────────────────────────────────────────────
describe('POST /enhance — AI photo enhancement', () => {
  beforeEach(resetMocks);

  it('returns 400 if fileId is missing', async () => {
    const res = await request(app).post('/enhance').send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 if file not found', async () => {
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [] }); // file lookup

    const res = await request(app).post('/enhance').send({ fileId: 'unknown-file-id' });
    expect(res.status).toBe(404);
  });

  it('enhances photo and returns enhanced file data', async () => {
    vi.mocked(mockPool.query)
      .mockResolvedValueOnce({ rows: [DB_FILE] }) // file lookup
      .mockResolvedValueOnce({ rows: [] }); // INSERT enhanced file

    const res = await request(app).post('/enhance').send({ fileId: 'file-1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.originalFileId).toBe('file-1');
    expect(res.body.data.enhancedFileId).toBeDefined();
    expect(res.body.data.metadata.width).toBe(800);
    expect(res.body.data.metadata.height).toBe(600);
  });
});
