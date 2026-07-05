-- ============================================================
-- Phase 6: Workflow Automation Engine + Partner Program
-- Wave 6 — ФотоПульт CRM v2.0
-- ============================================================

-- ── Workflow Automation ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS workflows (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  -- Trigger: событие, запускающее workflow
  trigger_type VARCHAR(50) NOT NULL, -- 'order_paid' | 'chat_created' | 'chat_closed' | 'booking_completed' | 'manual'
  -- Conditions: [{field, op, value}] — все условия AND-логика
  conditions JSONB DEFAULT '[]',
  -- Actions: [{type, params, delay_seconds}] — выполняются по порядку
  actions JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  run_count INTEGER DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE workflows IS 'Workflow-автоматизации ФотоПульта: триггер → условия → действия';
COMMENT ON COLUMN workflows.trigger_type IS 'order_paid | chat_created | chat_closed | booking_completed | manual';
COMMENT ON COLUMN workflows.conditions IS '[{field, op, value}] — AND-логика. Пример: [{field:"amount",op:"gt",value:1000}]';
COMMENT ON COLUMN workflows.actions IS '[{type, params, delay_seconds}]. Типы: create_task|notify_team|send_email|add_note|set_tag';

CREATE TABLE IF NOT EXISTS workflow_runs (
  id SERIAL PRIMARY KEY,
  workflow_id INTEGER REFERENCES workflows(id) ON DELETE CASCADE,
  -- Данные триггера (payload события)
  trigger_data JSONB DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'pending', -- pending | running | completed | failed | skipped
  -- Результат выполнения (массив результатов по каждому action)
  result JSONB DEFAULT '[]',
  error_message TEXT,
  -- Когда запустить (для отложенных actions)
  scheduled_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status, scheduled_at) WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS idx_workflows_trigger ON workflows(trigger_type, is_active);

-- Seed: несколько примерных workflows для онбординга
INSERT INTO workflows (name, description, trigger_type, conditions, actions, is_active) VALUES
(
  'Запрос отзыва после оплаты',
  'Создаёт задачу-напоминание отправить запрос отзыва через 24 часа после оплаты заказа',
  'order_paid',
  '[{"field":"amount","op":"gte","value":500}]',
  '[{"type":"create_task","params":{"title":"Запросить отзыв у клиента","priority":"low","delay_hours":24},"delay_seconds":0}]',
  false
),
(
  'Уведомление о новом чате',
  'Отправляет уведомление команде при создании нового чата на сайте',
  'chat_created',
  '[]',
  '[{"type":"notify_team","params":{"message":"Новый чат от посетителя сайта!"},"delay_seconds":0}]',
  false
)
ON CONFLICT DO NOTHING;

-- ── Partner Program ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS partners (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Информация о партнёре (если не зарегистрирован в системе)
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20),
  type VARCHAR(20) NOT NULL DEFAULT 'referral', -- referral | business | affiliate
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | approved | suspended | rejected
  -- Финансы
  commission_rate DECIMAL(5,2) DEFAULT 50.00, -- % от суммы реферала
  balance DECIMAL(10,2) DEFAULT 0.00,         -- текущий баланс к выплате
  total_earned DECIMAL(10,2) DEFAULT 0.00,    -- всего заработано
  -- Реферальная ссылка
  promo_code VARCHAR(50) UNIQUE,
  referral_url TEXT,
  -- Реквизиты для выплат
  payout_details JSONB DEFAULT '{}', -- {method: 'card'|'phone', account: '...'}
  -- Комментарии и управление
  notes TEXT,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE partners IS 'Партнёрская программа: реферальные, бизнес, аффилиат партнёры';

CREATE TABLE IF NOT EXISTS partner_referrals (
  id SERIAL PRIMARY KEY,
  partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  -- Связанный заказ
  order_id INTEGER,                          -- ссылка на orders.id или photo_print_orders.id
  order_type VARCHAR(20) DEFAULT 'print',    -- print | booking | service
  order_amount DECIMAL(10,2) NOT NULL,
  commission_amount DECIMAL(10,2) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',      -- pending | confirmed | paid | cancelled
  -- Источник (для атрибуции)
  promo_code VARCHAR(50),
  referral_url TEXT,
  client_phone VARCHAR(20),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_referrals_partner ON partner_referrals(partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_referrals_status ON partner_referrals(status) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS partner_payouts (
  id SERIAL PRIMARY KEY,
  partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  method VARCHAR(20) NOT NULL DEFAULT 'card', -- card | phone | bank_transfer
  -- Реквизиты для этой выплаты (копия из partner.payout_details на момент выплаты)
  payout_details JSONB DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | processing | completed | failed | cancelled
  notes TEXT,
  processed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_payouts_partner ON partner_payouts(partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_payouts_status ON partner_payouts(status) WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_partners_status ON partners(status);
CREATE INDEX IF NOT EXISTS idx_partners_promo ON partners(promo_code) WHERE promo_code IS NOT NULL;
