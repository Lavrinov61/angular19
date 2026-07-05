-- KPI System: Enterprise Employee Performance Tracking
-- Tables: kpi_metric_definitions, kpi_snapshots, kpi_targets,
--         kpi_composite_scores, kpi_alerts, kpi_weight_profiles
-- + ALTER employee_shifts (checked_in_at, checked_out_at)
-- Idempotent: safe to re-run

-- ─── 1. Metric Definitions (catalog) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS kpi_metric_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(60) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  name_ru VARCHAR(255) NOT NULL,
  category VARCHAR(30) NOT NULL
    CHECK (category IN ('productivity','quality','speed','revenue','satisfaction','attendance')),
  unit VARCHAR(20) NOT NULL DEFAULT 'count'
    CHECK (unit IN ('count','percent','seconds','rubles','number','hours')),
  direction VARCHAR(20) NOT NULL DEFAULT 'higher_better'
    CHECK (direction IN ('higher_better','lower_better')),
  default_weight DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  applicable_roles TEXT[] DEFAULT '{employee,photographer,admin,manager}',
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kpi_md_category ON kpi_metric_definitions(category);
CREATE INDEX IF NOT EXISTS idx_kpi_md_active ON kpi_metric_definitions(is_active) WHERE is_active;

-- ─── 2. Snapshots (daily/weekly/monthly per employee per metric) ─────

