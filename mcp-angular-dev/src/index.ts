#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { closePostgres, registerPostgresTools } from './postgres.js';
import { closeRedis, registerRedisTools } from './redis.js';
import { closeS3, registerS3Tools } from './s3.js';

const server = new McpServer({
  name: 'angular-dev-data',
  version: '1.0.0',
});

registerPostgresTools(server);
registerRedisTools(server);
registerS3Tools(server);

async function shutdown(signal: string): Promise<void> {
  console.error(`[mcp-angular-dev] received ${signal}, closing connections`);
  closeS3();
  await Promise.allSettled([closePostgres(), closeRedis()]);
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

const transport = new StdioServerTransport();
await server.connect(transport);
