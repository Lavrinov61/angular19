-- Employee tax deductions (налоговые вычеты — возврат НДФЛ)
-- Категории: медицина, обучение, спорт, имущество, дети, благотворительность, профессиональные

CREATE TABLE IF NOT EXISTS employee_tax_deductions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    deduction_category VARCHAR(30) NOT NULL
        CHECK (deduction_category IN ('medical','education','sport','property','children','charity','professional','other')),
    amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    refund_amount NUMERIC(10,2) GENERATED ALWAYS AS (ROUND(amount * 0.13, 2)) STORED,
    description TEXT NOT NULL,
    tax_year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','applied','rejected')),
    document_url TEXT,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_tax_deductions_employee
    ON employee_tax_deductions(employee_id, tax_year);

CREATE INDEX IF NOT EXISTS idx_employee_tax_deductions_status
    ON employee_tax_deductions(status, tax_year);

-- Comments
COMMENT ON TABLE employee_tax_deductions IS 'Налоговые вычеты сотрудников (возврат НДФЛ 13%)';
COMMENT ON COLUMN employee_tax_deductions.deduction_category IS 'medical=лечение, education=обучение, sport=спорт, property=имущественный, children=на детей, charity=благотворительность, professional=профессиональный';
COMMENT ON COLUMN employee_tax_deductions.refund_amount IS 'Расчётная сумма возврата = amount × 13% (auto-computed)';
COMMENT ON COLUMN employee_tax_deductions.status IS 'pending=на рассмотрении, approved=одобрен, applied=применён к зарплате, rejected=отклонён';
