#!/usr/bin/env tsx
/**
 * MAX Bot Webhook Setup Script
 * Manages webhook subscription via MAX Bot API (platform-api.max.ru).
 *
 * Usage: npx tsx backend/scripts/webhook-setup-max.ts [info|set|delete]
 */

import 'dotenv/config';

const TOKEN = process.env['MAX_BOT_ACCESS_TOKEN'];
const SECRET = process.env['MAX_WEBHOOK_SECRET'] || '';
const WEBHOOK_URL = process.env['MAX_WEBHOOK_URL'] || 'https://svoefoto.ru/api/webhooks/max';
const API_URL = process.env['MAX_BOT_API_URL'] || 'https://platform-api.max.ru';

if (!TOKEN) {
  console.error('❌ MAX_BOT_ACCESS_TOKEN not set');
  process.exit(1);
}

const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  'Authorization': TOKEN,
};

const action = process.argv[2] || 'info';

async function getSubscriptions(): Promise<void> {
  const res = await fetch(`${API_URL}/subscriptions`, { headers });
  const data = await res.json();
  console.log('📡 MAX Bot Subscriptions:');
  console.log(JSON.stringify(data, null, 2));
}

async function setSubscription(): Promise<void> {
  const body = {
    url: WEBHOOK_URL,
    update_types: ['message_created', 'message_edited', 'bot_started'],
    ...(SECRET ? { secret: SECRET } : {}),
  };

  const res = await fetch(`${API_URL}/subscriptions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  console.log('✅ MAX Bot Webhook Set:');
  console.log(JSON.stringify(data, null, 2));
}

async function deleteSubscription(): Promise<void> {
  const res = await fetch(`${API_URL}/subscriptions`, {
    method: 'DELETE',
    headers,
  });

  if (res.status === 204) {
    console.log('🗑️  MAX Bot Webhook Deleted (204 No Content)');
    return;
  }

  const data = await res.json();
  console.log('🗑️  MAX Bot Webhook Delete:');
  console.log(JSON.stringify(data, null, 2));
}

if (action === 'set') {
  await setSubscription();
} else if (action === 'delete') {
  await deleteSubscription();
} else {
  await getSubscriptions();
}
