/**
 * Photo archive access audit — middleware.
 *
 * Пишет в photo_access_audit каждый запрос на `/api/bitrix-archive/file/*`
 * (и любые другие archive-endpoints, которые решим логировать).
 *
 * Поля: user_id (из req.user), s3_bucket, s3_key, action, ip, user_agent, reason.
 * WORM-trigger на таблицу уже стоит — UPDATE/DELETE невозможны.
 */

import type { Request, Response, NextFunction } from 'express';
import db from '../database/db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('photo-audit');

interface AuditOptions {
  action: 'view' | 'download' | 'presign';
  accessMethod?: string;
  reasonFromQuery?: boolean;
}

export function photoAuditMiddleware(options: AuditOptions) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const keyFromReq =
      (req.params?.['key'] as string | undefined) ||
      (req.params?.['id'] as string | undefined) ||
      (req.query?.['key'] as string | undefined) ||
      '';

    const userId =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).user?.id ?? (req as any).user?.userId ?? null;
    const role =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).user?.role ?? null;

    const reason = options.reasonFromQuery
      ? String(req.query?.['reason'] ?? '').slice(0, 200) || null
      : null;

    const bucket = process.env['BITRIX_ARCHIVE_BUCKET'] ?? 'svoefoto-archive-bitrix';

    db.query(
      `
      INSERT INTO photo_access_audit
        (accessed_by_user_id, accessed_by_role, access_type, access_method, ip_address, user_agent, s3_bucket, s3_key, reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        userId,
        role,
        options.action,
        options.accessMethod ?? 'api',
        req.ip ?? null,
        req.get('user-agent') ?? null,
        bucket,
        keyFromReq || null,
        reason,
      ],
    ).catch((err) => {
      logger.warn('Failed to write photo_access_audit', { err: (err as Error).message });
    });

    next();
  };
}
