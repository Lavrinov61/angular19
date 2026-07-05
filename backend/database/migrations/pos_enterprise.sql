-- POS Enterprise: consumables, inventory, employee sales & commissions
-- Idempotent: all CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS

BEGIN;

-- ============================================================
-- 1. consumable_rules — правила автосписания расходников
-- ============================================================
CREATE TABLE IF NOT EXISTS consumable_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_option_id UUID NOT NULL REFERENCES service_options(id) ON DELETE CASCADE,
    product_stock_id UUID NOT NULL REFERENCES product_stock(id) ON DELETE CASCADE,
    quantity_per_unit NUMERIC(10,3) NOT NULL,
    unit_label VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(service_option_id, product_stock_id)
);

-- ============================================================
-- 2. inventory_transactions — append-only лог движений
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_stock_id UUID NOT NULL REFERENCES product_stock(id),
    studio_id UUID NOT NULL,
    type VARCHAR(30) NOT NULL CHECK (type IN (
        'receipt_deduction',
        'consumable_deduction',
        'receipt_refund',
        'manual_receive',
        'manual_writeoff',
        'transfer_out',
        'transfer_in',
        'audit_adjustment'
    )),
    quantity NUMERIC(12,3) NOT NULL,
    reference_id VARCHAR(100),
    reference_type VARCHAR(30),
    employee_id UUID REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_product_date
    ON inventory_transactions(product_stock_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_studio_type_date
    ON inventory_transactions(studio_id, type, created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_reference
    ON inventory_transactions(reference_id);

-- ============================================================
-- 3. inventory_audits — инвентаризации
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    studio_id UUID NOT NULL,
    employee_id UUID NOT NULL REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'cancelled')),
    started_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
    notes TEXT
);

-- ============================================================
-- 4. inventory_audit_items — позиции инвентаризации
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_audit_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id UUID NOT NULL REFERENCES inventory_audits(id) ON DELETE CASCADE,
    product_stock_id UUID NOT NULL REFERENCES product_stock(id),
    system_quantity NUMERIC(12,3) NOT NULL,
    actual_quantity NUMERIC(12,3),
    discrepancy NUMERIC(12,3) GENERATED ALWAYS AS (actual_quantity - system_quantity) STORED,
    UNIQUE(audit_id, product_stock_id)
);

-- ============================================================
-- 5. employee_sales — атрибуция продаж
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES pos_receipts(id) ON DELETE CASCADE UNIQUE,
    employee_id UUID NOT NULL REFERENCES users(id),
    receipt_total NUMERIC(12,2) NOT NULL,
    commission_rate NUMERIC(5,4) DEFAULT 0,
    commission_amount NUMERIC(12,2) GENERATED ALWAYS AS (receipt_total * commission_rate) STORED,
    category_slug VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_sales_employee_date
    ON employee_sales(employee_id, created_at);

-- ============================================================
-- 6. employee_commission_rules — правила комиссий
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_commission_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES users(id),
    role VARCHAR(50),
    category_slug VARCHAR(100),
    rate NUMERIC(5,4) NOT NULL,
    min_receipt_total NUMERIC(12,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    priority INT DEFAULT 0,
    UNIQUE(employee_id, role, category_slug)
);

-- ============================================================
-- 7. employee_commission_payouts — месячные выплаты
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_commission_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES users(id),
    period VARCHAR(7) NOT NULL,
    total_sales NUMERIC(12,2) DEFAULT 0,
    total_receipts INT DEFAULT 0,
    total_commission NUMERIC(12,2) DEFAULT 0,
    plan_target NUMERIC(12,2),
    plan_percent NUMERIC(5,2) GENERATED ALWAYS AS (
        CASE WHEN plan_target > 0 THEN (total_sales / plan_target * 100) ELSE 0 END
    ) STORED,
    plan_bonus NUMERIC(12,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid')),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    UNIQUE(employee_id, period)
);

-- ============================================================
-- ALTER: добавляем колонки к существующим таблицам
-- ============================================================
ALTER TABLE pos_receipts ADD COLUMN IF NOT EXISTS idempotency_key UUID UNIQUE;

ALTER TABLE product_stock ADD COLUMN IF NOT EXISTS avg_daily_usage NUMERIC(10,3) DEFAULT 0;
ALTER TABLE product_stock ADD COLUMN IF NOT EXISTS days_until_empty INTEGER;

ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS cash_collected NUMERIC(12,2) DEFAULT 0;
ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS collection_count INTEGER DEFAULT 0;

COMMIT;
