import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Redis } from 'ioredis';
import { z } from 'zod';
import {
  REDIS_COMMAND_CONFIRM,
  REDIS_DELETE_CONFIRM,
  REDIS_EXPIRE_CONFIRM,
  REDIS_SET_CONFIRM,
  getRedisConfig,
} from './config.js';
import { errorResponse, jsonResponse, toErrorMessage } from './response.js';

let redis: Redis = new Redis(getRedisConfig());

redis.on('error', (error: Error) => {
  console.error(`[mcp-angular-dev:redis] ${error.message}`);
});

export async function closeRedis(): Promise<void> {
  await redis.quit().catch(() => redis.disconnect());
}

export function registerRedisTools(server: McpServer): void {
  server.tool('redis_ping', 'Ping Redis and return server response.', {}, async () => {
    try {
      const client = await getRedis();
      return jsonResponse({ pong: await client.ping() });
    } catch (error) {
      return errorResponse(toErrorMessage(error));
    }
  });

  server.tool(
    'redis_scan',
    'SCAN Redis keys by pattern with optional TYPE filter. Returns a bounded page plus next cursor.',
    {
      pattern: z.string().optional().default('*'),
      cursor: z.string().optional().default('0'),
      count: z.number().int().min(1).max(1000).optional().default(100),
      limit: z.number().int().min(1).max(5000).optional().default(500),
      type: z.string().optional(),
    },
    async ({ pattern, cursor, count, limit, type }) => {
      try {
        const client = await getRedis();
        const keys: string[] = [];
        let nextCursor = cursor;
        let iterations = 0;

        do {
          const args = ['MATCH', pattern, 'COUNT', String(count)];
          if (type) args.push('TYPE', type);
          const [newCursor, batch] = (await client.call('SCAN', nextCursor, ...args)) as [string, string[]];
          nextCursor = newCursor;
          keys.push(...batch);
          iterations += 1;
        } while (nextCursor !== '0' && keys.length < limit && iterations < 1000);

        return jsonResponse({
          cursor: nextCursor,
          returned: Math.min(keys.length, limit),
          truncated: keys.length > limit,
          keys: keys.slice(0, limit),
        });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'redis_key_info',
    'Show Redis key diagnostics: TYPE, TTL/PTTL, MEMORY USAGE, OBJECT ENCODING, and collection length.',
    {
      key: z.string().min(1),
    },
    async ({ key }) => {
      try {
        const client = await getRedis();
        const type = await client.type(key);
        if (type === 'none') return jsonResponse({ key, exists: false, type });

        const [ttl, pttl, memoryUsage, encoding, length] = await Promise.all([
          client.ttl(key),
          client.pttl(key),
          client.call('MEMORY', 'USAGE', key).catch(() => null),
          client.call('OBJECT', 'ENCODING', key).catch(() => null),
          redisLength(client, key, type),
        ]);

        return jsonResponse({
          key,
          exists: true,
          type,
          ttlSeconds: ttl,
          pttlMs: pttl,
          memoryUsageBytes: memoryUsage,
          encoding,
          length,
        });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'redis_info',
    'Run Redis INFO and return parsed sections. Section examples: server, clients, memory, stats, replication, commandstats.',
    {
      section: z.string().optional(),
    },
    async ({ section }) => {
      try {
        const client = await getRedis();
        const info = section ? await client.info(section) : await client.info();
        return jsonResponse(parseRedisInfo(info));
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'redis_get_value',
    'Read a Redis key using the command appropriate for its TYPE. Output is bounded for collections.',
    {
      key: z.string().min(1),
      start: z.number().int().optional().default(0),
      stop: z.number().int().optional().default(99),
      count: z.number().int().min(1).max(1000).optional().default(100),
    },
    async ({ key, start, stop, count }) => {
      try {
        const client = await getRedis();
        const type = await client.type(key);
        if (type === 'none') return jsonResponse({ key, exists: false, type });

        if (type === 'string') return jsonResponse({ key, type, value: await client.get(key) });
        if (type === 'hash') return jsonResponse({ key, type, value: limitObject(await client.hgetall(key), count) });
        if (type === 'list') return jsonResponse({ key, type, value: await client.lrange(key, start, stop) });
        if (type === 'set') return jsonResponse({ key, type, value: limitArray(await client.smembers(key), count) });
        if (type === 'zset') return jsonResponse({ key, type, value: parseZrange(await client.zrange(key, start, stop, 'WITHSCORES')) });
        if (type === 'stream') return jsonResponse({ key, type, value: await client.xrange(key, '-', '+', 'COUNT', count) });

        return jsonResponse({ key, type, value: await client.dump(key) });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'redis_get_string',
    'GET a Redis string key.',
    { key: z.string().min(1) },
    async ({ key }) => {
      try {
        const client = await getRedis();
        await assertRedisType(client, key, 'string');
        return jsonResponse({ key, value: await client.get(key) });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'redis_hgetall',
    'HGETALL a Redis hash key.',
    {
      key: z.string().min(1),
      maxFields: z.number().int().min(1).max(5000).optional().default(500),
    },
    async ({ key, maxFields }) => {
      try {
        const client = await getRedis();
        await assertRedisType(client, key, 'hash');
        const value = await client.hgetall(key);
        return jsonResponse({ key, totalFields: Object.keys(value).length, value: limitObject(value, maxFields) });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'redis_lrange',
    'LRANGE a Redis list key.',
    {
      key: z.string().min(1),
      start: z.number().int().optional().default(0),
      stop: z.number().int().optional().default(99),
    },
    async ({ key, start, stop }) => {
      try {
        const client = await getRedis();
        await assertRedisType(client, key, 'list');
        return jsonResponse({ key, value: await client.lrange(key, start, stop) });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'redis_smembers',
    'SMEMBERS a Redis set key, with bounded output.',
    {
      key: z.string().min(1),
      limit: z.number().int().min(1).max(5000).optional().default(500),
    },
    async ({ key, limit }) => {
      try {
        const client = await getRedis();
        await assertRedisType(client, key, 'set');
        const members = await client.smembers(key);
        return jsonResponse({ key, totalMembers: members.length, value: limitArray(members, limit) });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'redis_zrange',
    'ZRANGE a Redis sorted set key.',
    {
      key: z.string().min(1),
      start: z.number().int().optional().default(0),
      stop: z.number().int().optional().default(99),
      withScores: z.boolean().optional().default(true),
    },
    async ({ key, start, stop, withScores }) => {
      try {
        const client = await getRedis();
        await assertRedisType(client, key, 'zset');
        const value = withScores
          ? parseZrange(await client.zrange(key, start, stop, 'WITHSCORES'))
          : await client.zrange(key, start, stop);
        return jsonResponse({ key, value });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'redis_xinfo',
    'XINFO STREAM/GROUPS/CONSUMERS for a Redis stream key.',
    {
      key: z.string().min(1),
      mode: z.enum(['stream', 'groups', 'consumers']).optional().default('stream'),
      group: z.string().optional(),
    },
    async ({ key, mode, group }) => {
      try {
        const client = await getRedis();
        await assertRedisType(client, key, 'stream');
        if (mode === 'stream') return jsonResponse({ key, mode, value: replyToObject(await client.call('XINFO', 'STREAM', key)) });
        if (mode === 'groups') return jsonResponse({ key, mode, value: await client.call('XINFO', 'GROUPS', key) });
        if (!group) return errorResponse('group is required when mode="consumers".');
        return jsonResponse({ key, mode, group, value: await client.call('XINFO', 'CONSUMERS', key, group) });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'redis_xrange',
    'XRANGE a Redis stream key.',
    {
      key: z.string().min(1),
      start: z.string().optional().default('-'),
      end: z.string().optional().default('+'),
      count: z.number().int().min(1).max(1000).optional().default(100),
    },
    async ({ key, start, end, count }) => {
      try {
        const client = await getRedis();
        await assertRedisType(client, key, 'stream');
        return jsonResponse({ key, value: await client.xrange(key, start, end, 'COUNT', count) });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'redis_bullmq_stats',
    'Discover BullMQ queues and return queue depth by state. Default prefix is "bull".',
    {
      prefix: z.string().optional().default('bull'),
      queue: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional().default(50),
    },
    async ({ prefix, queue, limit }) => {
      try {
        const client = await getRedis();
        const queues = queue ? [queue] : await discoverBullQueues(client, prefix, limit);
        const stats = [];
        for (const queueName of queues) {
          stats.push(await bullQueueStats(client, prefix, queueName));
        }
        return jsonResponse({ prefix, discoveredQueues: queues.length, queues: stats });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'redis_set',
    `DANGEROUS: SET a Redis key. Requires confirm="${REDIS_SET_CONFIRM}".`,
    {
      key: z.string().min(1),
      value: z.string(),
      expireSeconds: z.number().int().min(1).optional(),
      confirm: z.string().optional().default(''),
    },
    async ({ key, value, expireSeconds, confirm }) => {
      if (confirm !== REDIS_SET_CONFIRM) {
        return errorResponse(`Refusing to SET. Pass confirm="${REDIS_SET_CONFIRM}".`);
      }
      try {
        const client = await getRedis();
        if (expireSeconds) {
          await client.set(key, value, 'EX', expireSeconds);
        } else {
          await client.set(key, value);
        }
        return jsonResponse({ key, result: 'OK', expireSeconds: expireSeconds ?? null });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'redis_expire',
    `DANGEROUS: EXPIRE/PERSIST a Redis key. Requires confirm="${REDIS_EXPIRE_CONFIRM}".`,
    {
      key: z.string().min(1),
      seconds: z.number().int().min(-1),
      confirm: z.string().optional().default(''),
    },
    async ({ key, seconds, confirm }) => {
      if (confirm !== REDIS_EXPIRE_CONFIRM) {
        return errorResponse(`Refusing to change TTL. Pass confirm="${REDIS_EXPIRE_CONFIRM}".`);
      }
      try {
        const client = await getRedis();
        const result = seconds < 0 ? await client.persist(key) : await client.expire(key, seconds);
        return jsonResponse({ key, seconds, changed: result === 1 });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'redis_del',
    `DANGEROUS: DEL Redis keys. Requires confirm="${REDIS_DELETE_CONFIRM}".`,
    {
      keys: z.array(z.string().min(1)).min(1).max(1000),
      confirm: z.string().optional().default(''),
    },
    async ({ keys, confirm }) => {
      if (confirm !== REDIS_DELETE_CONFIRM) {
        return errorResponse(`Refusing to delete keys. Pass confirm="${REDIS_DELETE_CONFIRM}".`);
      }
      try {
        const client = await getRedis();
        return jsonResponse({ deleted: await client.del(...keys), keys });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'redis_admin_command',
    `DANGEROUS: run an arbitrary Redis command. Requires confirm="${REDIS_COMMAND_CONFIRM}".`,
    {
      command: z.array(z.string()).min(1).max(64),
      confirm: z.string().optional().default(''),
    },
    async ({ command, confirm }) => {
      if (confirm !== REDIS_COMMAND_CONFIRM) {
        return errorResponse(`Refusing to run arbitrary Redis command. Pass confirm="${REDIS_COMMAND_CONFIRM}".`);
      }
      try {
        const client = await getRedis();
        const [name, ...args] = command;
        const result = await client.call(name, ...args);
        return jsonResponse({ command, result: normalizeRedisReply(result) });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );
}

async function getRedis(): Promise<Redis> {
  if (redis.status === 'end') {
    redis = new Redis(getRedisConfig());
  }

  if (redis.status === 'ready') return redis;

  if (redis.status === 'wait' || redis.status === 'close') {
    await redis.connect();
    return redis;
  }

  await redis.ping();
  return redis;
}

async function assertRedisType(client: Redis, key: string, expected: string): Promise<void> {
  const actual = await client.type(key);
  if (actual === 'none') throw new Error(`Key not found: ${key}`);
  if (actual !== expected) throw new Error(`Wrong Redis type for ${key}: expected ${expected}, got ${actual}`);
}

async function redisLength(client: Redis, key: string, type: string): Promise<number | null> {
  if (type === 'string') return client.strlen(key);
  if (type === 'hash') return client.hlen(key);
  if (type === 'list') return client.llen(key);
  if (type === 'set') return client.scard(key);
  if (type === 'zset') return client.zcard(key);
  if (type === 'stream') return client.xlen(key);
  return null;
}

function parseRedisInfo(info: string): Record<string, Record<string, string>> {
  const parsed: Record<string, Record<string, string>> = {};
  let section = 'default';

  for (const rawLine of info.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      section = line.slice(1).trim().toLowerCase().replace(/\s+/g, '_') || 'default';
      parsed[section] ??= {};
      continue;
    }
    const index = line.indexOf(':');
    if (index === -1) continue;
    parsed[section] ??= {};
    parsed[section][line.slice(0, index)] = line.slice(index + 1);
  }

  return parsed;
}

function limitArray<T>(items: T[], limit: number): { returned: number; total: number; truncated: boolean; items: T[] } {
  return {
    returned: Math.min(items.length, limit),
    total: items.length,
    truncated: items.length > limit,
    items: items.slice(0, limit),
  };
}

function limitObject(value: Record<string, string>, limit: number) {
  const entries = Object.entries(value);
  return {
    returned: Math.min(entries.length, limit),
    total: entries.length,
    truncated: entries.length > limit,
    fields: Object.fromEntries(entries.slice(0, limit)),
  };
}

function parseZrange(values: string[]): Array<{ member: string; score: number }> {
  const parsed: Array<{ member: string; score: number }> = [];
  for (let i = 0; i < values.length; i += 2) {
    parsed.push({ member: values[i] ?? '', score: Number(values[i + 1] ?? 0) });
  }
  return parsed;
}

function replyToObject(reply: unknown): unknown {
  if (!Array.isArray(reply)) return normalizeRedisReply(reply);
  const result: Record<string, unknown> = {};
  for (let i = 0; i < reply.length; i += 2) {
    const key = String(reply[i]);
    result[key] = normalizeRedisReply(reply[i + 1]);
  }
  return result;
}

function normalizeRedisReply(reply: unknown): unknown {
  if (Buffer.isBuffer(reply)) return reply.toString('utf8');
  if (Array.isArray(reply)) return reply.map(normalizeRedisReply);
  if (reply && typeof reply === 'object') {
    return Object.fromEntries(Object.entries(reply).map(([key, value]) => [key, normalizeRedisReply(value)]));
  }
  return reply;
}

async function discoverBullQueues(client: Redis, prefix: string, limit: number): Promise<string[]> {
  const queues = new Set<string>();
  let cursor = '0';
  let iterations = 0;
  const match = `${prefix}:*:*`;

  do {
    const [nextCursor, keys] = (await client.call('SCAN', cursor, 'MATCH', match, 'COUNT', '500')) as [string, string[]];
    cursor = nextCursor;
    for (const key of keys) {
      const rest = key.slice(prefix.length + 1);
      const queueName = rest.split(':')[0];
      if (queueName) queues.add(queueName);
      if (queues.size >= limit) break;
    }
    iterations += 1;
  } while (cursor !== '0' && queues.size < limit && iterations < 1000);

  return [...queues].sort();
}

async function bullQueueStats(client: Redis, prefix: string, queue: string) {
  const base = `${prefix}:${queue}`;
  const states = [
    'wait',
    'waiting',
    'paused',
    'active',
    'delayed',
    'prioritized',
    'waiting-children',
    'completed',
    'failed',
    'repeat',
    'events',
  ];
  const counts: Record<string, number | null> = {};

  for (const state of states) {
    const key = `${base}:${state}`;
    const type = await client.type(key);
    counts[state] = type === 'none' ? 0 : await redisLength(client, key, type);
  }

  const [meta, lastId, markerType, markerTtl] = await Promise.all([
    client.hgetall(`${base}:meta`).catch(() => ({})),
    client.get(`${base}:id`).catch(() => null),
    client.type(`${base}:marker`).catch(() => 'none'),
    client.ttl(`${base}:marker`).catch(() => -2),
  ]);

  return {
    queue,
    base,
    counts,
    meta,
    lastJobId: lastId,
    marker: { type: markerType, ttlSeconds: markerTtl },
  };
}
