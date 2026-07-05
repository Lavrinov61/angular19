import { Pool, PoolClient } from 'pg';
import { config } from '../config/index.js';

import { createLogger } from '../utils/logger.js';

const logger = createLogger('db');

class Database {
  private pool: Pool;
  private static instance: Database;
  private constructor() {
    const { pool: poolCfg } = config.database;

    this.pool = new Pool({
      host: config.database.host,
      port: config.database.port,
      database: config.database.database,
      user: config.database.user,
      password: String(config.database.password || ''),
      max: poolCfg.max,
      idleTimeoutMillis: poolCfg.idleTimeoutMillis,
      connectionTimeoutMillis: poolCfg.connectionTimeoutMillis,
      query_timeout: poolCfg.statementTimeoutMs,
      ssl: config.database.ssl || false,
    });

    this.pool.on('error', (err) => {
      // Idle client errors are NOT fatal — PG auto-reconnects on next acquire.
      // Log and continue; do NOT call process.exit here.
      logger.error('[Database] Unexpected error on idle PG client:', {
        message: err.message,
        code: (err as NodeJS.ErrnoException).code,
        stack: err.stack,
      });
    });

    logger.info(`[Database] Pool created: max=${poolCfg.max}, connTimeout=${poolCfg.connectionTimeoutMillis}ms, idle=${poolCfg.idleTimeoutMillis}ms, stmtTimeout=${poolCfg.statementTimeoutMs}ms`);
  }

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  public async query<T = any>(text: string, params?: any[]): Promise<T[]> {
    const start = Date.now();
    try {
      const res = await this.pool.query(text, params);
      const duration = Date.now() - start;
      logger.info('Executed query', { text, duration, rows: res.rowCount });
      return res.rows as T[];
    } catch (error) {
      logger.error('Database query error', { text, error });
      throw error;
    }
  }

  public async queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows.length > 0 ? rows[0] : null;
  }

  public async getClient(): Promise<PoolClient> {
    return await this.pool.connect();
  }

  public async transaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  public getPool(): Pool {
    return this.pool;
  }
}

const db = Database.getInstance();
export const pool = db.getPool();
export default db;
