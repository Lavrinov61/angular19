#!/usr/bin/env tsx
/**
 * Instagram Webhook Setup Script
 * Shows current webhook subscriptions for the Instagram app.
 *
 * Usage: npx tsx backend/scripts/webhook-setup-instagram.ts
 */

import 'dotenv/config';

const ACCESS_TOKEN = process.env['INSTAGRAM_ACCESS_TOKEN'];
const BUSINESS_ACCOUNT_ID = process.env['INSTAGRAM_BUSINESS_ACCOUNT_ID'] || '';

if (!ACCESS_TOKEN) {
  console.error('❌ INSTAGRAM_ACCESS_TOKEN not set');
  process.exit(1);
}

async function getInfo(): Promise<void> {
  if (BUSINESS_ACCOUNT_ID) {
    const res = await fetch(`https://graph.facebook.com/v21.0/${BUSINESS_ACCOUNT_ID}?fields=id,name,username,ig_id`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    const data = await res.json();
    console.log('📡 Instagram Business Account:');
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.warn('⚠️  INSTAGRAM_BUSINESS_ACCOUNT_ID not set');
  }

  // Debug token info
  const debugRes = await fetch(`https://graph.facebook.com/debug_token?input_token=${ACCESS_TOKEN}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  const debugData = await debugRes.json();
  console.log('\n🔑 Token Debug Info:');
  console.log(JSON.stringify(debugData, null, 2));
}

await getInfo();
