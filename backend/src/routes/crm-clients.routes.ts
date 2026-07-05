import { Router, Request, Response } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import db from '../database/db.js';
import { pool } from '../database/db.js';
import { logAudit } from '../services/audit.service.js';
import { idempotent } from '../middleware/idempotency.js';
import { piiAudit } from '../middleware/pii-audit.js';
import type Users from '../types/generated/public/Users.js';
import type { UniversalChatSessionRow } from '../types/views/crm-views.js';
import { buildActivityTimeline } from '../services/client-activity-timeline.service.js';

const router = Router();

// All client routes require admin or employee role
router.use(authenticateToken, requirePermission('clients:view'));

// ─── CLIENT LOOKUP BY PHONE (full number required) ───

router.get('/', async (req: Request, res: Response) => {
  const search = ((req.query['search'] as string) || '').trim();
  const digits = search.replace(/\D/g, '');

  // Privacy: require at least 10 digits (full phone number)
  if (digits.length < 10) throw new AppError(400, 'Введите полный номер телефона (минимум 10 цифр)');

  const phoneLast10 = digits.slice(-10);

  const query = `
    WITH matched AS (
      -- Registered users
      SELECT
        COALESCE(u.display_name, u.email, 'Пользователь') AS name,
        u.phone, u.email,
        u.created_at AS first_seen,
        u.created_at AS last_activity,
        'user' AS source, u.id::text AS source_id
      FROM users u
      WHERE u.phone IS NOT NULL
        AND RIGHT(REGEXP_REPLACE(u.phone, '\\D', '', 'g'), 10) = $1

      UNION ALL

      -- Booking clients
      SELECT
        b.client_name AS name,
        b.client_phone AS phone, b.client_email AS email,
        MIN(b.created_at) AS first_seen,
        MAX(b.start_time) AS last_activity,
        'booking' AS source, NULL AS source_id
      FROM bookings b
      WHERE b.client_phone IS NOT NULL
        AND RIGHT(REGEXP_REPLACE(b.client_phone, '\\D', '', 'g'), 10) = $1
        AND b.client_name IS NOT NULL AND b.client_name != ''
      GROUP BY b.client_name, b.client_phone, b.client_email

      UNION ALL

      -- Print order clients
      SELECT
        po.contact_name AS name,
        po.contact_phone AS phone, po.contact_email AS email,
        MIN(po.created_at) AS first_seen,
        MAX(po.created_at) AS last_activity,
        'print_order' AS source, NULL AS source_id
      FROM photo_print_orders po
      WHERE po.contact_phone IS NOT NULL
        AND RIGHT(REGEXP_REPLACE(po.contact_phone, '\\D', '', 'g'), 10) = $1
        AND po.contact_name IS NOT NULL AND po.contact_name != ''
      GROUP BY po.contact_name, po.contact_phone, po.contact_email

      UNION ALL

      -- POS customers
      SELECT
        r.customer_name AS name,
        r.customer_phone AS phone, NULL AS email,
        MIN(r.created_at) AS first_seen,
        MAX(r.created_at) AS last_activity,
        'pos' AS source, NULL AS source_id
      FROM pos_receipts r
      WHERE r.customer_phone IS NOT NULL
        AND RIGHT(REGEXP_REPLACE(r.customer_phone, '\\D', '', 'g'), 10) = $1
        AND NOT r.is_refund
      GROUP BY r.customer_name, r.customer_phone
    )
    SELECT
      COALESCE(name, 'Клиент') AS name,
      phone, email, source, source_id,
      MIN(first_seen) AS first_seen,
      MAX(last_activity) AS last_activity,
      (
        SELECT COUNT(*) FROM bookings bk
        WHERE RIGHT(REGEXP_REPLACE(bk.client_phone, '\\D', '', 'g'), 10) = $1
      ) + (
        SELECT COUNT(*) FROM photo_print_orders ppo
        WHERE RIGHT(REGEXP_REPLACE(ppo.contact_phone, '\\D', '', 'g'), 10) = $1
      ) + (
        SELECT COUNT(*) FROM pos_receipts pr
        WHERE RIGHT(REGEXP_REPLACE(pr.customer_phone, '\\D', '', 'g'), 10) = $1
          AND NOT pr.is_refund
      ) AS total_orders
    FROM matched
    GROUP BY name, phone, email, source, source_id
    ORDER BY last_activity DESC NULLS LAST
    LIMIT 5
  `;

  const rows = await db.query(query, [phoneLast10]);
  res.json({ success: true, data: rows });
});

