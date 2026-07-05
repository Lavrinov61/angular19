-- План 2: График работы сотрудников с подтверждением
-- Таблица запросов на создание/изменение графика

CREATE TABLE IF NOT EXISTS schedule_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES users(id),
  shift_pattern VARCHAR(10) NOT NULL CHECK (shift_pattern IN ('2/2', '1/1', '3/3', 'custom')),
  pattern_start_date DATE NOT NULL,
  end_date DATE, -- до какой даты включительно строить паттерн (по умолчанию +30 дней)
  requested_shifts JSONB NOT NULL DEFAULT '[]',
  -- каждый элемент: {"date": "2026-03-01", "start_time": "09:00", "end_time": "19:30"}
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'revision_requested')),
  admin_id UUID REFERENCES users(id),
  admin_comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedule_requests_employee ON schedule_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_schedule_requests_status ON schedule_requests(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_schedule_requests_created ON schedule_requests(created_at DESC);
