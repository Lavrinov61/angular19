/**
 * Unified Contact Service
 *
 * Single identity for every person interacting with the business.
 * One contact = one physical person (phone is the primary unifier).
 */

import type { PoolClient } from 'pg';
import { pool } from '../database/db.js';
import { createLogger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import type ChannelUsers from '../types/generated/public/ChannelUsers.js';

const log = createLogger('contact-service');

export interface Contact {
  id: string;
  display_name: string | null;
  phone: string | null;
  email: string | null;
  user_id: string | null;
  source: string;
  avatar_url: string | null;
  metadata: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
}

interface FindOrCreateParams {
  phone?: string | null;
  email?: string | null;
  displayName?: string | null;
  source: string;
  externalUserId?: string | null;
  channel?: string | null;
}

/**
 * Normalize phone to 7xxxxxxxxxx format (10-digit Russian mobile).
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return '7' + digits.slice(1);
  }
  if (digits.length === 10) {
    return '7' + digits;
  }
  // International or non-Russian — store as-is if 7+ digits
  if (digits.length >= 7) return digits;
  return null;
}

/**
 * Find or create a unified contact.
 *
 * Resolution order:
 * 1. By normalized phone (unique index)
 * 2. By channel_users.contact_id (for phoneless channels like Telegram)
 * 3. Create new contact
 */
export async function findOrCreateContact(params: FindOrCreateParams): Promise<Contact> {
  const { phone, email, displayName, source, externalUserId, channel } = params;

  const normalized = phone ? normalizePhone(phone) : null;

  // 1. Try by phone (exclude soft-deleted)
  if (normalized) {
    const existing = await pool.query<Contact>(
      'SELECT * FROM contacts WHERE phone = $1 AND deleted_at IS NULL',
      [normalized],
    );
    if (existing.rows[0]) {
      // Update last_seen + fill in missing fields
      pool.query(
        `UPDATE contacts SET
          last_seen_at = NOW(),
          display_name = COALESCE(contacts.display_name, $2),
          email = COALESCE(contacts.email, $3),
          avatar_url = COALESCE(contacts.avatar_url, NULL)
        WHERE id = $1`,
        [existing.rows[0].id, displayName || null, email || null],
      ).catch(err => log.warn('contact update failed', { error: String(err) }));

      return existing.rows[0];
    }
  }

  // 2. Try by channel_users link (phoneless channels)
  if (channel && externalUserId) {
    const cuRow = await pool.query<Pick<ChannelUsers, 'contact_id'>>(
      'SELECT contact_id FROM channel_users WHERE channel = $1 AND external_user_id = $2',
      [channel, externalUserId],
    );
    if (cuRow.rows[0]?.contact_id) {
      const linked = await pool.query<Contact>(
        'SELECT * FROM contacts WHERE id = $1',
        [cuRow.rows[0].contact_id],
      );
      if (linked.rows[0]) {
        pool.query(
          `UPDATE contacts SET
            last_seen_at = NOW(),
            display_name = COALESCE(contacts.display_name, $2)
          WHERE id = $1`,
          [linked.rows[0].id, displayName || null],
        ).catch(err => log.warn('contact update failed', { error: String(err) }));

        return linked.rows[0];
      }
    }
  }

  // 3. Create new contact
  const result = await pool.query<Contact>(
    `INSERT INTO contacts (display_name, phone, email, source)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (phone) WHERE phone IS NOT NULL AND deleted_at IS NULL
     DO UPDATE SET
       last_seen_at = NOW(),
       display_name = COALESCE(contacts.display_name, EXCLUDED.display_name)
     RETURNING *`,
    [displayName || null, normalized, email || null, source],
  );

  const contact = result.rows[0];
  log.info('contact created', { id: contact.id, phone: normalized, source });
  return contact;
}

/**
 * Link a contact to a registered user account.
 * Also propagates user_id to all unlinked chat sessions of this contact.
 */
export async function linkContactToUser(contactId: string, userId: string): Promise<void> {
  await pool.query(
    'UPDATE contacts SET user_id = $2, updated_at = NOW() WHERE id = $1 AND user_id IS NULL',
    [contactId, userId],
  );

  // Propagate user_id to sessions that have this contact but no user_id
  const updated = await pool.query(
    `UPDATE conversations SET user_id = $1
     WHERE contact_id = $2 AND user_id IS NULL
     RETURNING id`,
    [userId, contactId],
  );

  if (updated.rowCount && updated.rowCount > 0) {
    log.info('propagated user_id to sessions', { contactId, userId, sessions: updated.rowCount });
  }
}

/**
 * Find contact by phone number.
 */
export async function findContactByPhone(phone: string): Promise<Contact | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const result = await pool.query<Contact>(
    'SELECT * FROM contacts WHERE phone = $1',
    [normalized],
  );
  return result.rows[0] || null;
}

/**
 * Find contact by registered user ID.
 */
export async function findContactByUserId(userId: string): Promise<Contact | null> {
  const result = await pool.query<Contact>(
    'SELECT * FROM contacts WHERE user_id = $1',
    [userId],
  );
  return result.rows[0] || null;
}

// ─── DUPLICATE DETECTION ────────────────────────────────

export interface DuplicateCandidate {
  id: string;
  display_name: string | null;
  phone: string | null;
  source: string;
  channels: string[];
}

/**
 * Find potential duplicate contacts by display_name match.
 * Used for auto-suggest merge when a new phoneless contact is created.
 */
