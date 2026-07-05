/**
 * Telegram Bot Webhook — v2 Pipeline
 * POST /api/webhooks/telegram — входящие update-ы от Telegram
 *
 * Uses handleWebhook() from webhook-receiver.ts for:
 * - timingSafeEqual secret verification
 * - Idempotency (ON CONFLICT dedup)
 * - BullMQ async processing
 * - Special events (/start → welcome, callback_query → booking/answer)
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

  const result = await handleWebhook('telegram', rawRequest);
  res.status(result.status).send(result.body || '');
});

export default router;
