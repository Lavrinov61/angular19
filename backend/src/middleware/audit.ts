import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { logAudit } from '../services/audit.service.js';

/**
 * Middleware: записывает действие в audit_log после отправки ответа.
 * Fire-and-forget — не блокирует ответ клиенту.
 *
 * Использование:
 *   router.delete('/products/:id', auditLog('product_delete', 'product', 'id'), handler)
 */
export function auditLog(
  action: string,
  entityType?: string,
  entityParamName?: string
) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const originalJson = res.json.bind(res);

    res.json = (body: unknown) => {
      // Записываем только успешные ответы (2xx)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const entityId = entityParamName
          ? (req.params[entityParamName] ?? req.body?.[entityParamName])
          : null;

        logAudit({
          userId: req.user?.id,
          userName: req.user?.display_name,
          action,
          entityType: entityType ?? 'unknown',
          entityId: entityId ?? undefined,
          details: {
            method: req.method,
            path: req.path,
            body: sanitizeBody(req.body),
          },
          ip: req.ip ?? undefined,
          userAgent: req.get('user-agent') ?? undefined,
        });
      }

      return originalJson(body);
    };

    next();
  };
}

/** Убирает чувствительные поля из тела запроса перед логированием */
function sanitizeBody(body: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};
  const { password, token, secret, card_number, cvv, ...safe } = body as Record<string, unknown>;
  void password; void token; void secret; void card_number; void cvv;
  return safe;
}
