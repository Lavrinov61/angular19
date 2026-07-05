#!/usr/bin/env tsx
/**
 * VK Callback API Setup Script
 * Shows current callback servers for the group.
 *
 * Usage: npx tsx backend/scripts/webhook-setup-vk.ts
 */

import 'dotenv/config';

const GROUP_TOKEN = process.env['VK_GROUP_TOKEN'];
const GROUP_ID = process.env['VK_GROUP_ID'];

if (!GROUP_TOKEN || !GROUP_ID) {
  console.error('❌ VK_GROUP_TOKEN or VK_GROUP_ID not set');
  process.exit(1);
}

const API = 'https://api.vk.com/method';

async function getCallbackServers(): Promise<void> {
  const params = new URLSearchParams({
    group_id: GROUP_ID!,
    access_token: GROUP_TOKEN!,
    v: '5.199',
  });
  const res = await fetch(`${API}/groups.getCallbackServers?${params}`);
  const data = await res.json();
  console.log('📡 VK Callback Servers:');
  console.log(JSON.stringify(data, null, 2));
}

await getCallbackServers();
