-- Unified Deadline: sla_deadline в work_tasks
-- sla_deadline = source of truth для дедлайна задачи, синхронизирован с estimated_ready_at

ALTER TABLE work_tasks ADD COLUMN IF NOT EXISTS sla_deadline timestamptz;

-- Backfill из linked photo_print_orders
UPDATE work_tasks t SET sla_deadline = p.estimated_ready_at
FROM photo_print_orders p
WHERE t.print_order_id = p.id AND p.estimated_ready_at IS NOT NULL
  AND t.status NOT IN ('completed', 'cancelled');

-- Для задач без linked order — fallback на due_date
UPDATE work_tasks SET sla_deadline = due_date
WHERE sla_deadline IS NULL AND due_date IS NOT NULL
  AND status NOT IN ('completed', 'cancelled');
