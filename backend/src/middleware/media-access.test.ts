import express, { Router, type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { verifyMediaAccess } from './media-access.js';
import { config } from '../config/index.js';
import { generateSignedUrl } from '../services/signed-url.service.js';

function createApp(): Express {
  const app = express();
  const router = Router();

  router.use('/{*key}', verifyMediaAccess);
  router.get('/{*key}', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/media', router);
  return app;
}

describe('media access', () => {
  it('allows Rust-rendered print layout sheets without browser JWT', async () => {
    const res = await request(createApp()).get('/media/print-layout/job-id/sheet-001.jpg');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('allows converted document pages without browser JWT', async () => {
    const res = await request(createApp()).get('/media/print-conversions/job-id/task-id/page-001.jpg');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('allows local print uploads without browser JWT', async () => {
    const res = await request(createApp()).get('/media/print-uploads/2026/05/upload-id-document.pdf');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('allows photo workspace crop outputs without browser JWT', async () => {
    const res = await request(createApp()).get('/media/photo-workspace/crops/item-id/result.jpg');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('keeps customer print documents operator-only', async () => {
    const res = await request(createApp()).get('/media/print/customer-file.jpg');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Authentication required' });
  });

  it('allows customer print documents with a valid signed URL', async () => {
    const signedPath = generateSignedUrl(
      '/media/print/customer-file.jpg',
      config.guestSession.secret,
      { expiresInMs: 60_000 },
    );
    const res = await request(createApp()).get(signedPath);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('denies unknown prefixes by default', async () => {
    const res = await request(createApp()).get('/media/private/file.jpg');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Access denied' });
  });
});
