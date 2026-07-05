/**
 * Backfill session_token_hash for active web conversations.
 *
 * Назначение:
 *   Миграция 116 добавила NULLABLE поле conversations.session_token_hash.
 *   Этот скрипт генерирует валидный HMAC session token для каждой активной
 *   web-сессии и сохраняет его SHA-256 hash в БД.
 *
 *   Старые клиенты продолжают работать через legacy header (X-Session-Token),
 *   пока не ре-бутстрапнутся. После этого они получат новый токен + hash.
 *
 * Клиенту токен НЕ отправляется — он получит новый при следующем POST /sessions.
 *
 * Использование:
 *   # dry-run (показать план):
 *   cd /var/www/apimain/angular-dev && npx tsx backend/scripts/backfill-session-tokens.ts --dry-run
 *
 *   # реальный прогон:
 *   cd /var/www/apimain/angular-dev && npx tsx backend/scripts/backfill-session-tokens.ts
 *
 * Идемпотентен: пропускает сессии с уже заполненным session_token_hash.
 */

import 'dotenv/config';
import crypto from 'crypto';
import { Pool } from 'pg';

const dryRun = process.argv.includes('--dry-run');

const pool = new Pool({
  host: process.env['DB_HOST'] || '127.0.0.1',
  port: Number(process.env['DB_PORT']) || 5432,
  user: process.env['DB_USER'],
  password: process.env['DB_PASSWORD'],
  database: process.env['DB_NAME'],
});

function generateSessionToken(sessionId: string, visitorId: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${sessionId}:${visitorId}`).digest('base64url');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function main(): Promise<void> {
  // Матчим точную логику resolve-а из backend/src/config/index.ts:guestSession.secret:
  //   GUEST_SESSION_SECRET → JWT_SECRET + '_guest' → dev fallback.
  const secret =
    process.env['GUEST_SESSION_SECRET'] ||
    (process.env['JWT_SECRET'] ? process.env['JWT_SECRET'] + '_guest' : undefined);

  if (!secret) {
    console.error('[backfill] missing GUEST_SESSION_SECRET / JWT_SECRET in env');
    process.exit(1);
  }

  console.log(`[backfill] mode=${dryRun ? 'DRY-RUN' : 'APPLY'}`);

  const { rows } = await pool.query<{ id: string; visitor_id: string | null; status: string }>(
    `SELECT id, visitor_id, status
       FROM conversations
      WHERE channel = 'web'
        AND status IN ('open', 'waiting', 'active')
        AND session_token_hash IS NULL
        AND visitor_id IS NOT NULL
      ORDER BY updated_at DESC`
  );

  console.log(`[backfill] candidates: ${rows.length}`);

  if (rows.length === 0) {
    await pool.end();
    return;
  }

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.visitor_id) {
      skipped++;
      continue;
    }

    const token = generateSessionToken(row.id, row.visitor_id, secret);
    const hash = hashToken(token);

    if (dryRun) {
      console.log(`  [dry] ${row.id.slice(0, 8)}… status=${row.status} hash=${hash.slice(0, 12)}…`);
      updated++;
      continue;
    }

    try {
      await pool.query(
        `UPDATE conversations
            SET session_token_hash = $2
          WHERE id = $1
            AND session_token_hash IS NULL`,
        [row.id, hash]
      );
      updated++;
    } catch (err) {
      console.warn(`  [err] ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      skipped++;
    }
  }

  console.log(`[backfill] done — updated=${updated} skipped=${skipped}`);
  await pool.end();
}

main().catch((err: unknown) => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
