#!/usr/bin/env node

// Remove proxy env vars before any fetch calls — HTTP/2 through proxy breaks Selectel API
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.http_proxy;
delete process.env.https_proxy;

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerDnsTools } from './tools/dns.js';
import { registerServerTools } from './tools/servers.js';
import { registerIamTools } from './tools/iam.js';
import { registerBillingTools } from './tools/billing.js';
import { registerTicketTools } from './tools/tickets.js';
import { registerNetworkTools } from './tools/network.js';
import { registerMobileFarmTools } from './tools/mobile-farm.js';
import { registerCertificateTools } from './tools/certificates.js';

const server = new McpServer({
  name: 'selectel',
  version: '1.0.0',
});

registerDnsTools(server);
registerServerTools(server);
registerIamTools(server);
registerBillingTools(server);
registerTicketTools(server);
registerNetworkTools(server);
registerMobileFarmTools(server);
registerCertificateTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
