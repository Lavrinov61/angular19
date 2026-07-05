import type { PoolConfig } from 'pg';
import type { RedisOptions } from 'ioredis';
import type { S3ClientConfig } from '@aws-sdk/client-s3';

export function getPgConfig(): PoolConfig {
  return {
    host: process.env['DB_HOST'] || 'localhost',
    port: Number.parseInt(process.env['DB_PORT'] || '6432', 10),
    database: process.env['DB_NAME'] || 'magnus_photo_db',
    user: process.env['DB_USER'] || 'magnus_user',
    password: process.env['DB_PASSWORD'] || '',
    ssl: process.env['DB_SSL'] === 'true' ? { rejectUnauthorized: false } : false,
    max: Number.parseInt(process.env['MCP_PG_POOL_MAX'] || '4', 10),
    idleTimeoutMillis: Number.parseInt(process.env['MCP_PG_IDLE_TIMEOUT_MS'] || '15000', 10),
    connectionTimeoutMillis: Number.parseInt(process.env['MCP_PG_CONNECT_TIMEOUT_MS'] || '5000', 10),
    statement_timeout: Number.parseInt(process.env['MCP_PG_STATEMENT_TIMEOUT_MS'] || '15000', 10),
    application_name: 'codex-mcp-angular-dev',
  };
}

export function getRedisConfig(): RedisOptions {
  return {
    host: process.env['REDIS_HOST'] || '127.0.0.1',
    port: Number.parseInt(process.env['REDIS_PORT'] || '6379', 10),
    password: process.env['REDIS_PASSWORD'] || undefined,
    tls: process.env['REDIS_TLS'] === 'true' ? {} : undefined,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 2,
    connectTimeout: Number.parseInt(process.env['MCP_REDIS_CONNECT_TIMEOUT_MS'] || '5000', 10),
  };
}

export function getS3Config(): S3ClientConfig {
  return {
    endpoint: process.env['S3_ENDPOINT'] || 'http://127.0.0.1:9000',
    region: process.env['S3_REGION'] || 'us-east-1',
    credentials: {
      accessKeyId: process.env['S3_ACCESS_KEY'] || '',
      secretAccessKey: process.env['S3_SECRET_KEY'] || '',
    },
    forcePathStyle: true,
  };
}

export function defaultS3Bucket(): string {
  return process.env['S3_BUCKET'] || 'svoefoto-photos';
}

export function s3PublicUrl(): string {
  return (process.env['S3_PUBLIC_URL'] || '').replace(/\/+$/, '');
}

export const POSTGRES_CONFIRM = 'RUN_DANGEROUS_POSTGRES';
export const REDIS_DELETE_CONFIRM = 'DELETE_REDIS_KEYS';
export const REDIS_EXPIRE_CONFIRM = 'EXPIRE_REDIS_KEY';
export const REDIS_SET_CONFIRM = 'SET_REDIS_KEY';
export const REDIS_COMMAND_CONFIRM = 'RUN_DANGEROUS_REDIS';
export const S3_DELETE_CONFIRM = 'DELETE_S3_OBJECTS';
export const S3_PRESIGN_PUT_CONFIRM = 'PRESIGN_S3_PUT';
