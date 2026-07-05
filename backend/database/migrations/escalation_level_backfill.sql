-- Конвертировать существующие deadline_notified в escalation_level
-- и удалить устаревший флаг deadline_notified
UPDATE work_tasks
SET metadata = metadata - 'deadline_notified'
              || '{"escalation_level": 2}'::jsonb
WHERE metadata->>'deadline_notified' IS NOT NULL
  AND status NOT IN ('completed', 'cancelled');
