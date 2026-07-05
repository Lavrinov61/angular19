import { Router, Request, Response } from 'express';
import { networkInterfaces, hostname } from 'os';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../database/db.js';
import { createResilientRedis, isRedisReady } from '../services/redis-factory.js';
import { getLeaderStatus } from '../services/scheduler-leader.js';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { checkFaceValidationWorker } from '../services/face-validation.service.js';
import type { AuthRequest } from '../middleware/auth.js';

const router = Router();

const startedAt = new Date();

interface SocketServerHealth {
  getOnlineUsersCount?: () => number;
}

function getLocalIp(): string {
  const nets = networkInterfaces();
  for (const iface of Object.values(nets)) {
    for (const net of iface ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

function readAppVersion(): string {
  try {
    const __dirname2 = dirname(fileURLToPath(import.meta.url));
    const versionFile = resolve(__dirname2, '../../../src/app/core/constants/version.ts');
    const content = readFileSync(versionFile, 'utf-8');
    const match = content.match(/APP_VERSION\s*=\s*['"](.+?)['"]/);
    return match?.[1] ?? 'unknown';
  } catch { return 'unknown'; }
}

function getSocketServerHealth(app: Request['app']): SocketServerHealth | undefined {
  const value = Reflect.get(app, 'socketServer');
  if (typeof value !== 'object' || value === null) return undefined;
  const getOnlineUsersCount = Reflect.get(value, 'getOnlineUsersCount');
  return typeof getOnlineUsersCount === 'function'
    ? { getOnlineUsersCount: getOnlineUsersCount.bind(value) }
    : undefined;
}

// Resilient Redis client for health checks
const healthRedis = createResilientRedis('health-check', {
  lazyConnect: true,
  connectTimeout: 3000,
  enableOfflineQueue: false,
});
healthRedis.connect().catch(() => {
  // Non-fatal: health check will report Redis as degraded
});

export interface ReadinessResponseBody {
  ready: boolean;
  degraded?: boolean;
  reason?: 'ssr_down' | 'redis_unavailable';
}

export async function getReadinessResponse(): Promise<{ statusCode: number; body: ReadinessResponseBody }> {
  // DB must be up
  await db.queryOne('SELECT 1');

  // Redis check — affects readiness but not liveness
  let redisReady = false;
  try {
    if (isRedisReady(healthRedis)) {
      await healthRedis.ping();
      redisReady = true;
    }
  } catch {
    // Redis not ready
  }

  // SSR liveness check
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2000);
  const ssrOk = await fetch('http://localhost:4000/ssr-health', { signal: ctrl.signal })
    .then(r => { clearTimeout(t); return r.ok; })
    .catch(() => { clearTimeout(t); return false; });
  if (!ssrOk) {
    return { statusCode: 503, body: { ready: false, reason: 'ssr_down' } };
  }

  // If Redis is down: report ready but degraded
  // (we still serve requests, just without caching/rate-limiting)
  if (!redisReady) {
    return { statusCode: 200, body: { ready: true, degraded: true, reason: 'redis_unavailable' } };
  }

  return { statusCode: 200, body: { ready: true } };
}

/**
 * GET /api/health/live — liveness probe (ALB liveness).
 *
 * Zero-dependency: if the process is alive and can handle HTTP, return 200.
 * Returns 503 only on extreme heap pressure (>95%) as a signal to restart.
 */
router.get('/live', (_req: Request, res: Response) => {
  const mem = process.memoryUsage();
  const heapPercent = (mem.heapUsed / mem.heapTotal) * 100;

  if (heapPercent > 95) {
    res.status(503).json({ status: 'unhealthy', reason: 'heap_pressure', heapPercent: Math.round(heapPercent) });
    return;
  }

  res.json({
    status: 'alive',
    uptime: Math.round(process.uptime()),
    heapPercent: Math.round(heapPercent),
    pid: process.pid,
  });
});

/**
 * GET /api/health — liveness check (safe for public/ALB).
 *
 * Liveness: only checks DB (core dependency).
 * Redis failure = degraded but NOT unhealthy (app can still serve requests).
 * This ensures ALB doesn't pull the node out of rotation on Redis failure.
 */
router.get('/', async (_req: Request, res: Response) => {
  let dbOk = true;
  let redisOk = true;

  try {
    await db.queryOne('SELECT 1 AS ok');
  } catch {
    dbOk = false;
  }

  try {
    await healthRedis.ping();
  } catch {
    redisOk = false;
  }

  const uptimeMs = Date.now() - startedAt.getTime();
  const uptimeHours = Math.floor(uptimeMs / 3600000);
  const uptimeMinutes = Math.floor((uptimeMs % 3600000) / 60000);

  // Liveness: DB must be up. Redis down = degraded but alive.
  const status = !dbOk ? 'unhealthy' : !redisOk ? 'degraded' : 'healthy';
  const httpStatus = dbOk ? 200 : 503;

  res.status(httpStatus).json({
    status,
    uptime: `${uptimeHours}h ${uptimeMinutes}m`,
    ...(redisOk ? {} : { redis: 'unavailable' }),
  });
});

/**
 * GET /api/health/detailed — full diagnostics (admin only).
 * Exposes instance info, memory, sockets, DB/Redis latency.
 */
router.get('/detailed', authenticateToken, requirePermission('settings:manage'), async (_req: AuthRequest, res: Response) => {
  const checks: Record<string, { status: string; latency?: number; error?: string }> = {};
  let healthy = true;

  const dbStart = Date.now();
  try {
    await db.queryOne('SELECT 1 AS ok');
    checks['database'] = { status: 'ok', latency: Date.now() - dbStart };
  } catch (err: unknown) {
    healthy = false;
    checks['database'] = {
      status: 'error',
      latency: Date.now() - dbStart,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }

  const redisStart = Date.now();
  try {
    if (isRedisReady(healthRedis)) {
      await healthRedis.ping();
      checks['redis'] = { status: 'ok', latency: Date.now() - redisStart };
    } else {
      // Redis not connected — report degraded, NOT error
      checks['redis'] = { status: 'degraded', latency: 0, error: 'Redis not connected (reconnecting)' };
    }
  } catch (err: unknown) {
    checks['redis'] = {
      status: 'degraded',
      latency: Date.now() - redisStart,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }

  const uptimeMs = Date.now() - startedAt.getTime();
  const uptimeHours = Math.floor(uptimeMs / 3600000);
  const uptimeMinutes = Math.floor((uptimeMs % 3600000) / 60000);

  // BullMQ queue depths
  interface QueueCounts { waiting: number; active: number; delayed: number; failed: number; [key: string]: number; }
  const queueStatus: Record<string, QueueCounts> = {};
  try {
    const { getInboundQueue, getStatusQueue } = await import('../services/connectors/pipeline/webhook-receiver.js');
    const { outboundQueue } = await import('../services/connectors/pipeline/outbound-worker.js');
    const { mediaQueue } = await import('../services/connectors/pipeline/inbound-worker.js');
    for (const q of [getInboundQueue(), getStatusQueue(), outboundQueue, mediaQueue]) {
      const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'failed') as QueueCounts;
      queueStatus[q.name] = counts;
    }
  } catch {
    // Queues may not be initialized
  }

  // Circuit breaker states
  const cbStatus: Record<string, { state: string; failures: number; lastError: string; lastSuccessAt: number; lastFailureAt: number }> = {};
  try {
    const { getAllBreakers } = await import('../utils/circuit-breaker.js');
    for (const [name, breaker] of getAllBreakers()) {
      const state = breaker.getState();
      cbStatus[name] = {
        state,
        failures: breaker.getFailures(),
        lastError: breaker.getLastError(),
        lastSuccessAt: breaker.getLastSuccessAt(),
        lastFailureAt: breaker.getLastFailureAt(),
      };
      if (state === 'OPEN') healthy = false;
    }
  } catch {
    // Circuit breakers may not be initialized
  }

  const socketServer = getSocketServerHealth(_req.app);

  // PG pool stats
  const pgPool = db.getPool?.();
  const pgPoolStats = {
    totalCount: pgPool?.totalCount ?? 0,
    idleCount: pgPool?.idleCount ?? 0,
    waitingCount: pgPool?.waitingCount ?? 0,
  };

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    instance: {
      hostname: hostname(),
      ip: getLocalIp(),
      role: getLeaderStatus(),
      appVersion: readAppVersion(),
      nodeVersion: process.version,
    },
    uptime: `${uptimeHours}h ${uptimeMinutes}m`,
    startedAt: startedAt.toISOString(),
    checks,
    pgPool: pgPoolStats,
    queues: queueStatus,
    circuitBreakers: cbStatus,
    sockets: {
      connected: socketServer?.getOnlineUsersCount?.() ?? 0,
    },
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1048576),
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1048576),
    },
  });
});

/**
 * GET /api/health/face-validation — isolated Rust photo-retouch-tool probe.
 *
 * This is intentionally not part of /health or /ready: face validation is a
 * feature dependency, not an API liveness dependency.
 */
router.get('/face-validation', authenticateToken, requirePermission('settings:manage'), async (_req: AuthRequest, res: Response) => {
  const health = await checkFaceValidationWorker();
  res.status(health.ok ? 200 : 503).json({
    status: health.status,
    ready: health.ok,
    latencyMs: health.latencyMs,
    ...(health.error ? { error: health.error } : {}),
  });
});

/**
 * GET /api/health/ready — readiness check (for load balancer).
 * Checks: DB + SSR + Redis.
 *
 * Redis affects readiness (NOT liveness):
 * - Ready = can serve full-feature requests
 * - Not ready = degraded, load balancer can route traffic elsewhere
 */
router.get('/ready', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { statusCode, body } = await getReadinessResponse();
    res.status(statusCode).json(body);
  } catch {
    res.status(503).json({ ready: false });
  }
});

export default router;
