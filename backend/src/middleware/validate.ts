import { Request, Response, NextFunction } from 'express';
import type { ZodSchema, ZodError } from 'zod';
import { AppError } from './errorHandler.js';

/**
 * Express middleware factory for Zod request body validation.
 *
 * Usage:
 *   router.post('/endpoint', validate(mySchema), handler);
 *
 * On success: replaces req.body with the parsed (coerced/stripped) data.
 * On failure: throws AppError(400) with a human-readable message.
 */
export function validate<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const message = formatZodError(result.error);
      throw new AppError(400, message, 'VALIDATION_ERROR');
    }

    req.body = result.data;
    next();
  };
}

function formatZodError(error: ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'body';
    return `${path}: ${issue.message}`;
  });
  return issues.join('; ');
}
