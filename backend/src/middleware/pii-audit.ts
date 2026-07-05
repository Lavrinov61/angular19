/**
 * PII access audit middleware.
 *
 * Writes one fire-and-forget row into `pii_access_log` after the response
 * finishes with a 2xx status. Failures are logged but never surface to the
 * caller — this is an audit signal, not a gate.
 *
 * Usage:
 *   router.get('/:id', piiAudit('order', 'id'), handler);
 */

import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../types/index.js';
import db from '../database/db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('pii-audit');

export function piiAudit(targetType: string, idParam = 'id', action = 'read') {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;

      const userId = req.user?.id ?? null;
      const userRole = req.user?.role ?? null;
      const targetIdRaw = req.params?.[idParam];
      const targetId = targetIdRaw ? String(targetIdRaw).slice(0, 128) : null;
      const ip = req.ip ?? null;
      const userAgent = req.get('user-agent') ?? null;

      db.query(
        `INSERT INTO pii_access_log
           (user_id, user_role, target_type, target_id, action, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [userId, userRole, targetType, targetId, action, ip, userAgent],
      ).catch((err: unknown) => {
        logger.warn('pii_access_log insert failed', {
          err: err instanceof Error ? err.message : String(err),
          targetType,
          targetId,
        });
      });
    });

    next();
  };
}