// ─── CLIENT ORDERS (ALL CHANNELS) ────────────────────

router.get('/:phone/orders', piiAudit('contact', 'phone'), async (req: Request, res: Response) => {
  const phone = req.params['phone'].replace(/\D/g, '');
  if (phone.length < 10) throw new AppError(400, 'Введите полный номер телефона');
  const phoneLast10 = phone.slice(-10);

  const query = `
    (
      SELECT
        'booking' AS type,
        b.id::text,
        b.start_time AS date,
        b.service_name AS description,
        -- bookings.total_price НЕ существует (price jsonb пуст) → суммы нет.
        NULL::numeric AS amount,
        b.status,
        b.client_name AS client_name
      FROM bookings b
      WHERE RIGHT(REGEXP_REPLACE(b.client_phone, '\\D', '', 'g'), 10) = $1
      ORDER BY b.start_time DESC
      LIMIT 50
    )
    UNION ALL
    (
      SELECT
        'print_order' AS type,
        po.order_id AS id,
        po.created_at AS date,
        -- doc_type/format НЕ существуют → реальные description/photo_format + fallback.
        COALESCE(NULLIF(po.description, ''), po.photo_format, 'Заказ печати') AS description,
        po.total_price AS amount,
        po.status,
        po.contact_name AS client_name
      FROM photo_print_orders po
      WHERE RIGHT(REGEXP_REPLACE(po.contact_phone, '\\D', '', 'g'), 10) = $1
      ORDER BY po.created_at DESC
      LIMIT 50
    )
    UNION ALL
    (
      SELECT
        'pos_receipt' AS type,
        r.id::text,
        r.created_at AS date,
        ('Чек #' || r.receipt_number) AS description,
        r.total AS amount,
        CASE WHEN r.is_refund THEN 'refund' ELSE 'completed' END AS status,
        r.customer_name AS client_name
      FROM pos_receipts r
      WHERE RIGHT(REGEXP_REPLACE(r.customer_phone, '\\D', '', 'g'), 10) = $1
      ORDER BY r.created_at DESC
      LIMIT 50
    )
    ORDER BY date DESC
    LIMIT 100
  `;

  const rows = await db.query(query, [phoneLast10]);
  res.json({ success: true, data: rows });
});

// ─── CLIENT NOTES ────────────────────────────────────

router.get('/:phone/notes', async (req: Request, res: Response) => {
  const phone = req.params['phone'].replace(/\D/g, '');
  if (phone.length < 10) throw new AppError(400, 'Введите полный номер телефона');
  const phoneLast10 = phone.slice(-10);

  const rows = await db.query<{
    id: string; text: string; pinned: boolean;
    created_at: string; author_name: string;
  }>(
    `SELECT n.id, n.text, n.pinned, n.created_at,
            COALESCE(u.display_name, u.email, 'Оператор') AS author_name
     FROM client_notes n
     JOIN users u ON u.id = n.author_id
     WHERE RIGHT(REGEXP_REPLACE(n.client_phone, '\\D', '', 'g'), 10) = $1
     ORDER BY n.pinned DESC, n.created_at DESC
     LIMIT 50`,
    [phoneLast10],
  );

  res.json({ success: true, data: rows });
});

