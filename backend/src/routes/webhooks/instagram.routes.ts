/**
 * Instagram DM Webhook — v2 Pipeline
 * GET  /api/webhooks/instagram — Meta challenge-response verification
 * POST /api/webhooks/instagram — входящие DM от Instagram
 *
 * Uses handleWebhook() from webhook-receiver.ts for:
 * - HMAC-SHA256 verification (timingSafeEqual)
 * - GET challenge-response (via adapter.verifyWebhook)
 * - Idempotency + BullMQ async processing
 */

import { Router, Request, Response } from 'express';
import { handleWebhook } from '../../services/connectors/pipeline/webhook-receiver.js';
import type { RawRequest } from '../../services/connectors/core/dto.js';

const router = Router();

// GET — Meta challenge-response verification
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const rawRequest: RawRequest = {
    body: {},
    headers: req.headers as Record<string, string>,
    query: Object.fromEntries(
      Object.entries(req.query).map(([k, v]) => [k, String(v)]),
    ),
    ip: req.ip,
  };

  const result = await handleWebhook('instagram', rawRequest);
  if (result.body && result.body !== 'ok') {
    res.status(result.status).send(result.body);
  } else {
    res.sendStatus(403);
  }
});

// POST — входящие DM от Instagram
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const rawRequest: RawRequest = {
    body: req.body as Record<string, unknown>,
    headers: req.headers as Record<string, string>,
    rawBody: (req as unknown as { rawBody?: string }).rawBody,
    ip: req.ip,
  };

  const result = await handleWebhook('instagram', rawRequest);
  res.status(result.status).send(result.body || '');
});

export default router;
