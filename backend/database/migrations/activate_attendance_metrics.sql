-- activate_attendance_metrics.sql
-- Активировать метрики attendance (смены используются) + таргеты
-- Идемпотентная миграция

BEGIN;

-- Активировать attendance метрики
UPDATE kpi_metric_definitions
SET is_active = true
WHERE code IN ('att_shift_completion', 'att_hours_worked', 'att_streak', 'att_punctuality')
  AND is_active = false;

-- Таргеты для attendance метрик (global scope) — идемпотентно через NOT EXISTS
INSERT INTO kpi_targets (metric_code, scope, target_value, stretch_value, minimum_value, effective_from)
SELECT v.metric_code, v.scope, v.target_value, v.stretch_value, v.minimum_value, v.effective_from::date
FROM (VALUES
  ('att_shift_completion', 'global', 90.0000, 98.0000, 75.0000, '2026-01-01'),
  ('att_hours_worked',     'global', 160.0000, 180.0000, 120.0000, '2026-01-01'),
  ('att_streak',           'global', 10.0000, 20.0000, 3.0000, '2026-01-01'),
  ('att_punctuality',      'global', 90.0000, 98.0000, 70.0000, '2026-01-01')
) AS v(metric_code, scope, target_value, stretch_value, minimum_value, effective_from)
WHERE NOT EXISTS (
  SELECT 1 FROM kpi_targets t
  WHERE t.metric_code = v.metric_code
    AND t.scope = v.scope
    AND t.scope_value IS NULL
    AND t.effective_from = v.effective_from::date
);

COMMIT;
