#!/usr/bin/env tsx
/**
 * Telegram Webhook Setup Script
 * Sets webhook URL and displays current webhook info.
 *
 * Usage: npx tsx backend/scripts/webhook-setup-telegram.ts [set|info]
 */

import 'dotenv/config';

const BOT_TOKEN = process.env['TELEGRAM_BOT_TOKEN'];
const WEBHOOK_URL = process.env['TELEGRAM_WEBHOOK_URL'] || 'https://svoefoto.ru/api/webhooks/telegram';
const SECRET_TOKEN = process.env['TELEGRAM_WEBHOOK_SECRET'] || '';

if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN not set');
  process.exit(1);
}

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const action = process.argv[2] || 'info';

async function getWebhookInfo(): Promise<void> {
  const res = await fetch(`${API}/getWebhookInfo`);
  const data = await res.json();
  console.log('📡 Telegram Webhook Info:');
  console.log(JSON.stringify(data, null, 2));
}

async function setWebhook(): Promise<void> {
  const params: Record<string, string> = {
    url: WEBHOOK_URL,
    allowed_updates: JSON.stringify(['message', 'callback_query']),
    drop_pending_updates: 'true',
  };
  if (SECRET_TOKEN) params['secret_token'] = SECRET_TOKEN;

  const res = await fetch(`${API}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  console.log('✅ Telegram Webhook Set:');
  console.log(JSON.stringify(data, null, 2));
}

if (action === 'set') {
  await setWebhook();
} else {
  await getWebhookInfo();
}
