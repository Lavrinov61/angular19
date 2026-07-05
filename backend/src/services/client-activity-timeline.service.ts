/**
 * Общий сервис ленты активности клиента (read-side, без записи в `messages`).
 *
 * Собирает доменную активность человека (брони, заказы, чеки, лояльность,
 * звонки, подписки) по identity-bundle (`user_id` И/ИЛИ нормализованный
 * телефон) одним UNION ALL и возвращает строки в формате `TimelineEventRow`
 * (тот же контракт, что у `/api/crm/clients/.../timeline`). Дополнительно
 * умеет маппить строки в `ActivityItem` для операторской ленты чата.
 *
 * Используется в:
 *  - crm-clients.routes.ts → `/crm/clients/:phone/timeline` и `/user/:userId/timeline`
 *    (с `includeMessages:true` — сохраняет существующий контракт, включая ветки
 *     `message`/`note`);
 *  - chat-admin.routes.ts → `activityItems` на initial-load диалога
 *    (с `includeMessages:false` — сообщения там приходят через `data`+`previousMessages`,
 *     иначе был бы двойной показ).
 *
 * ─── ALLOWLIST ДЕДУПА activity ↔ messages (НЕ ДУБЛИРОВАТЬ) ───────────────────
 * Аудит `grep -rn "INSERT INTO messages" backend/src` (2026-05-30). В `activityItems`
 * включаем ТОЛЬКО то, чего гарантированно НЕТ в `messages` (иначе двойной показ
 * в операторской ленте). Подтверждения оплат остаются как существующие
 * bot/system-сообщения в самой ленте (приходят через `data`/`previousMessages`):
 *
 *   • payment.service.ts:297    — оплата print_order → bot-message. ИСКЛЮЧЕНО как
 *                                 отдельное «оплачено»; заказ показываем entity-centric
 *                                 (размещён + текущий статус).
 *   • payments.routes.ts:2445   — оплата по payment_link → system/interactive message.
 *                                 ИСКЛЮЧЕНО (приходит сообщением).
 *   • subscriptions.routes.ts:432 — отправка промокода gift-подписки → bot-message.
 *                                 ИСКЛЮЧЕНО (это не lifecycle самой подписки).
 *   • photo-approvals / photo-review / photo-print-orders — статусные bot-сообщения
 *                                 по заказам. Заказ остаётся ОДНОЙ entity-плашкой
 *                                 с текущим статусом, не плодим per-event строки.
 *
 *   ВКЛЮЧАЕМ (в messages НЕ пишется):
 *   • bookings                  — брони в messages не пишутся.
 *   • photo_print_orders        — сам ФАКТ заказа (entity-centric, по created_at).
 *   • pos_receipts              — кассовые чеки.
 *   • points_transactions       — лояльность.
 *   • call_logs                 — звонки (только в call_logs).
 *   • user_subscriptions        — lifecycle подписки. CP-оплата подписки
 *                                 (payments.routes.ts:2671) — ТОЛЬКО WS emit,
 *                                 в messages НЕ пишется → показываем как activity.
 *
 * ⚠️ Allowlist хрупок к будущим изменениям: если новый код начнёт писать какой-то
 *    из ВКЛЮЧЁННЫХ типов ещё и в `messages`, будет двойной показ. При добавлении
 *    новых INSERT INTO messages — свериться с этим списком. Покрыто юнит-тестами
 *    на дедуп (см. client-activity-timeline.service.test.ts).
 *
 * Деньги — ТОЛЬКО чтение (SELECT). Сервис НИКОГДА не пишет в БД.
 */

import db from '../database/db.js';
import type { TimelineEventRow } from '../types/views/crm-views.js';
import type { ActivityItem, ActivityType } from '../types/views/crm-views.js';

/** «Человек», по которому собирается активность. Хотя бы одно поле должно быть задано. */
export interface ActivityIdentity {
  /** UUID пользователя (users.id) — связь по client_id / user_id / loyalty. */
  userId?: string | null;
  /** Нормализованный телефон, последние 10 цифр — fallback-связь. */
  phoneLast10?: string | null;
}

