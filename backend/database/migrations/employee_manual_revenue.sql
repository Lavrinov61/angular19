-- Employee manual revenue — доп. выручка мимо POS (вводится админом)
CREATE TABLE IF NOT EXISTS employee_manual_revenue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES users(id),
  month VARCHAR(7) NOT NULL,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  description TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, month)
);

CREATE INDEX IF NOT EXISTS idx_emr_employee_month ON employee_manual_revenue(employee_id, month);