export async function findPotentialDuplicates(contactId: string): Promise<DuplicateCandidate[]> {
  const target = await pool.query<Contact>(
    'SELECT * FROM contacts WHERE id = $1 AND deleted_at IS NULL',
    [contactId],
  );
  if (!target.rows[0]) return [];

  const { display_name, source } = target.rows[0];
  if (!display_name || display_name.trim().length < 3) return [];

  const result = await pool.query<DuplicateCandidate>(
    `SELECT c.id, c.display_name, c.phone, c.source,
            COALESCE(
              ARRAY_AGG(DISTINCT cu.channel) FILTER (WHERE cu.channel IS NOT NULL),
              '{}'
            ) as channels
     FROM contacts c
     LEFT JOIN channel_users cu ON cu.contact_id = c.id
     WHERE c.id != $1
       AND c.deleted_at IS NULL
       AND LOWER(TRIM(c.display_name)) = LOWER(TRIM($2))
       AND c.source != $3
     GROUP BY c.id
     LIMIT 5`,
    [contactId, display_name, source],
  );

  return result.rows;
}

// ─── CONTACT MERGE ──────────────────────────────────────

export interface MergeContactsResult {
  channel_users_moved: number;
  sessions_moved: number;
  approval_sessions_moved: number;
  fields_filled: string[];
  user_id_conflict: boolean;
}

/**
 * Find contacts by last 10 digits of phone.
 * Bridges the normalization gap: contacts store 7xxxxxxxxxx (11 digits),
 * but CRM merge routes work with last-10-digit matching.
 */
export async function findContactsByPhone10(
  client: PoolClient,
  phoneLast10: string,
): Promise<Contact[]> {
  const result = await client.query<Contact>(
    `SELECT * FROM contacts WHERE RIGHT(phone, 10) = $1 AND deleted_at IS NULL`,
    [phoneLast10],
  );
  return result.rows;
}

/**
 * Merge two contacts: transfer all FK references from `removeId` to `keepId`,
 * backfill empty fields, and soft-delete the removed contact.
 *
 * Must be called within an existing transaction (accepts PoolClient).
 */
export async function mergeContactRecords(
  client: PoolClient,
  keepId: string,
  removeId: string,
): Promise<MergeContactsResult> {
  // Fetch both contacts
  const [keepResult, removeResult] = await Promise.all([
    client.query<Contact>('SELECT * FROM contacts WHERE id = $1 AND deleted_at IS NULL', [keepId]),
    client.query<Contact>('SELECT * FROM contacts WHERE id = $1 AND deleted_at IS NULL', [removeId]),
  ]);

  const keep = keepResult.rows[0];
  const remove = removeResult.rows[0];
  if (!keep) throw new AppError(404, `Contact ${keepId} not found`);
  if (!remove) throw new AppError(404, `Contact ${removeId} not found`);

  // 1. Move FK references
  const [cuResult, sessResult, approvalResult] = await Promise.all([
    client.query(
      'UPDATE channel_users SET contact_id = $1 WHERE contact_id = $2',
      [keepId, removeId],
    ),
    client.query(
      'UPDATE conversations SET contact_id = $1 WHERE contact_id = $2',
      [keepId, removeId],
    ),
    client.query(
      'UPDATE photo_approval_sessions SET contact_id = $1 WHERE contact_id = $2',
      [keepId, removeId],
    ),
  ]);

  // 2. Backfill empty fields on keep from remove
  const fields_filled: string[] = [];
  const updates: string[] = [];
  const values: unknown[] = [keepId];
  let paramIdx = 2;

  const backfillFields: Array<[keyof Contact, string]> = [
    ['display_name', 'display_name'],
    ['email', 'email'],
    ['avatar_url', 'avatar_url'],
  ];

  for (const [field, col] of backfillFields) {
    if (!keep[field] && remove[field]) {
      updates.push(`${col} = $${paramIdx}`);
      values.push(remove[field]);
      fields_filled.push(col);
      paramIdx++;
    }
  }

  // user_id: transfer only if keep's is NULL
  let user_id_conflict = false;
  if (!keep.user_id && remove.user_id) {
    updates.push(`user_id = $${paramIdx}`);
    values.push(remove.user_id);
    fields_filled.push('user_id');
    paramIdx++;
  } else if (keep.user_id && remove.user_id && keep.user_id !== remove.user_id) {
    user_id_conflict = true;
  }

  // Timestamps: keep earliest first_seen, latest last_seen
  updates.push(`first_seen_at = LEAST(first_seen_at, $${paramIdx})`);
  values.push(remove.first_seen_at);
  paramIdx++;

  updates.push(`last_seen_at = GREATEST(last_seen_at, $${paramIdx})`);
  values.push(remove.last_seen_at);
  paramIdx++;

  // Metadata: shallow merge (keep has priority)
  updates.push(`metadata = $${paramIdx}::jsonb || metadata`);
  values.push(JSON.stringify(remove.metadata || {}));
  paramIdx++;

  updates.push('updated_at = NOW()');

  if (updates.length > 0) {
    await client.query(
      `UPDATE contacts SET ${updates.join(', ')} WHERE id = $1`,
      values,
    );
  }

  // 3. Soft-delete remove contact (NULL phone for unique index)
  await client.query(
    `UPDATE contacts SET
       deleted_at = NOW(),
       phone = NULL,
       metadata = metadata || jsonb_build_object(
         'merged_into', $2::text,
         'merged_phone', phone
       ),
       updated_at = NOW()
     WHERE id = $1`,
    [removeId, keepId],
  );

  const result: MergeContactsResult = {
    channel_users_moved: cuResult.rowCount || 0,
    sessions_moved: sessResult.rowCount || 0,
    approval_sessions_moved: approvalResult.rowCount || 0,
    fields_filled,
    user_id_conflict,
  };

  log.info('contacts merged', {
    keepId,
    removeId,
    ...result,
  });

  return result;
}
