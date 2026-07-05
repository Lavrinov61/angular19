import { Router, Response } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { AuthRequest } from '../types/index.js';
import db from '../database/db.js';
import type {
  SearchTaskRow, SearchBookingRow, SearchOrderRow, SearchClientRow,
  SearchTaskNoteRow, SearchChatMessageRow, SearchClientNoteRow,
} from '../types/views/index.js';

const router = Router();

router.use(authenticateToken);
router.use(requirePermission('inbox:view'));

// ─── GLOBAL SEARCH ───────────────────────────────────
// Searches across tasks, bookings, orders, clients (by name/phone)

router.get('/', async (req: AuthRequest, res: Response) => {
  const q = ((req.query['q'] as string) || '').trim();
  if (q.length < 2) {
    res.json({ success: true, data: [] });
    return;
  }

  const isPhone = /^\+?\d[\d\s()-]{5,}$/.test(q);
  const searchPattern = `%${q}%`;
  const limit = 5;

  interface SearchResultItem {
    type: 'task' | 'booking' | 'order' | 'client' | 'chat' | 'note';
    id: string;
    title: string;
    subtitle: string;
    icon: string;
    route: string;
  }

  const results: SearchResultItem[] = [];

  // Phone-specific params
  const digits = isPhone ? q.replace(/\D/g, '') : '';
  const phoneLast = digits.length >= 7 ? digits.slice(-10) : '';

  // ── All queries in parallel (latency: sum → max) ──────────────
  const [tasks, bookings, orders, clients, taskNotes, chatMessages, clientNotes] = await Promise.all([
    // Tasks
    db.query<SearchTaskRow>(
      `SELECT id, task_number, title, status
       FROM work_tasks
       WHERE (title ILIKE $1 OR CAST(task_number AS TEXT) = $2)
         AND status NOT IN ('done', 'archived')
       ORDER BY created_at DESC LIMIT $3`,
      [searchPattern, q, limit],
    ),
    // Bookings
    db.query<SearchBookingRow>(
      `SELECT id, client_name, client_phone, start_time, status
       FROM bookings
       WHERE (client_name ILIKE $1 OR client_phone ILIKE $1)
         AND start_time > NOW() - INTERVAL '30 days'
       ORDER BY start_time DESC LIMIT $2`,
      [searchPattern, limit],
    ),
    // Orders
    db.query<SearchOrderRow>(
      `SELECT order_id, contact_name, contact_phone, created_at, status, total_price
       FROM photo_print_orders
       WHERE (contact_name ILIKE $1 OR contact_phone ILIKE $1 OR order_id ILIKE $1)
       ORDER BY created_at DESC LIMIT $2`,
      [searchPattern, limit],
    ),
    // Clients (only for phone queries)
    isPhone && phoneLast
      ? db.query<SearchClientRow>(
          `SELECT COALESCE(u.display_name, u.email, 'Клиент') AS name,
                  u.phone, 'user' AS source
           FROM users u
           WHERE u.phone IS NOT NULL
             AND RIGHT(REGEXP_REPLACE(u.phone, '\\D', '', 'g'), 10) LIKE '%' || $1 || '%'
           LIMIT $2`,
          [phoneLast, limit],
        )
      : Promise.resolve([] as SearchClientRow[]),
    // Task notes (only for text queries)
    !isPhone
      ? db.query<SearchTaskNoteRow>(
          `SELECT tn.task_id, wt.task_number, wt.title AS task_title,
                  LEFT(tn.content, 100) AS content
           FROM task_notes tn
           JOIN work_tasks wt ON wt.id = tn.task_id
           WHERE tn.content ILIKE $1
             AND wt.status NOT IN ('done', 'archived')
           ORDER BY tn.created_at DESC LIMIT $2`,
          [searchPattern, limit],
        )
      : Promise.resolve([] as SearchTaskNoteRow[]),
    // Chat messages (only for text queries)
    !isPhone
      ? db.query<SearchChatMessageRow>(
          `SELECT DISTINCT ON (m.conversation_id) m.conversation_id,
                  LEFT(m.content, 100) AS content,
                  COALESCE(c.visitor_name, 'Посетитель') AS visitor_name
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           WHERE m.content ILIKE $1
             AND m.sender_type = 'visitor'
           ORDER BY m.conversation_id, m.created_at DESC
           LIMIT $2`,
          [searchPattern, limit],
        )
      : Promise.resolve([] as SearchChatMessageRow[]),
    // Client notes (only for text queries)
    !isPhone
      ? db.query<SearchClientNoteRow>(
          `SELECT cn.client_phone, LEFT(cn.text, 100) AS text
           FROM client_notes cn
           WHERE cn.text ILIKE $1
           ORDER BY cn.created_at DESC LIMIT $2`,
          [searchPattern, limit],
        )
      : Promise.resolve([] as SearchClientNoteRow[]),
  ]);

  // ── Map results ─────────────────────────────────────────────────
  for (const t of tasks) {
    results.push({ type: 'task', id: t.id, title: `#${t.task_number} ${t.title}`, subtitle: t.status, icon: 'task_alt', route: `/employee/tasks/${t.id}` });
  }
  for (const b of bookings) {
    const dt = new Date(b.start_time).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    results.push({ type: 'booking', id: b.id, title: b.client_name || b.client_phone, subtitle: dt, icon: 'event', route: `/employee/bookings` });
  }
  for (const o of orders) {
    results.push({ type: 'order', id: o.order_id, title: o.contact_name || o.order_id, subtitle: `${o.total_price}₽ · ${o.status}`, icon: 'receipt_long', route: `/employee` });
  }
  for (const c of clients) {
    results.push({ type: 'client', id: c.phone, title: c.name, subtitle: c.phone, icon: 'person', route: `/employee/clients` });
  }
  for (const n of taskNotes) {
    results.push({ type: 'note', id: n.task_id, title: `#${n.task_number} ${n.task_title}`, subtitle: n.content, icon: 'note', route: `/employee/tasks/${n.task_id}` });
  }
  for (const m of chatMessages) {
    results.push({ type: 'chat', id: m.conversation_id, title: m.visitor_name, subtitle: m.content, icon: 'chat', route: `/employee` });
  }
  for (const cn of clientNotes) {
    results.push({ type: 'note', id: cn.client_phone, title: cn.client_phone, subtitle: cn.text, icon: 'sticky_note_2', route: `/employee/clients` });
  }

  // Deduplicate by type:id
  const seen = new Set<string>();
  const deduped = results.filter(r => {
    const key = `${r.type}:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  res.json({ success: true, data: deduped.slice(0, 15) });
});

export default router;
