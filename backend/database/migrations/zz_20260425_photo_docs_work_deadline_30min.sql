-- Align photo-docs operator work deadlines with actual average processing time.
-- Previous values described customer lead time and inflated CRM task timers.

BEGIN;

UPDATE service_options so
SET
  name = 'Обычная (30 мин)',
  description = 'Стандартное время обработки',
  processing_time = '30 мин',
  features = '["Готово за 30 минут"]'::jsonb,
  estimated_minutes = 30,
  updated_at = NOW()
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE so.option_group_id = og.id
  AND sc.slug = 'photo-docs'
  AND og.slug = 'speed'
  AND so.slug = 'normal';

UPDATE service_options so
SET
  name = 'Срочная (10-15 мин)',
  description = 'Ускоренная обработка заказа',
  processing_time = '10-15 мин',
  features = '["Готово за 10-15 минут"]'::jsonb,
  estimated_minutes = 15,
  updated_at = NOW()
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE so.option_group_id = og.id
  AND sc.slug = 'photo-docs'
  AND og.slug = 'speed'
  AND so.slug = 'urgent';

WITH active_photo_doc_options AS (
  SELECT
    p.id AS order_pk,
    sc.id AS category_id,
    og.selection_type,
    so.estimated_minutes,
    CASE
      WHEN item.elem->>'sla_quantity' ~ '^[0-9]+$' THEN GREATEST((item.elem->>'sla_quantity')::int, 1)
      WHEN item.elem->>'quantity' ~ '^[0-9]+$' THEN GREATEST((item.elem->>'quantity')::int, 1)
      ELSE 1
    END AS units
  FROM photo_print_orders p
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(p.items::jsonb) = 'array' THEN p.items::jsonb
      ELSE '[]'::jsonb
    END
  ) AS item(elem)
  JOIN service_options so ON so.id::text = item.elem->>'service_option_id'
  JOIN option_groups og ON og.id = so.option_group_id
  JOIN service_categories sc ON sc.id = og.service_category_id
  WHERE p.deadline_at IS NULL
    AND p.status IN ('new', 'pending_payment', 'paid', 'processing', 'ready')
    AND p.payment_status IN ('pending', 'paid', 'none')
    AND p.created_at >= NOW() - INTERVAL '2 days'
    AND sc.slug = 'photo-docs'
),
category_sla AS (
  SELECT
    order_pk,
    category_id,
    MAX(CASE
      WHEN selection_type NOT IN ('multi', 'quantity') THEN GREATEST(COALESCE(estimated_minutes, 0), 0) * units
      ELSE 0
    END) AS max_single,
    SUM(CASE
      WHEN selection_type = 'multi' THEN GREATEST(COALESCE(estimated_minutes, 0), 0) * units
      ELSE 0
    END) AS sum_multi,
    SUM(CASE
      WHEN selection_type = 'quantity' THEN GREATEST(COALESCE(estimated_minutes, 0), 0) * units
      ELSE 0
    END) AS sum_quantity
  FROM active_photo_doc_options
  GROUP BY order_pk, category_id
),
order_sla AS (
  SELECT
    order_pk,
    GREATEST(COALESCE(SUM(max_single + sum_multi + sum_quantity), 0), 30) AS minutes
  FROM category_sla
  GROUP BY order_pk
),
updated_orders AS (
  UPDATE photo_print_orders p
  SET estimated_ready_at = p.created_at + order_sla.minutes * INTERVAL '1 minute'
  FROM order_sla
  WHERE p.id = order_sla.order_pk
    AND (
      p.estimated_ready_at IS NULL
      OR p.estimated_ready_at > p.created_at + order_sla.minutes * INTERVAL '1 minute'
    )
  RETURNING p.id, p.estimated_ready_at
)
UPDATE work_tasks t
SET
  sla_deadline = updated_orders.estimated_ready_at,
  due_date = updated_orders.estimated_ready_at,
  updated_at = NOW()
FROM updated_orders
WHERE t.print_order_id = updated_orders.id
  AND t.status NOT IN ('completed', 'cancelled');

COMMIT;
