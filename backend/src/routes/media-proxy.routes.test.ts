import express, { type Express } from 'express';
import { Readable } from 'stream';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type MediaRange = { start: number; end: number };

const storageMocks = vi.hoisted(() => ({
  headObject: vi.fn(),
  getReadStream: vi.fn(),
}));

vi.mock('../services/storage.service.js', () => ({
  storageService: storageMocks,
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  })),
}));

let app: Express;

beforeAll(async () => {
  const { default: router } = await import('./media-proxy.routes.js');
  app = express();
  app.use('/media', router);
});

beforeEach(() => {
  vi.clearAllMocks();
  storageMocks.headObject.mockResolvedValue({
    contentLength: 100,
    contentType: 'image/jpeg',
  });
  storageMocks.getReadStream.mockImplementation((_key: string, range?: MediaRange) => {
    const length = range ? range.end - range.start + 1 : 100;
    return Promise.resolve(Readable.from(Buffer.alloc(length, 'x')));
  });
});

describe('media proxy', () => {
  it('serves HEAD metadata without opening the object stream', async () => {
    const res = await request(app).head('/media/chat/file.jpg');

    expect(res.status).toBe(200);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-length']).toBe('100');
    expect(storageMocks.headObject).toHaveBeenCalledWith('chat/file.jpg');
    expect(storageMocks.getReadStream).not.toHaveBeenCalled();
  });

  it('serves photo workspace crop outputs', async () => {
    const res = await request(app).get('/media/photo-workspace/crops/item-id/result.jpg');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(storageMocks.headObject).toHaveBeenCalledWith('photo-workspace/crops/item-id/result.jpg');
    expect(storageMocks.getReadStream).toHaveBeenCalledWith('photo-workspace/crops/item-id/result.jpg', undefined);
  });

  it('serves byte ranges with 206 and Content-Range', async () => {
    const res = await request(app)
      .get('/media/chat/file.jpg')
      .set('Range', 'bytes=10-19');

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 10-19/100');
    expect(res.headers['content-length']).toBe('10');
    expect(storageMocks.getReadStream).toHaveBeenCalledWith('chat/file.jpg', { start: 10, end: 19 });
  });

  it('rejects unsatisfiable ranges before opening the object stream', async () => {
    const res = await request(app)
      .get('/media/chat/file.jpg')
      .set('Range', 'bytes=200-300');

    expect(res.status).toBe(416);
    expect(res.headers['content-range']).toBe('bytes */100');
    expect(storageMocks.getReadStream).not.toHaveBeenCalled();
  });
});
