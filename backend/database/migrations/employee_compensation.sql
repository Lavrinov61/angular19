-- Employee compensation rates (daily_rate + commission_rate)
-- Supports rate history via effective_from / effective_until

CREATE TABLE IF NOT EXISTS employee_compensation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    daily_rate NUMERIC(10,2) NOT NULL,
    commission_rate NUMERIC(5,2) NOT NULL DEFAULT 10.0,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_until DATE,
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_compensation_employee
    ON employee_compensation(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_compensation_effective
    ON employee_compensation(employee_id, effective_from);

-- Seed: all employees get 1500₽/day, 10% commission
INSERT INTO employee_compensation (employee_id, daily_rate, commission_rate, effective_from, notes)
SELECT id, 1500, 10.0, '2026-01-01', 'Initial rate'
FROM users
WHERE role = 'employee'
ON CONFLICT DO NOTHING;

-- Anna gets 1800₽/day
UPDATE employee_compensation
SET daily_rate = 1800, notes = 'Senior rate'
WHERE employee_id IN (
    SELECT id FROM users WHERE display_name ILIKE '%Анна%' AND role = 'employee'
);

-- Also seed admin/photographer staff with default rate
INSERT INTO employee_compensation (employee_id, daily_rate, commission_rate, effective_from, notes)
SELECT id, 1500, 10.0, '2026-01-01', 'Initial rate'
FROM users
WHERE role IN ('admin', 'photographer') AND id NOT IN (SELECT employee_id FROM employee_compensation)
ON CONFLICT DO NOTHING;