export interface BuildTimelineOptions {
  /**
   * true  → включить ветки `message` (visitor-сообщения) и `note` (заметки) —
   *         для `/crm/clients/.../timeline` и таба «Хроно».
   * false → без них — для chat-admin `activityItems` (сообщения приходят через
   *         `data`+`previousMessages`, заметки оператору не нужны как activity).
   */
  includeMessages: boolean;
}

/**
 * Строит ленту активности человека. Возвращает строки `TimelineEventRow`
 * (контракт `/timeline` сохранён 1:1; новая ветка `subscription` — аддитивна).
 * Сортировка по времени события DESC, общий LIMIT.
 */
export async function buildActivityTimeline(
  identity: ActivityIdentity,
  options: BuildTimelineOptions,
  limit = 100,
): Promise<TimelineEventRow[]> {
  const userId = identity.userId ?? null;
  const phone = identity.phoneLast10 ?? null;

  // Нечего искать — пустая лента (защита от полного скана при пустом identity).
  if (!userId && !phone) return [];

  // $1 = userId (uuid | null), $2 = phoneLast10 (text | null), $3 = limit.
  // Каждая ветка матчит человека по user_id ИЛИ phone10 в ОДНОМ WHERE
  // (OR не дублирует строку в UNION ALL — P2-3).
  const phoneMatch = (field: string) =>
    `($2::text IS NOT NULL AND RIGHT(REGEXP_REPLACE(${field}, '\\D', '', 'g'), 10) = $2)`;

  const branches: string[] = [
    // ── Брони: client_id=user_id ИЛИ client_phone (одна ветка, P2-3) ──
    // amount=NULL: bookings.total_price НЕ существует (legacy buildTimelineQuery
    // ошибочно ссылался на неё → падал); реальная колонка `price jsonb` пуста
    // во всех строках ({}) — надёжного источника суммы нет (подтверждено psql).
    `(
      SELECT 'booking' AS type, b.id::text AS id, b.start_time AS ts,
             'Запись: ' || COALESCE(b.service_name, 'фотосессия')
               || COALESCE(' · ' || st.name, '') AS title,
             b.status AS detail, NULL::numeric AS amount
      FROM bookings b
      LEFT JOIN studios st ON st.id = b.studio_id
      WHERE ($1::uuid IS NOT NULL AND b.client_id = $1)
         OR ${phoneMatch('b.client_phone')}
      ORDER BY b.start_time DESC LIMIT 20
    )`,

    // ── Заказы печати (entity-centric: факт заказа + текущий статус) ──
    // ВАЖНО: photo_print_orders НЕ имеет колонок doc_type/format (legacy
    // buildTimelineQuery ссылался на них → 500). Заголовок из РЕАЛЬНЫХ колонок,
    // подтверждённых \d: description / photo_format (оба nullable) + fallback.
    `(
      SELECT 'order' AS type, po.order_id AS id, po.created_at AS ts,
             COALESCE(NULLIF(po.description, ''), po.photo_format, 'Фотопечать') AS title,
             po.status AS detail, po.total_price AS amount
      FROM photo_print_orders po
      WHERE ${phoneMatch('po.contact_phone')}
      ORDER BY po.created_at DESC LIMIT 20
    )`,

    // ── Кассовые чеки (POS) ──
    `(
      SELECT 'pos_receipt' AS type, r.id::text AS id, r.created_at AS ts,
             'Чек #' || r.receipt_number AS title,
             CASE WHEN r.is_refund THEN 'refund' ELSE 'completed' END AS detail,
             r.total AS amount
      FROM pos_receipts r
      WHERE ${phoneMatch('r.customer_phone')}
      ORDER BY r.created_at DESC LIMIT 20
    )`,

    // ── Лояльность (points_transactions → loyalty_profiles → users) ──
    `(
      SELECT 'loyalty' AS type, pt.id::text AS id, pt.created_at AS ts,
             COALESCE(pt.description, pt.action) AS title,
             pt.action AS detail,
             pt.amount::numeric AS amount
      FROM points_transactions pt
      JOIN loyalty_profiles lp ON lp.id = pt.loyalty_profile_id
      JOIN users u ON u.id = lp.user_id
      WHERE ($1::uuid IS NOT NULL AND u.id = $1)
         OR ${phoneMatch('u.phone')}
      ORDER BY pt.created_at DESC LIMIT 20
    )`,

    // ── Звонки: client_user_id ИЛИ caller/called по phone10 ──
    `(
      SELECT 'call' AS type, cl.id::text AS id, cl.started_at AS ts,
             CASE cl.direction WHEN 'inbound' THEN 'Входящий звонок' ELSE 'Исходящий звонок' END AS title,
             COALESCE(NULLIF(cl.duration_seconds, 0) || ' сек', cl.status) AS detail,
             NULL::numeric AS amount
      FROM call_logs cl
      WHERE ($1::uuid IS NOT NULL AND cl.client_user_id = $1)
         OR ${phoneMatch('cl.caller_number')}
         OR ${phoneMatch('cl.called_number')}
      ORDER BY cl.started_at DESC LIMIT 20
    )`,

    // ── Подписки (NEW): lifecycle по user_id ИЛИ phone. CP-оплата = только WS,
    //    в messages не пишется → показываем здесь. Сумма — monthly_price. ──
    `(
      SELECT 'subscription' AS type, us.id::text AS id, us.created_at AS ts,
             'Подписка: ' || COALESCE(sp.name, 'тариф') AS title,
             us.status AS detail,
             us.monthly_price::numeric AS amount
      FROM user_subscriptions us
      LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
      WHERE ($1::uuid IS NOT NULL AND us.user_id = $1)
         OR ${phoneMatch('us.phone')}
      ORDER BY us.created_at DESC LIMIT 20
    )`,
  ];

  if (options.includeMessages) {
    branches.push(
      // ── Visitor-сообщения (только для /timeline; в chat-admin приходят через data) ──
      `(
        SELECT 'message' AS type, m.id::text AS id, m.created_at AS ts,
               LEFT(m.content, 80) AS title,
               c.channel::text AS detail,
               NULL::numeric AS amount
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.sender_type = 'visitor'
          AND ${phoneMatch('c.visitor_phone')}
        ORDER BY m.created_at DESC LIMIT 20
      )`,
      // ── Заметки оператора (client_notes) ──
      `(
        SELECT 'note' AS type, n.id::text AS id, n.created_at AS ts,
               'Заметка: ' || LEFT(n.text, 60) AS title,
               COALESCE(au.display_name, au.email, 'Оператор') AS detail,
               NULL::numeric AS amount
        FROM client_notes n
        JOIN users au ON au.id = n.author_id
        WHERE ${phoneMatch('n.client_phone')}
        ORDER BY n.created_at DESC LIMIT 20
      )`,
    );
  }

  const query = `
    ${branches.join('\n    UNION ALL\n    ')}
    ORDER BY ts DESC
    LIMIT $3
  `;

  return db.query<TimelineEventRow>(query, [userId, phone, limit]);
}

/** Типы строк, которые маппятся в `ActivityItem` (исключаем `message`/`note`). */
const ACTIVITY_TYPES = new Set<ActivityType>([
  'booking',
  'order',
  'pos_receipt',
  'subscription',
  'call',
  'loyalty',
]);

/**
 * Маппит строки таймлайна в `ActivityItem[]` (замороженный контракт операторской
 * ленты). Отбрасывает не-activity типы (`message`/`note`): сообщения приходят
 * через `data`+`previousMessages`, заметки оператору как activity не нужны.
 * Сохраняет порядок (ожидается отсортированный по ts вход).
 */
export function toActivityItems(rows: TimelineEventRow[]): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const row of rows) {
    if (!ACTIVITY_TYPES.has(row.type as ActivityType)) continue;
    const activityType = row.type as ActivityType;
    const amount =
      row.amount === null || row.amount === undefined ? null : Number(row.amount);
    items.push({
      kind: 'activity',
      id: `activity:${activityType}:${row.id}`,
      activity_type: activityType,
      created_at: new Date(row.ts).toISOString(),
      title: row.title,
      detail: row.detail ?? null,
      amount: Number.isFinite(amount as number) ? amount : null,
      status: row.detail ?? null,
    });
  }
  return items;
}
