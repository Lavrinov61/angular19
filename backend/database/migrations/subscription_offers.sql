-- Subscription offers: operator sends subscription link to customer in chat
-- Idempotent: safe to re-run

CREATE TABLE IF NOT EXISTS subscription_offers (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    plan_id UUID NOT NULL REFERENCES subscription_plans(id),
    employee_id UUID NOT NULL REFERENCES users(id),
    chat_session_id UUID NOT NULL REFERENCES conversations(id),
    customer_phone VARCHAR(20),
    customer_name VARCHAR(255),
    token VARCHAR(64) NOT NULL UNIQUE,
    status VARCHAR(20) DEFAULT 'sent' CHECK (status IN ('sent', 'opened', 'accepted', 'declined', 'expired')),
    monthly_price NUMERIC(10,2) NOT NULL,
    message_id UUID REFERENCES messages(id),
    subscription_id UUID REFERENCES user_subscriptions(id),
    expires_at TIMESTAMPTZ NOT NULL,
    opened_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_offers_token ON subscription_offers(token) WHERE status IN ('sent', 'opened');
CREATE INDEX IF NOT EXISTS idx_sub_offers_session ON subscription_offers(chat_session_id);
CREATE INDEX IF NOT EXISTS idx_sub_offers_employee ON subscription_offers(employee_id);
