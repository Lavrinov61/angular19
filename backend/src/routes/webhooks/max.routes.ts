/**
 * Max Messenger Webhook — v2 Pipeline
 * POST /api/webhooks/max — входящие сообщения от MaxBot
 *
 * Uses handleWebhook() from webhook-receiver.ts for:
 * - timingSafeEqual secret verification
 * - Idempotency + BullMQ async processing
 */

import { Router, Request, Response } from 'express';
import { handleWebhook } from '../../services/connectors/pipeline/webhook-receiver.js';
import type { RawRequest } from '../../services/connectors/core/dto.js';

const router = Router();

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const rawRequest: RawRequest = {
    body: req.body as Record<string, unknown>,
    headers: req.headers as Record<string, string>,
    ip: req.ip,
  };

  const result = await handleWebhook('max', rawRequest);
  res.status(result.status).send(result.body || '');
});

export default router;
