/**
 * One-shot script: retry all failed media_attachments.
 * 1. Removes duplicate failed rows (keeps one per message+original_url)
 * 2. Resets remaining failed rows to 'downloading'
 * 3. Enqueues BullMQ jobs for re-download
 *
 * Usage: npx tsx scripts/retry-failed-media.ts
 */
import 'dotenv/config';
import { Queue } from 'bullmq';
import { pool } from '../src/database/db.js';

const redisOpts = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
};

async function main() {
  // 1. Remove duplicate failed rows — keep only the oldest per (message_id, original_url)
  const deduped = await pool.query(`
    DELETE FROM media_attachments
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY message_id, original_url ORDER BY created_at) as rn
        FROM media_attachments
        WHERE processing_status = 'failed'
      ) sub WHERE rn > 1
    )
    RETURNING id
  `);
  console.log(`Removed ${deduped.rowCount} duplicate failed rows`);

  // 2. Get remaining failed attachments with conversation context
  const { rows } = await pool.query<{
    att_id: string;
    message_id: string;
    original_url: string;
    media_type: string;
    mime_type: string;
    conversation_id: string;
    channel: string;
    account_id: string;
  }>(`
    SELECT ma.id as att_id, ma.message_id, ma.original_url, ma.media_type, ma.mime_type,
           m.conversation_id, c.channel, c.account_id
    FROM media_attachments ma
    JOIN messages m ON m.id = ma.message_id
    JOIN conversations c ON c.id = m.conversation_id
    WHERE ma.processing_status IN ('failed', 'downloading') AND ma.s3_key = 'pending'
  `);

  if (rows.length === 0) {
    console.log('No failed media to retry');
    await pool.end();
    return;
  }

  console.log(`Found ${rows.length} failed media to retry`);

  // 3. Reset status to 'downloading'
  const ids = rows.map(r => r.att_id);
  await pool.query(
    `UPDATE media_attachments SET processing_status = 'downloading', s3_key = 'pending'
     WHERE id = ANY($1)`,
    [ids],
  );

  // 4. Enqueue BullMQ jobs
  const queue = new Queue('omni-media', { connection: redisOpts });

  for (const row of rows) {
    const jobId = await queue.add('process-media', {
      messageId: row.message_id,
      channel: row.channel,
      accountId: row.account_id,
      mediaRef: {
        sourceType: 'channel',
        sourceRef: row.original_url,
        mediaTypeHint: row.media_type,
        mimeHint: row.mime_type,
      },
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    });
    console.log(`Enqueued job ${jobId.id} for message ${row.message_id} (${row.media_type})`);
  }

  await queue.close();
  await pool.end();
  console.log('Done — media worker will process jobs');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
