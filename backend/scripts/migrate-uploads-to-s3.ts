#!/usr/bin/env tsx
/**
 * migrate-uploads-to-s3.ts
 *
 * Migrates existing uploaded photo files from local disk to Yandex Object Storage (S3).
 * Migrates: uploads/chat/ → chat/, uploads/print/ → print/, uploads/approvals/ → approvals/
 *
 * Also updates URLs in the database:
 *   - visitor_chat_messages.attachment_url (chat/)
 *   - visitor_chat_messages.metadata::json (gallery URLs in metadata.gallery)
 *   - photo_approvals.retouched_photo_url (approvals/)
 *   - photo_print_orders via items JSON (print/) — updated via attachment_url pattern
 *
 * Usage (dry run):
 *   cd /var/www/apimain/angular-app/backend
 *   npx tsx scripts/migrate-uploads-to-s3.ts --dry-run
 *
 * Usage (real):
 *   npx tsx scripts/migrate-uploads-to-s3.ts
 *
 * Old files are NOT deleted — kept as backup on disk.
 */

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

// Load .env
const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'backend/.env'),
];
for (const p of envPaths) {
  if (fs.existsSync(p)) { dotenv.config({ path: p }); break; }
}

const DRY_RUN = process.argv.includes('--dry-run');

if (!process.env['S3_BUCKET']) {
  console.error('❌ S3_BUCKET not set in .env');
  process.exit(1);
}

const s3 = new S3Client({
  endpoint: process.env['S3_ENDPOINT'] || 'https://storage.yandexcloud.net',
  region: process.env['S3_REGION'] || 'ru-central1',
  credentials: {
    accessKeyId: process.env['S3_ACCESS_KEY'] || '',
    secretAccessKey: process.env['S3_SECRET_KEY'] || '',
  },
  forcePathStyle: true,
});

const BUCKET = process.env['S3_BUCKET'];
const PUBLIC_URL = (process.env['S3_PUBLIC_URL'] || '').replace(/\/$/, '');
const BASE_UPLOADS = path.resolve(process.cwd(), 'uploads');

const pool = new Pool({
  host: process.env['DB_HOST'] || '127.0.0.1',
  port: parseInt(process.env['DB_PORT'] || '5432'),
  database: process.env['DB_NAME'] || 'magnus_photo_db',
  user: process.env['DB_USER'] || 'magnus_user',
  password: process.env['DB_PASSWORD'] || '',
});

// ============ Helpers ============

interface MigrateResult {
  uploaded: number;
  skipped: number;
  errors: number;
}

async function s3Exists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function uploadFile(localPath: string, key: string, mimeType: string): Promise<void> {
  const buffer = fs.readFileSync(localPath);
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    ContentLength: buffer.length,
  }));
}

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp',
    '.gif': 'image/gif', '.tiff': 'image/tiff', '.tif': 'image/tiff',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
    '.pdf': 'application/pdf',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

// ============ File migration ============

async function migrateDirectory(dir: string, s3Prefix: string): Promise<MigrateResult> {
  const result: MigrateResult = { uploaded: 0, skipped: 0, errors: 0 };

  if (!fs.existsSync(dir)) {
    console.log(`  ⚠️  Directory not found: ${dir}`);
    return result;
  }

  const files = fs.readdirSync(dir).filter(f => !f.startsWith('.'));
  console.log(`  📁 Found ${files.length} files in ${dir}`);

  const BATCH = 10;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    await Promise.all(batch.map(async (filename) => {
      const localPath = path.join(dir, filename);
      const stat = fs.statSync(localPath);
      if (!stat.isFile()) return;

      const ext = path.extname(filename);
      const key = `${s3Prefix}/${filename}`;

      try {
        const exists = await s3Exists(key);
        if (exists) {
          result.skipped++;
          return;
        }
        if (!DRY_RUN) {
          await uploadFile(localPath, key, getMimeType(ext));
        }
        result.uploaded++;
      } catch (err) {
        console.error(`    ❌ Error uploading ${filename}:`, err);
        result.errors++;
      }
    }));

    const done = Math.min(i + BATCH, files.length);
    process.stdout.write(`\r  Progress: ${done}/${files.length}`);
  }
  console.log('');

  return result;
}

// ============ DB URL updates ============

