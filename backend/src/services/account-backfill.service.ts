/**
 * Account Backfill Service
 *
 * После логина/верификации привязывает к user.id ранее созданные
 * записи (subscriptions, contacts), у которых есть совпадение по
 * phone (последние 10 цифр) или email (lowercase).
 *
 * Propagation в conversations выполняется внутри linkContactToUser.
 */

import { pool } from '../database/db.js';
import { linkContactToUser } from './contact.service.js';
import { createLogger } from '../utils/logger.js';
import type Contacts from '../types/generated/public/Contacts.js';

const log = createLogger('account-backfill');

type ContactIdRow = Pick<Contacts, 'id'>;

export async function runPostLoginBackfill(
  userId: string,
  phone: string | null,
  email: string | null,
): Promise<{ subs: number; contacts: number }> {
  const last10 = phone ? phone.replace(/\D/g, '').slice(-10) : null;
  const validLast10 = last10 && last10.length === 10 ? last10 : null;
  const emailLower = email ? email.trim().toLowerCase() : null;

  if (!validLast10 && !emailLower) {
    return { subs: 0, contacts: 0 };
  }

  try {
    const [subsResult, contactRows] = await Promise.all([
      validLast10
        ? pool.query(
            `UPDATE user_subscriptions SET user_id = $1, updated_at = NOW()
             WHERE user_id IS NULL AND phone IS NOT NULL
               AND RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 10) = $2
             RETURNING id`,
            [userId, validLast10],
          )
        : Promise.resolve({ rowCount: 0, rows: [] as ContactIdRow[] }),
      pool.query<ContactIdRow>(
        `SELECT id FROM contacts
         WHERE user_id IS NULL AND deleted_at IS NULL
           AND ( ($2::text IS NOT NULL AND phone IS NOT NULL
                  AND RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 10) = $2)
              OR ($3::text IS NOT NULL AND email IS NOT NULL
                  AND LOWER(email) = LOWER($3)) )`,
        [userId, validLast10, emailLower],
      ),
    ]);

    for (const row of contactRows.rows) {
      await linkContactToUser(row.id, userId);
    }

    const subs = subsResult.rowCount ?? 0;
    const contacts = contactRows.rows.length;

    if (subs > 0 || contacts > 0) {
      log.info('post-login backfill', { userId, subs, contacts });
    }

    return { subs, contacts };
  } catch (err) {
    log.warn('post-login backfill failed', { userId, error: String(err) });
    return { subs: 0, contacts: 0 };
  }
}
