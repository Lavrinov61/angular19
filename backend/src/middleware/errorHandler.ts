import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger.js';
import { captureException } from '../utils/error-tracker.js';

const log = createLogger('error-handler');

/**
 * Типизированная ошибка с HTTP-статусом.
 * Express 5 автоматически ловит throw/rejected promises в async-хэндлерах
 * и пробрасывает в error middleware → сюда.
 *
 * @example
 *   throw new AppError(400, 'Name is required');
 *   throw new AppError(404, 'Order not found', 'order_not_found');
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Express 5 error middleware.
 * AppError → статус из ошибки + JSON.
 * Всё остальное → 500.
 */
export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof AppError) {
    // Track server-side AppErrors (5xx) — client errors (4xx) are expected
    if (err.statusCode >= 500) {
      captureException(err, {
        tags: { source: 'app-error' },
        extra: { statusCode: err.statusCode, code: err.code },
        level: 'error',
      });
    }

    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      ...(err.code && { code: err.code }),
    });
    return;
  }

  // Неожиданная ошибка — always track via error tracker
  captureException(err, {
    tags: { source: 'unhandled' },
    level: 'error',
  });
  log.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({
    success: false,
    error: process.env['NODE_ENV'] === 'production'
      ? 'Internal server error'
      : err.message || 'Internal server error',
  });
};

export const notFoundHandler = (
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
  });
};
