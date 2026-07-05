-- KPI Calibration: realistic targets for a photo studio with 3-4 employees
-- Fixes: unrealistic targets, deactivates metrics with no source data
-- Idempotent: safe to re-run
--
-- Data audit (2026-03-09):
--   photo_print_orders = 0 → revenue metrics dead
--   work_tasks = 0 → task metrics dead
--   employee_shifts = 3 (none completed) → attendance metrics dead
--   visitor_chat_sessions = 1508, chats/day/person ≈ 2-3
--   photo_approval_sessions = 18, approvals = 47
--   customer_feedback = 7 (all 5-star)
--   bookings = 7

-- ══════════════════════════════════════════════════════════════════════
-- 1. DEACTIVATE metrics with no source data (will be re-enabled when
--    the corresponding feature is deployed and used)
-- ══════════════════════════════════════════════════════════════════════

UPDATE kpi_metric_definitions SET is_active = false WHERE code IN (
  -- Revenue: 0 orders in system
  'rev_total',
  'rev_avg_check',
  'rev_collection_rate',
  -- Tasks: work_tasks not in use
  'prod_tasks_completed',
  'speed_task_completion',
  -- Orders: photo_print_orders not in use
  'prod_orders_processed',
  'speed_order_turnaround',
  -- Attendance: shifts not tracked yet
  'att_shift_completion',
  'att_hours_worked',
  'att_streak',
  'att_punctuality',
  -- CSAT: not collected
  'sat_csat'
);

-- ══════════════════════════════════════════════════════════════════════
-- 2. CALIBRATE targets for ACTIVE metrics to match real studio workload
--    Based on actual data: ~2-3 chats/day, ~1 approval/day, ~1 booking/week
-- ══════════════════════════════════════════════════════════════════════

-- Productivity (daily targets per employee)
UPDATE kpi_targets SET target_value = 3, stretch_value = 5, minimum_value = 1
  WHERE metric_code = 'prod_chats_resolved' AND scope = 'global';

UPDATE kpi_targets SET target_value = 15, stretch_value = 25, minimum_value = 5
  WHERE metric_code = 'prod_messages_sent' AND scope = 'global';

UPDATE kpi_targets SET target_value = 1, stretch_value = 3, minimum_value = 0
  WHERE metric_code = 'prod_approval_sessions' AND scope = 'global';

UPDATE kpi_targets SET target_value = 1, stretch_value = 2, minimum_value = 0
  WHERE metric_code = 'prod_bookings_conducted' AND scope = 'global';

-- Quality
UPDATE kpi_targets SET target_value = 70, stretch_value = 90, minimum_value = 50
  WHERE metric_code = 'qual_approval_rate' AND scope = 'global';

UPDATE kpi_targets SET target_value = 60, stretch_value = 80, minimum_value = 40
  WHERE metric_code = 'qual_first_time_right' AND scope = 'global';

UPDATE kpi_targets SET target_value = 2.0, stretch_value = 1.5, minimum_value = 3.0
  WHERE metric_code = 'qual_revision_rate' AND scope = 'global';

UPDATE kpi_targets SET target_value = 3, stretch_value = 1, minimum_value = 6
  WHERE metric_code = 'qual_rework_count' AND scope = 'global';

UPDATE kpi_targets SET target_value = 50, stretch_value = 80, minimum_value = 20
  WHERE metric_code = 'qual_quest_completion' AND scope = 'global';

-- Speed (seconds — realistic for a small studio, not a call center)
UPDATE kpi_targets SET target_value = 600, stretch_value = 300, minimum_value = 1800
  WHERE metric_code = 'speed_chat_first_response' AND scope = 'global';
  -- 10 min target, 5 min stretch, 30 min minimum (was 2 min / 1 min / 5 min)

UPDATE kpi_targets SET target_value = 14400, stretch_value = 7200, minimum_value = 28800
  WHERE metric_code = 'speed_chat_resolution' AND scope = 'global';
  -- 4h target, 2h stretch, 8h minimum (was 15 min / 10 min / 30 min)

UPDATE kpi_targets SET target_value = 3600, stretch_value = 1800, minimum_value = 7200
  WHERE metric_code = 'speed_approval_turnaround' AND scope = 'global';
  -- 1h target, 30min stretch, 2h minimum (was 24h / 12h / 48h)

-- Satisfaction
UPDATE kpi_targets SET target_value = 4.0, stretch_value = 4.5, minimum_value = 3.0
  WHERE metric_code = 'sat_avg_rating' AND scope = 'global';
  -- keep as is

UPDATE kpi_targets SET target_value = 1, stretch_value = 3, minimum_value = 0
  WHERE metric_code = 'sat_feedback_count' AND scope = 'global';
  -- 1/day (was 5/day — unrealistic)

UPDATE kpi_targets SET target_value = 50, stretch_value = 80, minimum_value = 20
  WHERE metric_code = 'sat_nps_proxy' AND scope = 'global';
  -- 50% 5-star (was 60%)

-- Revenue (only upsell remains active)
UPDATE kpi_targets SET target_value = 1, stretch_value = 2, minimum_value = 0
  WHERE metric_code = 'rev_upsell_count' AND scope = 'global';
  -- 1/day (was 2/day)

-- ══════════════════════════════════════════════════════════════════════
-- 3. UPDATE weight profile — lower weights for metrics with sparse data,
--    higher for metrics with consistent daily data
-- ══════════════════════════════════════════════════════════════════════

UPDATE kpi_weight_profiles
SET weights = '{
  "prod_chats_resolved": 2.0,
  "prod_messages_sent": 1.0,
  "prod_approval_sessions": 1.5,
  "prod_bookings_conducted": 1.0,
  "qual_approval_rate": 2.0,
  "qual_first_time_right": 1.5,
  "qual_revision_rate": 1.5,
  "qual_rework_count": 1.0,
  "qual_quest_completion": 0.5,
  "speed_chat_first_response": 2.0,
  "speed_chat_resolution": 1.5,
  "speed_approval_turnaround": 1.0,
  "sat_avg_rating": 2.0,
  "sat_feedback_count": 0.5,
  "sat_nps_proxy": 1.0,
  "rev_upsell_count": 0.5
}'::jsonb,
updated_at = NOW()
WHERE scope = 'global' AND scope_value IS NULL;

-- ══════════════════════════════════════════════════════════════════════
-- 4. PURGE stale composite scores and snapshots — they were computed
--    with unrealistic targets. Scheduler will recompute on next run.
-- ══════════════════════════════════════════════════════════════════════

TRUNCATE kpi_composite_scores;
TRUNCATE kpi_alerts;
-- Keep snapshots — raw metric values are still valid, only composite scoring changes
