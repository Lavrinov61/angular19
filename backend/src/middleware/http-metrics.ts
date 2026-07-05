/**
 * HTTP Metrics Middleware (Stage 7: Monitoring)
 *
 * Records Prometheus metrics for every HTTP request:
 * - Duration histogram (method, normalized route, status)
 * - Request counter
 * - In-flight gauge
 *
 * Route normalization: replaces path parameters with `:param` to prevent
 * high cardinality (e.g., /api/orders/abc123 → /api/orders/:id).
 */

import type { Request, Response, NextFunction } from 'express';
import { httpRequestDuration, httpRequestsTotal, httpRequestsInFlight } from '../services/metrics.service.js';

/**
 * Normalize Express route path to prevent high-cardinality labels.
 * Uses `req.route?.path` when available (matched route pattern),
 * falls back to manual normalization of the URL path.
 */
function normalizeRoute(req: Request): string {
  // Express populates req.route when a route matches
  if (req.route?.path) {
    return req.baseUrl + req.route.path;
  }

  // Fallback: manually normalize common patterns
  const path = req.path;

  // Replace UUIDs (v4: 8-4-4-4-12 hex)
  let normalized = path.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    ':id',
  );

  // Replace numeric IDs (standalone segments of 1+ digits)
  normalized = normalized.replace(/\/\d+(?=\/|$)/g, '/:id');

  // Replace order IDs (e.g., ORD-20260310-XXXX pattern)
  normalized = normalized.replace(/\/ORD-[A-Z0-9-]+/g, '/:orderId');

  // Collapse consecutive :id into single
  normalized = normalized.replace(/(\/:[a-zA-Z]+){2,}/g, '/:id');

  return normalized;
}

export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip metrics endpoint itself to avoid recursion
  if (req.path === '/metrics' || req.path === '/api/metrics') {
    next();
    return;
  }

  const start = process.hrtime.bigint();
  httpRequestsInFlight.inc();

  // Capture response finish
  res.on('finish', () => {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationSec = durationNs / 1e9;

    const route = normalizeRoute(req);
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };

    httpRequestDuration.observe(labels, durationSec);
    httpRequestsTotal.inc(labels);
    httpRequestsInFlight.dec();
  });

  next();
}