router.post('/:phone/notes', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (!authReq.user) throw new AppError(401, 'Unauthorized');

  const phone = req.params['phone'].replace(/\D/g, '');
  if (phone.length < 10) throw new AppError(400, 'Введите полный номер телефона');

  const { text, pinned } = req.body;
  if (!text?.trim()) throw new AppError(400, 'Text is required');

  const rows = await db.query<{ id: string; created_at: string }>(
    `INSERT INTO client_notes (client_phone, author_id, text, pinned)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at`,
    [phone, authReq.user.id, text.trim(), pinned || false],
  );

  res.status(201).json({
    success: true,
    data: { id: rows[0].id, text: text.trim(), pinned: pinned || false, created_at: rows[0].created_at, author_name: authReq.user.display_name || authReq.user.email || 'Оператор' },
  });
});

router.delete('/:phone/notes/:noteId', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (!authReq.user) throw new AppError(401, 'Unauthorized');

  await db.query(
    `DELETE FROM client_notes WHERE id = $1 AND author_id = $2`,
    [req.params['noteId'], authReq.user.id],
  );

  res.json({ success: true });
});

router.patch('/:phone/notes/:noteId/pin', async (req: Request, res: Response) => {
  const { pinned } = req.body;
  await db.query(
    `UPDATE client_notes SET pinned = $1, updated_at = NOW() WHERE id = $2`,
    [!!pinned, req.params['noteId']],
  );
  res.json({ success: true });
});

// ─── CLIENT ACTIVITY TIMELINE ────────────────────────
// Логика вынесена в client-activity-timeline.service.ts (общий read-side сервис,
// см. allowlist дедупа там). includeMessages:true сохраняет существующий контракт
// (ветки message/note); +ветка subscription добавлена как обогащение.

// Static route MUST come before dynamic /:phone (Express 5 rule)
router.get('/user/:userId/timeline', async (req: Request, res: Response) => {
  const userId = req.params['userId'];
  if (!userId) throw new AppError(400, 'userId is required');
  const limit = Math.min(Number(req.query['limit']) || 50, 100);

  const userRows = await db.query<Pick<Users, 'phone'>>(
    `SELECT phone FROM users WHERE id = $1`,
    [userId],
  );
  if (!userRows.length) throw new AppError(404, 'User not found');

  const phoneLast10raw = (userRows[0].phone || '').replace(/\D/g, '').slice(-10);
  const phoneLast10 = phoneLast10raw.length >= 10 ? phoneLast10raw : null;

  // Identity-bundle: по user_id (всегда) И телефону (если валиден).
  const rows = await buildActivityTimeline({ userId, phoneLast10 }, { includeMessages: true }, limit);
  res.json({ success: true, data: rows });
});

router.get('/:phone/timeline', async (req: Request, res: Response) => {
  const phone = req.params['phone'].replace(/\D/g, '');
  if (phone.length < 10) throw new AppError(400, 'Введите полный номер телефона');
  const phoneLast10 = phone.slice(-10);
  const limit = Math.min(Number(req.query['limit']) || 50, 100);

  const rows = await buildActivityTimeline({ phoneLast10 }, { includeMessages: true }, limit);
  res.json({ success: true, data: rows });
});

// ─── UNIVERSAL CHAT SESSIONS (by contactId / phone / userId) ───

