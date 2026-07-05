/**
 * Re-parse existing email_messages that contain raw MIME content.
 * Finds emails where body_text contains MIME markers (Content-Type, base64)
 * and re-parses them using mailparser.
 *
 * Usage: cd backend && npx tsx scripts/reparse-emails.ts
 */

import 'dotenv/config';
import pg from 'pg';
import { simpleParser } from 'mailparser';
import sanitizeHtml from 'sanitize-html';
import { fixMimeCharset } from '../src/utils/charset-utils.js';

const pool = new pg.Pool({
  host: process.env['DB_HOST'],
  port: parseInt(process.env['DB_PORT'] || '6432'),
  database: process.env['DB_NAME'],
  user: process.env['DB_USER'],
  password: process.env['DB_PASSWORD'],
  ssl: process.env['DB_SSL'] === 'true' ? { rejectUnauthorized: false } : false,
});

function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowVulnerableTags: true,
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'img', 'style', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
      'caption', 'colgroup', 'col', 'center', 'span', 'div', 'font',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      '*': ['style', 'class', 'id', 'dir', 'lang'],
      img: ['src', 'alt', 'width', 'height', 'title'],
      a: ['href', 'target', 'rel', 'title'],
      td: ['colspan', 'rowspan', 'align', 'valign', 'width', 'height', 'bgcolor'],
      th: ['colspan', 'rowspan', 'align', 'valign', 'width', 'height', 'bgcolor'],
      table: ['cellpadding', 'cellspacing', 'border', 'width', 'bgcolor', 'align'],
      font: ['color', 'size', 'face'],
    },
    allowedSchemes: ['https', 'http', 'data', 'cid'],
  });
}

async function main() {
  console.log('[reparse] Looking for emails with raw MIME content...');

  const { rows: broken } = await pool.query<{ id: number; body_text: string }>(
    `SELECT id, body_text FROM email_messages
     WHERE body_text IS NOT NULL
       AND (body_text LIKE '%Content-Type:%' OR body_text LIKE '%base64%' OR body_text LIKE '%--=_%'
            OR body_text ~ '[\x80-\xFF]{5,}'
            OR (body_text LIKE '%Content-Type:%' AND body_text LIKE '%boundary%'))
     ORDER BY id`
  );

  console.log(`[reparse] Found ${broken.length} emails to re-parse`);

  let fixed = 0;
  let failed = 0;

  for (const row of broken) {
    try {
      // Try to parse body_text as raw MIME source, with charset fix for Cyrillic
      const rawBuffer = Buffer.from(row.body_text, 'utf-8');
      const fixedBuffer = fixMimeCharset(rawBuffer);
      const parsed = await simpleParser(fixedBuffer);

      const newText = parsed.text?.slice(0, 50000) || null;
      const newHtml = parsed.html ? sanitizeEmailHtml(parsed.html) : null;

      // Only update if we actually got decoded content
      if (newText || newHtml) {
        await pool.query(
          `UPDATE email_messages SET body_text = $1, body_html = $2, updated_at = NOW() WHERE id = $3`,
          [newText, newHtml, row.id]
        );
        fixed++;
        console.log(`[reparse] Fixed email #${row.id}`);
      } else {
        console.log(`[reparse] Skipped email #${row.id} — parser returned no content`);
      }
    } catch (err) {
      failed++;
      console.error(`[reparse] Failed email #${row.id}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\n[reparse] Done: ${fixed} fixed, ${failed} failed, ${broken.length - fixed - failed} skipped`);
  await pool.end();
}

main().catch(err => {
  console.error('[reparse] Fatal error:', err);
  process.exit(1);
});
