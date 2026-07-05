-- Migration 103: Fix crm_inbox_view to use contacts.user_id as SSOT
-- Also backfill conversations.user_id from contacts where they diverge

-- Step 1: Backfill conversations.user_id from contacts.user_id where they diverge
UPDATE conversations c
SET user_id = ct.user_id
FROM contacts ct
WHERE ct.id = c.contact_id
  AND ct.user_id IS NOT NULL
  AND (c.user_id IS NULL OR c.user_id != ct.user_id);

-- Step 2: Recreate crm_inbox_view with COALESCE(ct.user_id, s.user_id) in metadata
DROP MATERIALIZED VIEW IF EXISTS public.crm_inbox_view;

CREATE MATERIALIZED VIEW public.crm_inbox_view AS
 SELECT (s.id)::text AS id,
    'chat'::text AS type,
    COALESCE(ct.display_name, s.visitor_name) AS client_name,
    COALESCE(ct.phone, s.visitor_phone) AS client_phone,
    COALESCE(s.last_message_content, 'Новый разговор'::text) AS preview,
    s.status,
        CASE s.status
            WHEN 'open'::text THEN 1
            WHEN 'waiting'::text THEN 2
            ELSE 3
        END AS priority,
    COALESCE(s.last_message_at, s.created_at) AS sort_time,
    (s.channel)::text AS channel,
    (s.assigned_operator_id)::text AS assigned_to,
    u_op.display_name AS assigned_to_name,
    (s.unread_count > 0) AS unread,
    jsonb_build_object('messageCount', s.message_count, 'channel', s.channel, 'createdAt', s.created_at, 'firstResponseAt', s.first_response_at, 'userId', COALESCE(ct.user_id, s.user_id), 'unreadCount', s.unread_count, 'slaStatus',
        CASE
            WHEN (s.first_response_at IS NOT NULL) THEN 'ok'::text
            WHEN (EXTRACT(epoch FROM (now() - s.created_at)) >= (300)::numeric) THEN 'breached'::text
            WHEN (EXTRACT(epoch FROM (now() - s.created_at)) >= (210)::numeric) THEN 'warning'::text
            ELSE NULL::text
        END) AS metadata
   FROM ((public.conversations s
     LEFT JOIN public.contacts ct ON ((ct.id = s.contact_id)))
     LEFT JOIN public.users u_op ON ((u_op.id = s.assigned_operator_id)))
  WHERE ((s.status)::text = ANY ((ARRAY['open'::character varying, 'waiting'::character varying, 'active'::character varying])::text[]))
UNION ALL
 SELECT (t.id)::text AS id,
    'task'::text AS type,
    t.client_name,
    t.client_phone,
    ((('#'::text || t.task_number) || ' '::text) || (t.title)::text) AS preview,
    t.status,
        CASE t.priority
            WHEN 'urgent'::text THEN 0
            WHEN 'high'::text THEN 1
            WHEN 'normal'::text THEN 2
            ELSE 3
        END AS priority,
    COALESCE(t.updated_at, t.created_at) AS sort_time,
    t.client_channel AS channel,
    (t.assigned_to)::text AS assigned_to,
    u.display_name AS assigned_to_name,
    false AS unread,
    jsonb_build_object('taskNumber', t.task_number, 'taskType', t.task_type, 'dueDate', t.due_date) AS metadata
   FROM (public.work_tasks t
     LEFT JOIN public.users u ON ((u.id = t.assigned_to)))
  WHERE ((t.status)::text <> ALL ((ARRAY['completed'::character varying, 'cancelled'::character varying])::text[]))
UNION ALL
 SELECT (b.id)::text AS id,
    'booking'::text AS type,
    b.client_name,
    b.client_phone,
    COALESCE(b.service_name, 'Запись'::character varying) AS preview,
    b.status,
        CASE
            WHEN ((b.start_time)::date = CURRENT_DATE) THEN 1
            ELSE 2
        END AS priority,
    b.start_time AS sort_time,
    b.source AS channel,
    NULL::text AS assigned_to,
    NULL::text AS assigned_to_name,
    false AS unread,
    jsonb_build_object('startTime', b.start_time, 'endTime', b.end_time, 'source', b.source) AS metadata
   FROM public.bookings b
  WHERE ((b.start_time > (now() - '1 day'::interval)) AND ((b.status)::text <> ALL ((ARRAY['cancelled'::character varying, 'completed'::character varying, 'no-show'::character varying])::text[])))
UNION ALL
 SELECT (o.id)::text AS id,
    'order'::text AS type,
    o.contact_name AS client_name,
    o.contact_phone AS client_phone,
    (((
        CASE
            WHEN ((o.order_id)::text ~ '^SF-'::text) THEN (o.order_id)::text
            ELSE ('Заказ #'::text || "right"((o.order_id)::text, 8))
        END || ' — '::text) || round((o.total_price)::numeric, 0)) || '₽'::text) AS preview,
    o.status,
        CASE o.priority
            WHEN 'vip'::text THEN 0
            WHEN 'urgent'::text THEN 1
            ELSE 2
        END AS priority,
    COALESCE(o.updated_at, o.created_at) AS sort_time,
    NULL::text AS channel,
    NULL::text AS assigned_to,
    NULL::text AS assigned_to_name,
    false AS unread,
    jsonb_build_object('orderId', o.order_id, 'paymentStatus', o.payment_status, 'totalPrice', o.total_price) AS metadata
   FROM public.photo_print_orders o
  WHERE ((o.status)::text <> ALL ((ARRAY['completed'::character varying, 'cancelled'::character varying])::text[]))
UNION ALL
 SELECT (s.id)::text AS id,
    'approval'::text AS type,
    s.client_name,
    s.client_phone,
    COALESCE(s.title, 'Согласование фото'::character varying) AS preview,
    s.status,
        CASE
            WHEN ((s.status)::text = ANY ((ARRAY['in_review'::character varying, 'changes_requested'::character varying])::text[])) THEN 1
            ELSE 2
        END AS priority,
    COALESCE(s.updated_at, s.created_at) AS sort_time,
    NULL::text AS channel,
    (s.photographer_id)::text AS assigned_to,
    u.display_name AS assigned_to_name,
    (((s.status)::text = ANY ((ARRAY['in_review'::character varying, 'changes_requested'::character varying])::text[])) AND (s.first_viewed_at IS NULL)) AS unread,
    jsonb_build_object('totalPhotos', s.total_photos, 'approvedCount', s.approved_count, 'rejectedCount', s.rejected_count, 'viewed', (s.first_viewed_at IS NOT NULL)) AS metadata
   FROM (public.photo_approval_sessions s
     LEFT JOIN public.users u ON ((u.id = s.photographer_id)))
  WHERE ((s.status)::text <> 'completed'::text)
  WITH NO DATA;

-- Step 3: Recreate indexes
CREATE UNIQUE INDEX idx_crm_inbox_view_pk ON public.crm_inbox_view USING btree (type, id);
CREATE INDEX idx_inbox_mv_assigned ON public.crm_inbox_view USING btree (assigned_to) WHERE (assigned_to IS NOT NULL);
CREATE INDEX idx_inbox_mv_sort ON public.crm_inbox_view USING btree (priority, sort_time DESC NULLS LAST);
CREATE INDEX idx_inbox_mv_type ON public.crm_inbox_view USING btree (type);

-- Step 4: Populate the view
REFRESH MATERIALIZED VIEW public.crm_inbox_view;
