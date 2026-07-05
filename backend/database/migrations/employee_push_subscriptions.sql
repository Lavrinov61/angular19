-- Employee push subscriptions for Web Push (VAPID)
-- Used by web-push-notify.service.ts

CREATE TABLE IF NOT EXISTS employee_push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    keys JSONB NOT NULL DEFAULT '{}',
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_employee_push_user ON employee_push_subscriptions(user_id);

GRANT ALL ON employee_push_subscriptions TO magnus_user;
