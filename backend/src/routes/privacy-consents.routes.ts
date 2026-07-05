import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { optionalAuth, AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createRateLimitStore } from '../middleware/rate-limit-store.js';
import { recordPrivacyConsent } from '../services/privacy-consent.service.js';
import { logAudit } from '../services/audit.service.js';
import type { PrivacyConsentDetailsJsonb } from '../types/jsonb/privacy-consent-jsonb.js';

const router = Router();

const privacyConsentLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: { success: false, error: 'Слишком много запросов. Подождите немного.' },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('rl:privacy-consent:'),
});

const privacyConsentSchema = z.object({
  documentType: z.string().trim().min(1).max(64).default('privacy_policy'),
  documentVersion: z.string().trim().min(1).max(32),
  scope: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  source: z.string().trim().min(1).max(80).default('site'),
  accepted: z.boolean().optional().default(true),
  visitorId: z.string().trim().min(1).max(128).optional(),
  details: z.record(z.unknown()).optional(),
});

type PrivacyConsentBody = z.infer<typeof privacyConsentSchema>;

router.post('/consents', privacyConsentLimiter, optionalAuth, validate(privacyConsentSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const body = req.body as PrivacyConsentBody;
  const details: PrivacyConsentDetailsJsonb = body.details ?? {};

  const created = await recordPrivacyConsent({
    userId: req.user?.id ?? null,
    visitorId: body.visitorId ?? null,
    documentType: body.documentType,
    documentVersion: body.documentVersion,
    scope: body.scope,
    source: body.source,
    accepted: body.accepted,
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent'],
    details,
  });

  if (req.user) {
    logAudit({
      userId: req.user.id,
      userName: req.user.display_name || req.user.email,
      action: 'privacy_consent_recorded',
      entityType: 'privacy_consent',
      entityId: created.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      details: {
        documentType: body.documentType,
        documentVersion: body.documentVersion,
        scope: body.scope,
        source: body.source,
        accepted: body.accepted,
      },
    });
  }

  res.status(201).json({ success: true, data: created });
});

export default router;
