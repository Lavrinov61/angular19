#!/usr/bin/env tsx
/**
 * WhatsApp Webhook Setup Script
 * Shows current webhook subscriptions for the Meta app.
 *
 * Usage: npx tsx backend/scripts/webhook-setup-whatsapp.ts
 */

import 'dotenv/config';

const ACCESS_TOKEN = process.env['WHATSAPP_ACCESS_TOKEN'];
const APP_ID = process.env['META_APP_ID'] || '';

if (!ACCESS_TOKEN) {
  console.error('❌ WHATSAPP_ACCESS_TOKEN not set');
  process.exit(1);
}

async function getSubscriptions(): Promise<void> {
  if (!APP_ID) {
    console.warn('⚠️  META_APP_ID not set — showing phone number info instead');
    const phoneId = process.env['WHATSAPP_PHONE_NUMBER_ID'];
    if (phoneId) {
      const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}`, {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      });
      const data = await res.json();
      console.log('📱 WhatsApp Phone Number Info:');
      console.log(JSON.stringify(data, null, 2));
    }
    return;
  }

  const res = await fetch(`https://graph.facebook.com/v21.0/${APP_ID}/subscriptions`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  const data = await res.json();
  console.log('📡 WhatsApp/Meta App Subscriptions:');
  console.log(JSON.stringify(data, null, 2));
}

await getSubscriptions();
