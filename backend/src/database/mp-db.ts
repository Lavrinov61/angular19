/**
 * Database pool for multiplatform_publication.
 *
 * Tracking data (ad_clicks, visitor_sessions, customer_touchpoints, purchases,
 * unified_customers, conversions) lives in multiplatform_publication,
 * NOT in magnus_photo_db (which is the default pool in db.ts).
 */

import pg from 'pg';
import { createLogger } from '../utils/logger.js';

const log = createLogger('mp-db');

const mpPool = new pg.Pool({
  host: process.env['MP_DB_HOST'] || process.env['DB_HOST'] || 'localhost',
  port: parseInt(process.env['MP_DB_PORT'] || process.env['DB_PORT'] || '6432', 10),
  database: 'multiplatform_publication',
  user: process.env['MP_DB_USER'] || process.env['DB_USER'] || 'magnus_user',
  password: process.env['MP_DB_PASSWORD'] || process.env['DB_PASSWORD'] || '',
  max: parseInt(process.env['MP_DB_POOL_MAX'] || '15', 10),
  min: parseInt(process.env['MP_DB_POOL_MIN'] || '2', 10),
  idleTimeoutMillis: parseInt(process.env['DB_POOL_IDLE_TIMEOUT_MS'] || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env['DB_POOL_CONNECTION_TIMEOUT_MS'] || '5000', 10),
  ssl: process.env['DB_SSL'] === 'true' ? { rejectUnauthorized: false } : false,
});

mpPool.on('error', (err) => {
  log.error('Unexpected error on idle multiplatform PG client', { error: err.message });
});

export async function mpQuery<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
  const start = Date.now();
  try {
    const res = await mpPool.query(text, params);
    log.info('MP query', { text: text.slice(0, 80), duration: Date.now() - start, rows: res.rowCount });
    return res.rows as T[];
  } catch (error) {
    log.error('MP query error', { text: text.slice(0, 80), error });
    throw error;
  }
}

export async function mpQueryWithTimeout<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
  timeoutMs = 5000,
): Promise<T[]> {
  const start = Date.now();
  const client = await mpPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${Math.max(100, Math.floor(timeoutMs))}`);
    const res = await client.query(text, params);
    await client.query('COMMIT');
    const duration = Date.now() - start;
    if (duration > timeoutMs * 0.5) {
      log.warn('mpQuery (timeout) slow', { sqlPreview: text.slice(0, 80), duration, timeoutMs });
    }
    return res.rows as T[];
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code;
    if (code === '57014' || /statement timeout/i.test(msg)) {
      log.warn('mpQuery timeout → returning []', { sqlPreview: text.slice(0, 80), timeoutMs });
      return [];
    }
    log.error('mpQuery (timeout) error', { sqlPreview: text.slice(0, 80), error: msg });
    throw err;
  } finally {
    client.release();
  }
}

export { mpPool };
