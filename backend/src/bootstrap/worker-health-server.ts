import { createServer } from 'http';

import { createResilientRedis } from '../services/redis-factory.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('worker-health');
const CHECK_TIMEOUT_MS = 2_000;

export type HealthCheck = () => Promise<unknown>;

export interface WorkerHealthServerOptions {
  role: string;
  port: number;
  checks: Record<string, HealthCheck>;
  extra?: () => Record<string, unknown>;
}

export interface WorkerHealthServer {
  close(): Promise<void>;
}

export interface RedisHealthCheck {
  check: HealthCheck;
  close(): Promise<void>;
}

function withTimeout(name: string, check: HealthCheck): Promise<unknown> {
  return Promise.race([
    check(),
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${name} timeout after ${CHECK_TIMEOUT_MS}ms`)), CHECK_TIMEOUT_MS);
      timer.unref();
    }),
  ]);
}

function writeJson(res: import('http').ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export async function startWorkerHealthServer(options: WorkerHealthServerOptions): Promise<WorkerHealthServer> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname !== '/health') {
      writeJson(res, 404, { success: false, error: 'not_found' });
      return;
    }

    const checks: Record<string, Record<string, unknown>> = {};
    let success = true;

    await Promise.all(Object.entries(options.checks).map(async ([name, check]) => {
      try {
        const value = await withTimeout(name, check);
        checks[name] = { ok: true, ...(value === undefined ? {} : { value }) };
      } catch (err: unknown) {
        success = false;
        checks[name] = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }));

    writeJson(res, success ? 200 : 503, {
      success,
      role: options.role,
      pid: process.pid,
      uptime: Math.round(process.uptime()),
      checks,
      ...(options.extra?.() || {}),
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options.port, '127.0.0.1');
  });

  log.info('health server listening', { role: options.role, port: options.port });

  return {
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
  };
}

export function createRedisHealthCheck(name: string): RedisHealthCheck {
  const redis = createResilientRedis(name, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
  });

  return {
    check: async () => {
      if (redis.status === 'wait' || redis.status === 'end') {
        await redis.connect();
      }
      const pong = await redis.ping();
      if (pong !== 'PONG') throw new Error(`unexpected redis ping response: ${pong}`);
      return 'ok';
    },
    close: async () => {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
    },
  };
}
