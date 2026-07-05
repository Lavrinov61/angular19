-- ============================================================
-- Add studioName to BOOKINGS section of crm_inbox_view MV
-- Применять: sudo -u postgres psql -d magnus_photo_db -f inbox_mv_booking_studio.sql
-- ============================================================

DROP MATERIALIZED VIEW IF EXISTS crm_inbox_view;

CREATE MATERIALIZED VIEW crm_inbox_view AS

-- ── CHATS ──────────────────────────────────────────────────
SELECT
  s.id::text                                              AS id,
  'chat'::text                                            AS type,
  s.visitor_name                                          AS client_name,
  s.visitor_phone                                         AS client_phone,
  COALESCE(lm.content, 'Новая сессия')                   AS preview,
  s.status,
  CASE s.status WHEN 'open' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END
                                                          AS priority,
  COALESCE(s.last_message_at, s.created_at)              AS sort_time,
  s.channel,
  s.assigned_operator_id::text                            AS assigned_to,
  NULL::text                                              AS assigned_to_name,
  (s.status = 'open')                                     AS unread,
  jsonb_build_object(
    'messageCount', COALESCE(mc.cnt, 0),
    'channel',           s.channel,
    'createdAt',         s.created_at,
    'firstResponseAt',   s.first_response_at,
    'slaStatus', CASE
      WHEN s.first_response_at IS NOT NULL THEN 'ok'
      WHEN EXTRACT(EPOCH FROM (NOW() - s.created_at)) >= 300 THEN 'breached'
      WHEN EXTRACT(EPOCH FROM (NOW() - s.created_at)) >= 210 THEN 'warning'
      ELSE NULL
    END
  )                                                       AS metadata

FROM visitor_chat_sessions s
LEFT JOIN LATERAL (
  SELECT content
  FROM visitor_chat_messages
  WHERE session_id = s.id
  ORDER BY created_at DESC
  LIMIT 1
) lm ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*)::int AS cnt
  FROM visitor_chat_messages
  WHERE session_id = s.id
) mc ON true
WHERE s.status IN ('open', 'waiting', 'active')

UNION ALL

-- ── TASKS ──────────────────────────────────────────────────
SELECT
  t.id::text,
  'task'::text,
  t.client_name,
  t.client_phone,
  '#' || t.task_number::text || ' ' || t.title,
  t.status,
  CASE t.priority
    WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3
  END,
  COALESCE(t.updated_at, t.created_at),
  t.client_channel,
  t.assigned_to::text,
  u.display_name,
  false,
  jsonb_build_object(
    'taskNumber', t.task_number,
    'taskType',   t.task_type,
    'dueDate',    t.due_date
  )

FROM work_tasks t
LEFT JOIN users u ON u.id = t.assigned_to
WHERE t.status NOT IN ('completed', 'cancelled')

UNION ALL

-- ── BOOKINGS ───────────────────────────────────────────────
SELECT
  b.id::text,
  'booking'::text,
  b.client_name,
  b.client_phone,
  COALESCE(b.service_name, 'Запись'),
  b.status,
  CASE WHEN b.start_time::date = CURRENT_DATE THEN 1 ELSE 2 END,
  b.start_time,
  b.source,
  NULL::text,
  NULL::text,
  false,
  jsonb_build_object(
    'startTime',   b.start_time,
    'endTime',     b.end_time,
    'source',      b.source,
    'studioName',  s.name
  )

FROM bookings b
LEFT JOIN studios s ON s.id = b.studio_id
WHERE b.start_time > NOW() - INTERVAL '1 day'
  AND b.status NOT IN ('cancelled', 'completed', 'no-show')

UNION ALL

-- ── ORDERS ─────────────────────────────────────────────────
SELECT
  o.id::text,
  'order'::text,
  o.contact_name,
  o.contact_phone,
  o.order_id || ' — ' || ROUND(o.total_price::numeric, 0)::text || '₽',
  o.status,
  CASE o.priority WHEN 'vip' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END,
  COALESCE(o.updated_at, o.created_at),
  NULL::text,
  NULL::text,
  NULL::text,
  false,
  jsonb_build_object(
    'orderId',       o.order_id,
    'paymentStatus', o.payment_status,
    'totalPrice',    o.total_price
  )

FROM photo_print_orders o
WHERE o.status NOT IN ('completed', 'cancelled')

UNION ALL

-- ── APPROVALS ──────────────────────────────────────────────
SELECT
  s.id::text,
  'approval'::text,
  s.client_name,
  s.client_phone,
  COALESCE(s.title, 'Согласование фото'),
  s.status,
  CASE WHEN s.status IN ('in_review', 'changes_requested') THEN 1 ELSE 2 END,
  COALESCE(s.updated_at, s.created_at),
  NULL::text,
  s.photographer_id::text,
  u.display_name,
  (s.status IN ('in_review', 'changes_requested') AND s.first_viewed_at IS NULL),
  jsonb_build_object(
    'totalPhotos',    s.total_photos,
    'approvedCount',  s.approved_count,
    'rejectedCount',  s.rejected_count,
    'viewed',         (s.first_viewed_at IS NOT NULL)
  )

FROM photo_approval_sessions s
LEFT JOIN users u ON u.id = s.photographer_id
WHERE s.status NOT IN ('completed')

WITH DATA;

-- ── Indexes ────────────────────────────────────────────────
CREATE UNIQUE INDEX idx_inbox_mv_unique   ON crm_inbox_view(type, id);
CREATE INDEX idx_inbox_mv_sort            ON crm_inbox_view(priority ASC, sort_time DESC NULLS LAST);
CREATE INDEX idx_inbox_mv_type            ON crm_inbox_view(type);
CREATE INDEX idx_inbox_mv_assigned        ON crm_inbox_view(assigned_to) WHERE assigned_to IS NOT NULL;

-- Grant для приложения
GRANT SELECT ON crm_inbox_view TO magnus_user;

\echo '✅ crm_inbox_view recreated with studioName in bookings metadata'
