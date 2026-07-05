/**
 * VK Callback API Webhook — v2 Pipeline
 * POST /api/webhooks/vk — входящие события от VK
 *
 * Uses handleWebhook() from webhook-receiver.ts for:
 * - timingSafeEqual secret verification
 * - Confirmation handshake (type=confirmation → return code)
 * - message_allow/message_deny (channel_users upsert)
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

  const result = await handleWebhook('vk', rawRequest);
  res.status(result.status).send(result.body || '');
});

export default router;