router.get('/chat-sessions', async (req: Request, res: Response) => {
  const contactId = (req.query['contactId'] as string) || null;
  const userId = (req.query['userId'] as string) || null;
  const phoneRaw = (req.query['phone'] as string) || null;
  const phoneLast10 = phoneRaw ? phoneRaw.replace(/\D/g, '').slice(-10) : null;
  const limit = Math.min(Number(req.query['limit']) || 20, 50);

  if (!contactId && !phoneLast10 && !userId) {
    throw new AppError(400, 'At least one of contactId, phone, userId is required');
  }

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (contactId && !uuidRe.test(contactId)) throw new AppError(400, 'Invalid contactId');
  if (userId && !uuidRe.test(userId)) throw new AppError(400, 'Invalid userId');
  if (phoneLast10 && phoneLast10.length < 10) throw new AppError(400, 'Phone must be at least 10 digits');

  const sessions = await db.query<UniversalChatSessionRow>(
    `WITH target_contacts AS (
       SELECT id AS contact_id FROM contacts
       WHERE ($1::uuid IS NOT NULL AND id = $1 AND deleted_at IS NULL)
       UNION
       SELECT id AS contact_id FROM contacts
       WHERE ($2::text IS NOT NULL AND phone IS NOT NULL
              AND RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 10) = $2
              AND deleted_at IS NULL)
       UNION
       SELECT id AS contact_id FROM contacts
       WHERE ($3::uuid IS NOT NULL AND user_id = $3 AND deleted_at IS NULL)
     )
     SELECT
       s.id, s.channel::text, s.status, s.created_at,
       s.first_response_at, s.resolved_at,
       s.message_count::text AS message_count,
       u.display_name AS assigned_operator_name,
       s.last_message_at,
       LEFT(s.last_message_content, 100) AS last_message_preview,
       COALESCE(s.visitor_name, c.display_name) AS visitor_name
     FROM conversations s
     LEFT JOIN users u ON u.id = s.assigned_operator_id
     LEFT JOIN contacts c ON c.id = s.contact_id
     WHERE s.contact_id IN (SELECT contact_id FROM target_contacts)
        OR ($2::text IS NOT NULL AND RIGHT(REGEXP_REPLACE(s.visitor_phone, '\\D', '', 'g'), 10) = $2)
        OR ($3::uuid IS NOT NULL AND s.user_id = $3)
     ORDER BY s.last_message_at DESC NULLS LAST, s.created_at DESC
     LIMIT $4`,
    [contactId, phoneLast10, userId, limit]
  );

  res.json({ success: true, data: sessions });
});

// ─── CHAT SESSIONS HISTORY (legacy, by phone param) ────

router.get('/:phone/chat-sessions', async (req: Request, res: Response) => {
  const phone = (req.params['phone'] || '').replace(/\D/g, '');
  if (phone.length < 10) throw new AppError(400, 'Valid phone required');
  const phoneSuffix = phone.slice(-10);

  const sessions = await db.query<{
    id: string; channel: string; status: string;
    created_at: string; first_response_at: string | null;
    resolved_at: string | null; message_count: string;
    assigned_operator_name: string | null;
  }>(
    `SELECT s.id, s.channel, s.status, s.created_at,
            s.first_response_at, s.resolved_at,
            s.message_count::text as message_count,
            u.display_name as assigned_operator_name
     FROM conversations s
     LEFT JOIN users u ON u.id = s.assigned_operator_id
     WHERE RIGHT(REGEXP_REPLACE(s.visitor_phone, '\\D', '', 'g'), 10) = $1
     ORDER BY s.created_at DESC
     LIMIT 10`,
    [phoneSuffix]
  );

  res.json({ success: true, data: sessions });
});

// ─── CLIENT MERGE ────────────────────────────────────