CREATE TABLE IF NOT EXISTS kpi_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric_code VARCHAR(60) NOT NULL REFERENCES kpi_metric_definitions(code) ON DELETE CASCADE,
  period_type VARCHAR(10) NOT NULL CHECK (period_type IN ('daily','weekly','monthly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  value DECIMAL(14,4) NOT NULL,
  sample_size INTEGER,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, metric_code, period_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_kpi_snap_emp_metric
  ON kpi_snapshots(employee_id, metric_code, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_kpi_snap_period
  ON kpi_snapshots(period_type, period_start);
CREATE INDEX IF NOT EXISTS idx_kpi_snap_metric_period
  ON kpi_snapshots(metric_code, period_type, period_start DESC);

-- ─── 3. Targets (global → role → employee cascade) ──────────────────

CREATE TABLE IF NOT EXISTS kpi_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_code VARCHAR(60) NOT NULL REFERENCES kpi_metric_definitions(code) ON DELETE CASCADE,
  scope VARCHAR(20) NOT NULL CHECK (scope IN ('global','role','employee')),
  scope_value VARCHAR(100),
  target_value DECIMAL(14,4) NOT NULL,
  stretch_value DECIMAL(14,4),
  minimum_value DECIMAL(14,4),
  effective_from DATE NOT NULL,
  effective_until DATE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kpi_targets_lookup
  ON kpi_targets(metric_code, scope, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_kpi_targets_scope_val
  ON kpi_targets(scope_value) WHERE scope_value IS NOT NULL;

-- ─── 4. Composite Scores (weighted aggregate per period) ─────────────

CREATE TABLE IF NOT EXISTS kpi_composite_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_type VARCHAR(10) NOT NULL CHECK (period_type IN ('daily','weekly','monthly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  composite_score DECIMAL(6,2) NOT NULL,
  rating VARCHAR(20) NOT NULL
    CHECK (rating IN ('exceptional','good','meeting','below','critical')),
  category_scores JSONB NOT NULL DEFAULT '{}',
  weights_snapshot JSONB NOT NULL DEFAULT '{}',
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, period_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_kpi_comp_emp
  ON kpi_composite_scores(employee_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_kpi_comp_rating
  ON kpi_composite_scores(rating, period_type);

-- ─── 5. Alerts (threshold-based) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS kpi_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric_code VARCHAR(60) NOT NULL REFERENCES kpi_metric_definitions(code) ON DELETE CASCADE,
  alert_type VARCHAR(20) NOT NULL
    CHECK (alert_type IN ('underperformance','excellence','trend_decline','target_missed')),
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('info','warning','critical')),
  period_type VARCHAR(10) NOT NULL,
  period_start DATE NOT NULL,
  current_value DECIMAL(14,4) NOT NULL,
  target_value DECIMAL(14,4),
  message TEXT NOT NULL,
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kpi_alerts_emp
  ON kpi_alerts(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kpi_alerts_unack
  ON kpi_alerts(acknowledged) WHERE NOT acknowledged;
CREATE INDEX IF NOT EXISTS idx_kpi_alerts_type
  ON kpi_alerts(alert_type);

-- ─── 6. Weight Profiles (composite score weights per role/global) ────

CREATE TABLE IF NOT EXISTS kpi_weight_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  scope VARCHAR(20) NOT NULL CHECK (scope IN ('global','role')),
  scope_value VARCHAR(50),
  weights JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(scope, scope_value)
);

-- ─── 7. ALTER employee_shifts ────────────────────────────────────────

ALTER TABLE employee_shifts
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ;

-- ═══════════════════════════════════════════════════════════════════════
-- SEED DATA
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Seed: 28 Metric Definitions ─────────────────────────────────────

INSERT INTO kpi_metric_definitions (code, name, name_ru, category, unit, direction, default_weight, applicable_roles, sort_order) VALUES
  -- Productivity (6)
  ('prod_tasks_completed',    'Tasks Completed',        'Задачи выполнены',       'productivity', 'count',   'higher_better', 1.50, '{employee,photographer,admin,manager}', 1),
  ('prod_orders_processed',   'Orders Processed',       'Заказы обработаны',      'productivity', 'count',   'higher_better', 1.50, '{employee,photographer,admin,manager}', 2),
  ('prod_chats_resolved',     'Chats Resolved',         'Чаты закрыты',           'productivity', 'count',   'higher_better', 1.00, '{employee,admin,manager}',               3),
  ('prod_bookings_conducted', 'Bookings Conducted',     'Сессии проведены',       'productivity', 'count',   'higher_better', 1.00, '{photographer}',                         4),
  ('prod_messages_sent',      'Messages Sent',          'Сообщения отправлены',   'productivity', 'count',   'higher_better', 0.50, '{employee,admin,manager}',               5),
  ('prod_approval_sessions',  'Approval Sessions',      'Сессии согласования',    'productivity', 'count',   'higher_better', 1.00, '{photographer,employee}',                6),

  -- Quality (5)
  ('qual_approval_rate',      'Photo Approval Rate',    'Процент одобрения',      'quality',      'percent', 'higher_better', 2.00, '{photographer,employee}',                7),
  ('qual_first_time_right',   'First-Time-Right Rate',  'С первого раза',         'quality',      'percent', 'higher_better', 1.50, '{photographer,employee}',                8),
  ('qual_revision_rate',      'Avg Revision Rounds',    'Среднее кол-во ревизий', 'quality',      'number',  'lower_better',  1.50, '{photographer,employee}',                9),
  ('qual_rework_count',       'Rework Count',           'Доработки',              'quality',      'count',   'lower_better',  1.00, '{photographer,employee}',               10),
  ('qual_quest_completion',   'Quest Completion Rate',  'Выполнение квестов',     'quality',      'percent', 'higher_better', 0.50, '{employee,photographer,admin,manager}', 11),

  -- Speed (5)
  ('speed_chat_first_response', 'Chat First Response',  'Время первого ответа',   'speed',        'seconds', 'lower_better',  1.50, '{employee,admin,manager}',              12),
  ('speed_chat_resolution',     'Chat Resolution Time', 'Время решения чата',     'speed',        'seconds', 'lower_better',  1.00, '{employee,admin,manager}',              13),
  ('speed_order_turnaround',    'Order Turnaround',     'Обработка заказа',       'speed',        'seconds', 'lower_better',  1.00, '{employee,photographer,admin,manager}', 14),
  ('speed_approval_turnaround', 'Approval Turnaround',  'Согласование ретуши',    'speed',        'seconds', 'lower_better',  1.00, '{photographer,employee}',               15),
  ('speed_task_completion',     'Task Completion Time',  'Выполнение задачи',      'speed',        'seconds', 'lower_better',  1.00, '{employee,photographer,admin,manager}', 16),

  -- Revenue (4)
  ('rev_total',             'Revenue Generated',      'Выручка',                'revenue',      'rubles',  'higher_better', 2.00, '{employee,photographer,admin,manager}', 17),
  ('rev_avg_check',         'Average Check',          'Средний чек',            'revenue',      'rubles',  'higher_better', 1.00, '{employee,photographer,admin,manager}', 18),
  ('rev_collection_rate',   'Payment Collection Rate','Оплата собрана',         'revenue',      'percent', 'higher_better', 1.00, '{employee,admin,manager}',              19),
  ('rev_upsell_count',      'Upsell Conversions',    'Апселлы (портрет)',      'revenue',      'count',   'higher_better', 1.00, '{photographer,employee}',               20),

  -- Satisfaction (4)
  ('sat_avg_rating',        'Avg Customer Rating',    'Средняя оценка',         'satisfaction', 'number',  'higher_better', 2.00, '{employee,photographer,admin,manager}', 21),
  ('sat_feedback_count',    'Feedback Collected',     'Отзывы собраны',         'satisfaction', 'count',   'higher_better', 1.00, '{employee,photographer,admin,manager}', 22),
  ('sat_csat',              'Chat CSAT Score',        'CSAT чатов',             'satisfaction', 'number',  'higher_better', 1.50, '{employee,admin,manager}',              23),
  ('sat_nps_proxy',         'NPS Proxy (% 5-star)',   'NPS Proxy',              'satisfaction', 'percent', 'higher_better', 1.00, '{employee,photographer,admin,manager}', 24),

  -- Attendance (4)
  ('att_shift_completion',  'Shift Completion Rate',  'Завершение смен',        'attendance',   'percent', 'higher_better', 1.50, '{employee,photographer,admin,manager}', 25),
  ('att_hours_worked',      'Hours Worked',           'Часы отработаны',        'attendance',   'hours',   'higher_better', 1.00, '{employee,photographer,admin,manager}', 26),
  ('att_streak',            'Consecutive Days',       'Дни подряд',             'attendance',   'count',   'higher_better', 0.50, '{employee,photographer,admin,manager}', 27),
  ('att_punctuality',       'On-time Arrival Rate',   'Пунктуальность',         'attendance',   'percent', 'higher_better', 1.00, '{employee,photographer,admin,manager}', 28)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  name_ru = EXCLUDED.name_ru,
  category = EXCLUDED.category,
  unit = EXCLUDED.unit,
  direction = EXCLUDED.direction,
  default_weight = EXCLUDED.default_weight,
  applicable_roles = EXCLUDED.applicable_roles,
  sort_order = EXCLUDED.sort_order;

-- ─── Seed: Default Weight Profile (global) ───────────────────────────

INSERT INTO kpi_weight_profiles (name, scope, scope_value, weights) VALUES
  ('Базовый профиль', 'global', NULL, '{
    "prod_tasks_completed": 1.5,
    "prod_orders_processed": 1.5,
    "prod_chats_resolved": 1.0,
    "prod_bookings_conducted": 1.0,
    "prod_messages_sent": 0.5,
    "prod_approval_sessions": 1.0,
    "qual_approval_rate": 2.0,
    "qual_first_time_right": 1.5,
    "qual_revision_rate": 1.5,
    "qual_rework_count": 1.0,
    "qual_quest_completion": 0.5,
    "speed_chat_first_response": 1.5,
    "speed_chat_resolution": 1.0,
    "speed_order_turnaround": 1.0,
    "speed_approval_turnaround": 1.0,
    "speed_task_completion": 1.0,
    "rev_total": 2.0,
    "rev_avg_check": 1.0,
    "rev_collection_rate": 1.0,
    "rev_upsell_count": 1.0,
    "sat_avg_rating": 2.0,
    "sat_feedback_count": 1.0,
    "sat_csat": 1.5,
    "sat_nps_proxy": 1.0,
    "att_shift_completion": 1.5,
    "att_hours_worked": 1.0,
    "att_streak": 0.5,
    "att_punctuality": 1.0
  }')
ON CONFLICT (scope, scope_value) DO UPDATE SET
  weights = EXCLUDED.weights,
  updated_at = NOW();

-- ─── Seed: Default Global Targets ────────────────────────────────────

INSERT INTO kpi_targets (metric_code, scope, scope_value, target_value, stretch_value, minimum_value, effective_from) VALUES
  -- Productivity
  ('prod_tasks_completed',    'global', NULL,  10,    15,     5,   '2026-01-01'),
  ('prod_orders_processed',   'global', NULL,   8,    12,     3,   '2026-01-01'),
  ('prod_chats_resolved',     'global', NULL,  10,    15,     5,   '2026-01-01'),
  ('prod_bookings_conducted', 'global', NULL,   5,     8,     2,   '2026-01-01'),
  ('prod_messages_sent',      'global', NULL,  50,    80,    20,   '2026-01-01'),
  ('prod_approval_sessions',  'global', NULL,   3,     5,     1,   '2026-01-01'),
  -- Quality
  ('qual_approval_rate',      'global', NULL,  80,    95,    60,   '2026-01-01'),
  ('qual_first_time_right',   'global', NULL,  70,    90,    50,   '2026-01-01'),
  ('qual_revision_rate',      'global', NULL,   1.5,   1.0,   3.0, '2026-01-01'),
  ('qual_rework_count',       'global', NULL,   2,     0,     5,   '2026-01-01'),
  ('qual_quest_completion',   'global', NULL,  80,   100,    50,   '2026-01-01'),
  -- Speed (seconds)
  ('speed_chat_first_response','global', NULL, 120,    60,   300,  '2026-01-01'),
  ('speed_chat_resolution',    'global', NULL, 900,   600,  1800,  '2026-01-01'),
  ('speed_order_turnaround',   'global', NULL, 3600, 1800,  7200,  '2026-01-01'),
  ('speed_approval_turnaround','global', NULL, 86400,43200,172800, '2026-01-01'),
  ('speed_task_completion',    'global', NULL, 7200, 3600, 14400,  '2026-01-01'),
  -- Revenue
  ('rev_total',             'global', NULL, 15000, 25000, 5000, '2026-01-01'),
  ('rev_avg_check',         'global', NULL,  1500,  2500,  800, '2026-01-01'),
  ('rev_collection_rate',   'global', NULL,    80,    95,   60, '2026-01-01'),
  ('rev_upsell_count',      'global', NULL,     2,     4,    0, '2026-01-01'),
  -- Satisfaction
  ('sat_avg_rating',        'global', NULL,   4.0,   4.5,  3.0, '2026-01-01'),
  ('sat_feedback_count',    'global', NULL,     5,    10,    2,  '2026-01-01'),
  ('sat_csat',              'global', NULL,   4.0,   4.5,  3.0, '2026-01-01'),
  ('sat_nps_proxy',         'global', NULL,    60,    80,   40,  '2026-01-01'),
  -- Attendance
  ('att_shift_completion',  'global', NULL,    90,   100,   70,  '2026-01-01'),
  ('att_hours_worked',      'global', NULL,   8.0,  10.0,  6.0, '2026-01-01'),
  ('att_streak',            'global', NULL,     5,    10,    2,  '2026-01-01'),
  ('att_punctuality',       'global', NULL,    90,   100,   70,  '2026-01-01')
ON CONFLICT DO NOTHING;