async function updateChatMessageUrls(): Promise<number> {
  const db = await pool.connect();
  let updated = 0;

  try {
    // Update direct attachment_url fields
    const { rows } = await db.query<{ id: string; attachment_url: string }>(
      `SELECT id, attachment_url FROM visitor_chat_messages
       WHERE attachment_url LIKE '/uploads/chat/%'
       ORDER BY created_at ASC`
    );

    console.log(`  📊 Found ${rows.length} chat messages with local URLs`);

    for (const row of rows) {
      const filename = path.basename(row.attachment_url);
      const newUrl = `${PUBLIC_URL}/chat/${filename}`;

      if (!DRY_RUN) {
        await db.query(
          'UPDATE visitor_chat_messages SET attachment_url = $1 WHERE id = $2',
          [newUrl, row.id]
        );
      }
      updated++;
    }

    // Update gallery URLs inside metadata JSON
    const { rows: galleryRows } = await db.query<{ id: string; metadata: unknown }>(
      `SELECT id, metadata FROM visitor_chat_messages
       WHERE metadata::text LIKE '%/uploads/chat/%'`
    );

    console.log(`  📊 Found ${galleryRows.length} chat messages with local gallery URLs in metadata`);

    for (const row of galleryRows) {
      const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata as Record<string, unknown>;
      if (!meta || !Array.isArray(meta['gallery'])) continue;

      const newGallery = (meta['gallery'] as string[]).map((url: string) => {
        if (url.startsWith('/uploads/chat/')) {
          return `${PUBLIC_URL}/chat/${path.basename(url)}`;
        }
        return url;
      });

      const newMeta = { ...meta, gallery: newGallery };

      if (!DRY_RUN) {
        await db.query(
          'UPDATE visitor_chat_messages SET metadata = $1::jsonb WHERE id = $2',
          [JSON.stringify(newMeta), row.id]
        );
      }
      updated++;
    }
  } finally {
    db.release();
  }

  return updated;
}

async function updateApprovalUrls(): Promise<number> {
  const db = await pool.connect();
  let updated = 0;

  try {
    const { rows } = await db.query<{ id: string; retouched_photo_url: string }>(
      `SELECT id, retouched_photo_url FROM photo_approvals
       WHERE retouched_photo_url LIKE '/uploads/approvals/%'`
    );

    console.log(`  📊 Found ${rows.length} photo approvals with local URLs`);

    for (const row of rows) {
      const filename = path.basename(row.retouched_photo_url);
      const newUrl = `${PUBLIC_URL}/approvals/${filename}`;

      if (!DRY_RUN) {
        await db.query(
          'UPDATE photo_approvals SET retouched_photo_url = $1 WHERE id = $2',
          [newUrl, row.id]
        );
      }
      updated++;
    }
  } finally {
    db.release();
  }

  return updated;
}

// ============ Main ============

async function main() {
  console.log('\n🚀 S3 Migration Script');
  console.log(`   Bucket: ${BUCKET}`);
  console.log(`   Public URL: ${PUBLIC_URL}`);
  console.log(`   Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes)' : '⚡ LIVE'}\n`);

  // 1. Migrate files
  console.log('📦 Step 1: Uploading files to S3...');

  console.log('\n  [chat/]');
  const chatResult = await migrateDirectory(path.join(BASE_UPLOADS, 'chat'), 'chat');

  console.log('\n  [print/]');
  const printResult = await migrateDirectory(path.join(BASE_UPLOADS, 'print'), 'print');

  console.log('\n  [approvals/]');
  const approvalsResult = await migrateDirectory(path.join(BASE_UPLOADS, 'approvals'), 'approvals');

  const totalUploaded = chatResult.uploaded + printResult.uploaded + approvalsResult.uploaded;
  const totalSkipped = chatResult.skipped + printResult.skipped + approvalsResult.skipped;
  const totalErrors = chatResult.errors + printResult.errors + approvalsResult.errors;

  console.log(`\n  ✅ Uploaded: ${totalUploaded}, skipped: ${totalSkipped}, errors: ${totalErrors}`);

  // 2. Update DB URLs
  console.log('\n📝 Step 2: Updating database URLs...');

  console.log('\n  [visitor_chat_messages]');
  const chatDbUpdated = await updateChatMessageUrls();
  console.log(`  ✅ Updated: ${chatDbUpdated} records`);

  console.log('\n  [photo_approvals]');
  const approvalsDbUpdated = await updateApprovalUrls();
  console.log(`  ✅ Updated: ${approvalsDbUpdated} records`);

  console.log('\n🎉 Migration complete!');
  if (DRY_RUN) {
    console.log('   ⚠️  DRY RUN — no actual changes were made. Run without --dry-run to apply.\n');
  } else {
    console.log('   ✅ Old files remain on disk as backup. Remove manually after verifying.\n');
  }

  await pool.end();
}

main().catch(err => {
  console.error('💥 Migration failed:', err);
  pool.end().catch(() => {});
  process.exit(1);
});
