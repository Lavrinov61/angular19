import type { Request } from 'express';

/** Safely extract a string query parameter (Express 5 req.query is read-only Record<string, unknown>). */
export function queryString(req: Request, key: string, fallback = ''): string {
  const val = req.query[key];
  return typeof val === 'string' ? val : fallback;
}

/** Safely extract an integer query parameter. Returns fallback on missing/NaN. */
export function queryInt(req: Request, key: string, fallback = 0): number {
  const val = req.query[key];
  if (typeof val !== 'string') return fallback;
  const parsed = parseInt(val, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Safely extract a float query parameter. Returns fallback on missing/NaN. */
export function queryFloat(req: Request, key: string, fallback = 0): number {
  const val = req.query[key];
  if (typeof val !== 'string') return fallback;
  const parsed = parseFloat(val);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Safely extract a boolean query parameter ('true'/'1' → true, else false). */
export function queryBool(req: Request, key: string, fallback = false): boolean {
  const val = req.query[key];
  if (typeof val !== 'string') return fallback;
  return val === 'true' || val === '1';
}
