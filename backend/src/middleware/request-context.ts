/**
 * Request Context middleware — AsyncLocalStorage-based correlation IDs.
 *
 * Provides per-request logger with `requestId` binding.
 * `getRequestLogger()` returns the same Logger interface as `createLogger()`.
 * Falls back to a root-level logger outside of request context.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { createLogger, createChildLogger, type Logger } from '../utils/logger.js';

interface RequestContext {
  requestId: string;
  logger: Logger;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

const fallbackLogger = createLogger('app');

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();
  const logger = createChildLogger({ requestId });

  res.setHeader('X-Request-Id', requestId);

  asyncLocalStorage.run({ requestId, logger }, () => {
    next();
  });
}

export function getRequestLogger(): Logger {
  return asyncLocalStorage.getStore()?.logger ?? fallbackLogger;
}

export function getRequestId(): string | undefined {
  return asyncLocalStorage.getStore()?.requestId;
}

/**
 * Run a function within a request context (for background workers).
 *
 * BullMQ workers, Redis subscribers, and other non-HTTP entry points
 * call this to restore requestId into AsyncLocalStorage so that
 * `getRequestId()` and `getRequestLogger()` work throughout the call tree.
 *
 * If no requestId is provided, a new UUID is generated.
 */
export function runWithRequestId<T>(requestId: string | undefined, fn: () => T): T {
  const id = requestId || randomUUID();
  const logger = createChildLogger({ requestId: id });
  return asyncLocalStorage.run({ requestId: id, logger }, fn);
}
