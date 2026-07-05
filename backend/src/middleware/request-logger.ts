/**
 * HTTP Request Logger — pino-http middleware.
 *
 * Structured logging for every HTTP request with:
 * - Automatic duration measurement
 * - Correlation ID from X-Request-Id header
 * - Redaction of authorization headers
 * - Quiet mode: health checks are silenced, success responses logged at debug
 */

import pinoHttp from 'pino-http';
import { rootLogger } from '../utils/logger.js';
import { getRequestId } from './request-context.js';

export const requestLogger = pinoHttp({
  logger: rootLogger.child({ module: 'http' }),

  // Attach requestId from AsyncLocalStorage (set by requestContextMiddleware)
  genReqId: (req) => {
    // request-context middleware runs first and sets X-Request-Id header
    return getRequestId() ?? (req.headers['x-request-id'] as string) ?? undefined;
  },

  // Log errors at error level, 4xx at warn, success at debug (quiet by default)
  customLogLevel: (_req, res, err) => {
    if (err || (res.statusCode >= 500)) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'debug';
  },

  // Silence health checks completely
  autoLogging: {
    ignore: (req) => {
      const path = req.url ?? '';
      return path === '/health' || path === '/api/health';
    },
  },

  // Slim down serialized request/response (avoid large headers dumps)
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      remoteAddress: req.remoteAddress,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
});
