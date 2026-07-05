import { Router, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config/index.js';
import { authenticateToken, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createLogger } from '../utils/logger.js';
import {
  AlfaBankConfigurationError,
  createAlfaBankClient,
} from '../services/payments/alfabank.service.js';

const router = Router();
const log = createLogger('alfabank-payments.routes');

const testRegisterOrderSchema = z.object({
  amountRub: z.number().positive().finite().max(1_000_000),
  description: z.string().trim().min(1).max(512).optional(),
  orderNumber: z.string().trim().min(1).max(64).optional(),
  clientId: z.string().trim().min(1).max(128).optional(),
  email: z.string().trim().email().max(254).optional(),
  phone: z.string().trim().min(5).max(32).optional(),
}).strict();

router.get('/health', (_req, res) => {
  const alfaBankConfig = config.alfaBank;
  res.json({
    success: true,
    provider: 'alfabank',
    environment: detectEnvironment(alfaBankConfig.apiBaseUrl),
    enabled: alfaBankConfig.enabled,
    configured: isConfigured(alfaBankConfig),
    apiBaseUrl: alfaBankConfig.apiBaseUrl,
  });
});

router.post(
  '/test/register-order',
  authenticateToken,
  requirePermission('subscriptions:manage'),
  validate(testRegisterOrderSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const body = testRegisterOrderSchema.parse(req.body);
    const orderNumber = body.orderNumber ?? createTestOrderNumber();
    const client = createAlfaBankClient(config.alfaBank);

    try {
      const result = await client.registerOrder({
        orderNumber,
        amountRub: body.amountRub,
        description: body.description ?? 'AlfaBank test payment',
        clientId: body.clientId,
        email: body.email,
        phone: body.phone,
        metadata: {
          purpose: 'test-register-order',
          requestedBy: req.user?.id ?? null,
        },
      });

      if (!result.success) {
        log.warn('AlfaBank test order rejected', {
          orderNumber,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
        });
        res.status(502).json({
          success: false,
          error: 'AlfaBank payment gateway rejected the test order',
          providerError: {
            code: result.errorCode,
            message: result.errorMessage,
          },
        });
        return;
      }

      res.status(201).json({
        success: true,
        provider: 'alfabank',
        test: true,
        orderNumber,
        orderId: result.orderId,
        formUrl: result.formUrl,
      });
    } catch (error) {
      if (error instanceof AlfaBankConfigurationError) {
        res.status(503).json({
          success: false,
          error: 'AlfaBank payments are not configured',
        });
        return;
      }

      log.error('AlfaBank test order registration failed', {
        orderNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
);

function isConfigured(alfaBankConfig: typeof config.alfaBank): boolean {
  return Boolean(
    alfaBankConfig.userName.trim()
    && alfaBankConfig.password.trim()
    && alfaBankConfig.returnUrl.trim()
    && alfaBankConfig.failUrl.trim(),
  );
}

function detectEnvironment(apiBaseUrl: string): 'test' | 'production' | 'custom' {
  const normalized = apiBaseUrl.toLowerCase();
  if (normalized.includes('rbsuat')) return 'test';
  if (normalized.includes('pay.alfabank.ru') || normalized.includes('payment.alfabank.ru')) return 'production';
  return 'custom';
}

function createTestOrderNumber(): string {
  const randomSuffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ALFA-TEST-${Date.now()}-${randomSuffix}`;
}

export default router;
