-- Fix: crm_inbox_view excludes only completed/cancelled orders
-- but not refunded/payment_failed/expired — they hang in sidebar forever
-- Also: drop + recreate required because MV column layout is unchanged

BEGIN;

-- Drop dependent indexes first
DROP INDEX IF EXISTS idx_inbox_mv_assigned;
DROP INDEX IF EXISTS idx_inbox_mv_sort;
DROP INDEX IF EXISTS idx_inbox_mv_type;
DROP INDEX IF EXISTS idx_crm_inbox_view_pk;

-- Drop and recreate MV with fixed ORDER WHERE clause
DROP MATERIALIZED VIEW IF EXISTS crm_inbox_view;

CREATE MATERIALIZED VIEW crm_inbox_view AS
-- CHATS: only open/waiting/active
SELECT
  s.id::text AS id,
  'chat'::text AS type,
  COALESCE(cl.display_name, s.visitor_name) AS client_name,
  COALESCE(cl.phone, s.visitor_phone) AS client_phone,
  COALESCE(s.last_message_content, 'Новый разговор') AS preview,
  s.status,
  CASE s.status
    WHEN 'open' THEN 1
    WHEN 'waiting' THEN 2
    ELSE 3
  END AS priority,
  COALESCE(s.last_message_at, s.created_at) AS sort_time,
  s.channel::text AS channel,
  s.assigned_operator_id::text AS assigned_to,
  u_op.display_name AS assigned_to_name,
  (s.unread_count > 0) AS unread,
  jsonb_build_object(
    'messageCount', s.message_count,
    'channel', s.channel,
    'createdAt', s.created_at,
    'firstResponseAt', s.first_response_at,
    'userId', s.user_id,
    'unreadCount', s.unread_count,
    'slaStatus', CASE
      WHEN s.first_response_at IS NOT NULL THEN 'ok'
      WHEN EXTRACT(epoch FROM (now() - s.created_at)) >= 300 THEN 'breached'
      WHEN EXTRACT(epoch FROM (now() - s.created_at)) >= 210 THEN 'warning'
      ELSE NULL
    END
  ) AS metadata
FROM conversations s
LEFT JOIN users cl ON cl.id = s.user_id
LEFT JOIN users u_op ON u_op.id = s.assigned_operator_id
WHERE s.status IN ('open', 'waiting', 'active')

UNION ALL

-- TASKS: exclude completed/cancelled
SELECT
  t.id::text AS id,
  'task'::text AS type,
  t.client_name,
  t.client_phone,
  '#' || t.task_number || ' ' || t.title AS preview,
  t.status,
  CASE t.priority
    WHEN 'urgent' THEN 0
    WHEN 'high' THEN 1
    WHEN 'normal' THEN 2
    ELSE 3
  END AS priority,
  COALESCE(t.updated_at, t.created_at) AS sort_time,
  t.client_channel AS channel,
  t.assigned_to::text AS assigned_to,
  u.display_name AS assigned_to_name,
  false AS unread,
  jsonb_build_object('taskNumber', t.task_number, 'taskType', t.task_type, 'dueDate', t.due_date) AS metadata
FROM work_tasks t
LEFT JOIN users u ON u.id = t.assigned_to
WHERE t.status NOT IN ('completed', 'cancelled')

UNION ALL

-- BOOKINGS: recent, exclude cancelled/completed/no-show
SELECT
  b.id::text AS id,
  'booking'::text AS type,
  b.client_name,
  b.client_phone,
  COALESCE(b.service_name, 'Запись') AS preview,
  b.status,
  CASE WHEN b.start_time::date = CURRENT_DATE THEN 1 ELSE 2 END AS priority,
  b.start_time AS sort_time,
  b.source AS channel,
  NULL::text AS assigned_to,
  NULL::text AS assigned_to_name,
  false AS unread,
  jsonb_build_object('startTime', b.start_time, 'endTime', b.end_time, 'source', b.source) AS metadata
FROM bookings b
WHERE b.start_time > (now() - interval '1 day')
  AND b.status NOT IN ('cancelled', 'completed', 'no-show')

UNION ALL

-- ORDERS: exclude ALL terminal statuses (was missing refunded/payment_failed/expired)
SELECT
  o.id::text AS id,
  'order'::text AS type,
  o.contact_name AS client_name,
  o.contact_phone AS client_phone,
  (CASE WHEN o.order_id ~ '^SF-' THEN o.order_id ELSE 'Заказ #' || right(o.order_id, 8) END)
    || ' — ' || round(o.total_price::numeric, 0) || '₽' AS preview,
  o.status,
  CASE o.priority
    WHEN 'vip' THEN 0
    WHEN 'urgent' THEN 1
    ELSE 2
  END AS priority,
  COALESCE(o.updated_at, o.created_at) AS sort_time,
  NULL::text AS channel,
  NULL::text AS assigned_to,
  NULL::text AS assigned_to_name,
  false AS unread,
  jsonb_build_object('orderId', o.order_id, 'paymentStatus', o.payment_status, 'totalPrice', o.total_price) AS metadata
FROM photo_print_orders o
WHERE o.status NOT IN ('completed', 'cancelled', 'refunded', 'payment_failed', 'expired')

UNION ALL

-- APPROVALS: exclude completed
SELECT
  s.id::text AS id,
  'approval'::text AS type,
  s.client_name,
  s.client_phone,
  COALESCE(s.title, 'Согласование фото') AS preview,
  s.status,
  CASE WHEN s.status IN ('in_review', 'changes_requested') THEN 1 ELSE 2 END AS priority,
  COALESCE(s.updated_at, s.created_at) AS sort_time,
  NULL::text AS channel,
  s.photographer_id::text AS assigned_to,
  u.display_name AS assigned_to_name,
  (s.status IN ('in_review', 'changes_requested') AND s.first_viewed_at IS NULL) AS unread,
  jsonb_build_object('totalPhotos', s.total_photos, 'approvedCount', s.approved_count, 'rejectedCount', s.rejected_count, 'viewed', (s.first_viewed_at IS NOT NULL)) AS metadata
FROM photo_approval_sessions s
LEFT JOIN users u ON u.id = s.photographer_id
WHERE s.status <> 'completed'

WITH NO DATA;

-- Recreate indexes
CREATE UNIQUE INDEX idx_crm_inbox_view_pk ON crm_inbox_view (type, id);
CREATE INDEX idx_inbox_mv_assigned ON crm_inbox_view (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_inbox_mv_sort ON crm_inbox_view (priority, sort_time DESC NULLS LAST);
CREATE INDEX idx_inbox_mv_type ON crm_inbox_view (type);

-- Populate data
REFRESH MATERIALIZED VIEW crm_inbox_view;

-- Also clean up stale orders from crm_inbox table
DELETE FROM crm_inbox
WHERE type = 'order' AND status IN ('refunded', 'payment_failed', 'expired');

COMMIT;
