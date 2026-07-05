#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerSobornyTools } from './tools.js';

const server = new McpServer({
  name: 'soborny-admin',
  version: '1.0.0',
});

registerSobornyTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