router.post('/merge', idempotent(300), async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (!authReq.user) throw new AppError(401, 'Unauthorized');

  const { primary_phone, merge_phones } = req.body as { primary_phone: string; merge_phones: string[] };
  if (!primary_phone || !merge_phones?.length) throw new AppError(400, 'primary_phone and merge_phones[] required');

  // Normalize all phones to last 10 digits
  const normPrimary = primary_phone.replace(/\D/g, '').slice(-10);
  const normMerge = merge_phones.map(p => p.replace(/\D/g, '').slice(-10)).filter(p => p.length === 10 && p !== normPrimary);

  if (normPrimary.length !== 10) throw new AppError(400, 'Invalid primary phone');
  if (normMerge.length === 0) throw new AppError(400, 'No valid phones to merge');

  // Use full primary_phone as-is for updates (keep original format)
  const primaryFormatted = primary_phone.replace(/\D/g, '');

  // Transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Build conditions for each merge phone (last 10 digits match)
    const mergeConditions = normMerge.map((_, i) => `RIGHT(REGEXP_REPLACE($field$, '\\D', '', 'g'), 10) = $${i + 2}`).join(' OR ');

    // Bookings
    const bookingsResult = await client.query(
      `UPDATE bookings SET client_phone = $1
       WHERE (${mergeConditions.replace(/\$field\$/g, 'client_phone')})
       AND RIGHT(REGEXP_REPLACE(client_phone, '\\D', '', 'g'), 10) != $${normMerge.length + 2}`,
      [primaryFormatted, ...normMerge, normPrimary],
    );

    // Print orders
    const ordersResult = await client.query(
      `UPDATE photo_print_orders SET contact_phone = $1
       WHERE (${mergeConditions.replace(/\$field\$/g, 'contact_phone')})
       AND RIGHT(REGEXP_REPLACE(contact_phone, '\\D', '', 'g'), 10) != $${normMerge.length + 2}`,
      [primaryFormatted, ...normMerge, normPrimary],
    );

    // Contacts (SSOT for phone)
    const chatsResult = await client.query(
      `UPDATE contacts SET phone = $1
       WHERE id IN (SELECT contact_id FROM conversations WHERE contact_id IS NOT NULL AND (${mergeConditions.replace(/\$field\$/g, 'visitor_phone')}))
       AND RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g'), 10) != $${normMerge.length + 2}`,
      [primaryFormatted, ...normMerge, normPrimary],
    );

    // Client notes
    const notesResult = await client.query(
      `UPDATE client_notes SET client_phone = $1
       WHERE (${mergeConditions.replace(/\$field\$/g, 'client_phone')})
       AND RIGHT(REGEXP_REPLACE(client_phone, '\\D', '', 'g'), 10) != $${normMerge.length + 2}`,
      [primaryFormatted, ...normMerge, normPrimary],
    );

    await client.query('COMMIT');

    logAudit({
      userId: authReq.user.id,
      userName: authReq.user.email,
      action: 'client_merge',
      entityType: 'client',
      entityId: normPrimary,
      details: {
        primary: primaryFormatted,
        merged: normMerge,
        counts: {
          bookings: bookingsResult.rowCount || 0,
          orders: ordersResult.rowCount || 0,
          chats: chatsResult.rowCount || 0,
          notes: notesResult.rowCount || 0,
        },
      },
    });

    res.json({
      success: true,
      data: {
        merged_records: {
          bookings: bookingsResult.rowCount || 0,
          orders: ordersResult.rowCount || 0,
          chats: chatsResult.rowCount || 0,
          notes: notesResult.rowCount || 0,
        },
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ─── MERGE PREVIEW (count of records to merge) ─────────

router.post('/merge-preview', async (req: Request, res: Response) => {
  const { merge_phones } = req.body as { merge_phones: string[] };
  if (!merge_phones?.length) throw new AppError(400, 'merge_phones[] required');

  const normalized = merge_phones.map(p => p.replace(/\D/g, '').slice(-10)).filter(p => p.length === 10);
  if (normalized.length === 0) {
    res.json({ success: true, data: { bookings: 0, orders: 0, chats: 0, notes: 0 } });
    return;
  }

  const phonePlaceholders = normalized.map((_, i) => `$${i + 1}`).join(', ');

  const [bookings, orders, chats, notes] = await Promise.all([
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM bookings WHERE RIGHT(REGEXP_REPLACE(client_phone, '\\D', '', 'g'), 10) IN (${phonePlaceholders})`,
      normalized
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM photo_print_orders WHERE RIGHT(REGEXP_REPLACE(contact_phone, '\\D', '', 'g'), 10) IN (${phonePlaceholders})`,
      normalized
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM conversations WHERE RIGHT(REGEXP_REPLACE(COALESCE(visitor_phone, ''), '\\D', '', 'g'), 10) IN (${phonePlaceholders})`,
      normalized
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM client_notes WHERE RIGHT(REGEXP_REPLACE(client_phone, '\\D', '', 'g'), 10) IN (${phonePlaceholders})`,
      normalized
    ),
  ]);

  res.json({
    success: true,
    data: {
      bookings: parseInt(bookings[0]?.count || '0'),
      orders: parseInt(orders[0]?.count || '0'),
      chats: parseInt(chats[0]?.count || '0'),
      notes: parseInt(notes[0]?.count || '0'),
    },
  });
});

export default router;
