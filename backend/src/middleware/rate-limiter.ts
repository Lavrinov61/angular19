import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../types/index.js';
import { getCrmRedis } from '../services/redis-cache.service.js';
import { AppError } from './errorHandler.js';
import { ErrorCode } from '../constants/error-codes.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('rate-limiter');

/**
 * Rate limiter middleware using Redis sliding window.
 * @param maxRequests - max requests per window
 * @param windowSec - window duration in seconds
 */
export function rateLimitCrm(maxRequests: number, windowSec: number) {
  return async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) { next(); return; }

    const redis = getCrmRedis();
    if (!redis) { next(); return; }

    const key = `rl:crm:${req.path}:${userId}`;
    try {
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, windowSec);
      }
      if (count > maxRequests) {
        throw new AppError(429, 'Слишком много запросов, попробуйте позже', ErrorCode.RATE_LIMITED);
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      log.debug('rate limiter redis error, allowing request', { error: String(err) });
    }
    next();
  };
}
