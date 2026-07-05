-- POS System + Subscriptions Migration
-- Replaces Kontur.Market with own catalog, POS, and subscription model

-- ========================================
-- КАТАЛОГ ТОВАРОВ И УСЛУГ
-- ========================================

CREATE TABLE IF NOT EXISTS product_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_id UUID REFERENCES product_categories(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    sort_order INT DEFAULT 0,
    icon VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_categories_parent ON product_categories(parent_id);

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id UUID REFERENCES product_categories(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    product_type VARCHAR(20) NOT NULL DEFAULT 'service'
        CHECK (product_type IN ('product', 'service')),
    code VARCHAR(50),
    barcode VARCHAR(50),
    unit VARCHAR(20) DEFAULT 'piece'
        CHECK (unit IN ('piece', 'sheet', 'copy', 'set', 'meter', 'kg', 'liter', 'hour', 'minute')),
    sell_price DECIMAL(10,2) NOT NULL,
    cost_price DECIMAL(10,2),
    vat_rate VARCHAR(20) DEFAULT 'NoVat'
        CHECK (vat_rate IN ('NoVat', 'Zero', 'Main', 'Preferential')),
    tax_system VARCHAR(20) DEFAULT 'StsIncome'
        CHECK (tax_system IN ('Bts', 'StsIncome', 'StsExpenses', 'Patent')),
    is_discount_allowed BOOLEAN DEFAULT true,
    is_bonus_allowed BOOLEAN DEFAULT true,
    is_subscription_eligible BOOLEAN DEFAULT false,
    subscription_credit_value DECIMAL(10,2),
    image_url VARCHAR(500),
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    is_favorite BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_code ON products(code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_type ON products(product_type);
CREATE INDEX IF NOT EXISTS idx_products_favorite ON products(is_favorite) WHERE is_favorite = true;
CREATE INDEX IF NOT EXISTS idx_products_subscription ON products(is_subscription_eligible) WHERE is_subscription_eligible = true;

CREATE TABLE IF NOT EXISTS product_stock (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
    quantity DECIMAL(10,3) DEFAULT 0,
    min_quantity DECIMAL(10,3) DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_stock_unique ON product_stock(product_id, studio_id);

-- ========================================
-- POS-КАССОВЫЕ СМЕНЫ
-- ========================================

CREATE TABLE IF NOT EXISTS pos_shifts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES users(id),
    studio_id UUID NOT NULL REFERENCES studios(id),
    shift_number SERIAL,
    opened_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    cash_at_open DECIMAL(10,2) DEFAULT 0,
    cash_at_close DECIMAL(10,2),
    expected_cash DECIMAL(10,2),
    status VARCHAR(20) DEFAULT 'open'
        CHECK (status IN ('open', 'closed')),
    total_sales DECIMAL(10,2) DEFAULT 0,
    total_refunds DECIMAL(10,2) DEFAULT 0,
    receipt_count INT DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pos_shifts_employee ON pos_shifts(employee_id);
CREATE INDEX IF NOT EXISTS idx_pos_shifts_studio ON pos_shifts(studio_id);
CREATE INDEX IF NOT EXISTS idx_pos_shifts_status ON pos_shifts(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_pos_shifts_date ON pos_shifts(opened_at);

-- ========================================
-- POS-ЧЕКИ (RECEIPTS)
-- ========================================

CREATE SEQUENCE IF NOT EXISTS pos_receipt_seq START 1;

CREATE TABLE IF NOT EXISTS pos_receipts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    receipt_number VARCHAR(20) NOT NULL,
    shift_id UUID NOT NULL REFERENCES pos_shifts(id),
    employee_id UUID NOT NULL REFERENCES users(id),
    studio_id UUID NOT NULL REFERENCES studios(id),
    customer_phone VARCHAR(20),
    customer_name VARCHAR(255),
    loyalty_profile_id UUID REFERENCES loyalty_profiles(id),
    subscription_id UUID,
    is_refund BOOLEAN DEFAULT false,
    refund_receipt_id UUID REFERENCES pos_receipts(id),
    subtotal DECIMAL(10,2) NOT NULL,
    discount_total DECIMAL(10,2) DEFAULT 0,
    points_discount DECIMAL(10,2) DEFAULT 0,
    subscription_credit_used DECIMAL(10,2) DEFAULT 0,
    total DECIMAL(10,2) NOT NULL,
    fiscal_receipt_url VARCHAR(500),
    fiscal_receipt_number VARCHAR(50),
    fiscal_sign VARCHAR(50),
    fiscal_source VARCHAR(20) DEFAULT 'atol27f'
        CHECK (fiscal_source IN ('atol27f', 'cloudkassir')),
    print_order_id INT,
    task_id INT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pos_receipts_shift ON pos_receipts(shift_id);
CREATE INDEX IF NOT EXISTS idx_pos_receipts_customer ON pos_receipts(customer_phone) WHERE customer_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_receipts_date ON pos_receipts(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_receipts_number ON pos_receipts(receipt_number);
CREATE INDEX IF NOT EXISTS idx_pos_receipts_refund ON pos_receipts(refund_receipt_id) WHERE refund_receipt_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS pos_receipt_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    receipt_id UUID NOT NULL REFERENCES pos_receipts(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id),
    product_name VARCHAR(255) NOT NULL,
    quantity DECIMAL(10,3) NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    points_used DECIMAL(10,2) DEFAULT 0,
    subscription_credits_used DECIMAL(10,2) DEFAULT 0,
    total DECIMAL(10,2) NOT NULL,
    vat_rate VARCHAR(20),
    vat_amount DECIMAL(10,2) DEFAULT 0,
    sort_order INT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pos_receipt_items_receipt ON pos_receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_pos_receipt_items_product ON pos_receipt_items(product_id) WHERE product_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS pos_receipt_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    receipt_id UUID NOT NULL REFERENCES pos_receipts(id) ON DELETE CASCADE,
    payment_type VARCHAR(20) NOT NULL
        CHECK (payment_type IN ('cash', 'card', 'sbp', 'online', 'subscription', 'transfer')),
    amount DECIMAL(10,2) NOT NULL,
    card_info VARCHAR(50),
    transaction_id VARCHAR(100),
    sbp_qr_url VARCHAR(500),
    status VARCHAR(20) DEFAULT 'completed'
        CHECK (status IN ('completed', 'pending', 'failed', 'refunded'))
);
CREATE INDEX IF NOT EXISTS idx_pos_receipt_payments_receipt ON pos_receipt_payments(receipt_id);
CREATE INDEX IF NOT EXISTS idx_pos_receipt_payments_type ON pos_receipt_payments(payment_type);

-- ========================================
-- ПОДПИСОЧНАЯ МОДЕЛЬ
-- ========================================

CREATE TABLE IF NOT EXISTS subscription_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    base_price DECIMAL(10,2) NOT NULL,
    is_customizable BOOLEAN DEFAULT true,
    min_price DECIMAL(10,2),
    billing_period VARCHAR(20) DEFAULT 'monthly'
        CHECK (billing_period IN ('monthly', 'quarterly', 'yearly')),
    subscriber_discount_percent DECIMAL(5,2) DEFAULT 0,
    credits_rollover_months INT DEFAULT 3,
    is_active BOOLEAN DEFAULT true,
    sort_order INT DEFAULT 0,
    features JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_plan_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    included_quantity DECIMAL(10,3) NOT NULL,
    credit_price DECIMAL(10,2),
    is_required BOOLEAN DEFAULT false,
    sort_order INT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sub_plan_items_plan ON subscription_plan_items(plan_id);
CREATE INDEX IF NOT EXISTS idx_sub_plan_items_product ON subscription_plan_items(product_id);

CREATE TABLE IF NOT EXISTS user_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    phone VARCHAR(20),
    customer_name VARCHAR(255),
    plan_id UUID REFERENCES subscription_plans(id),
    custom_items JSONB DEFAULT '[]',
    monthly_price DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'cancelled', 'expired', 'pending')),
    cloudpayments_subscription_id VARCHAR(100),
    cloudpayments_token VARCHAR(255),
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    next_payment_date TIMESTAMPTZ,
    pause_until TIMESTAMPTZ,
    cancel_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_subs_phone ON user_subscriptions(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_subs_user ON user_subscriptions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_subs_status ON user_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_user_subs_next_payment ON user_subscriptions(next_payment_date) WHERE status = 'active';

-- Add FK from pos_receipts to user_subscriptions (after user_subscriptions created)
ALTER TABLE pos_receipts
    ADD CONSTRAINT fk_pos_receipts_subscription
    FOREIGN KEY (subscription_id) REFERENCES user_subscriptions(id);

CREATE TABLE IF NOT EXISTS subscription_credits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscription_id UUID NOT NULL REFERENCES user_subscriptions(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    total_credits DECIMAL(10,3) NOT NULL,
    used_credits DECIMAL(10,3) DEFAULT 0,
    rolled_over_from UUID REFERENCES subscription_credits(id),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sub_credits_sub ON subscription_credits(subscription_id);
CREATE INDEX IF NOT EXISTS idx_sub_credits_product ON subscription_credits(product_id);
CREATE INDEX IF NOT EXISTS idx_sub_credits_active ON subscription_credits(expires_at) WHERE used_credits < total_credits;
CREATE INDEX IF NOT EXISTS idx_sub_credits_period ON subscription_credits(period_start, period_end);
