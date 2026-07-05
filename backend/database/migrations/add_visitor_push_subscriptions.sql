-- Миграция: Push-уведомления для visitor chat

CREATE TABLE IF NOT EXISTS visitor_push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES visitor_chat_sessions(id) ON DELETE CASCADE,
    visitor_id VARCHAR(64) NOT NULL,
    endpoint TEXT NOT NULL,
    keys JSONB NOT NULL DEFAULT '{}',
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (session_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_visitor_push_session ON visitor_push_subscriptions(session_id);
CREATE INDEX IF NOT EXISTS idx_visitor_push_visitor ON visitor_push_subscriptions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_visitor_push_endpoint ON visitor_push_subscriptions(endpoint);

CREATE OR REPLACE FUNCTION update_visitor_push_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_visitor_push_updated ON visitor_push_subscriptions;
CREATE TRIGGER trigger_visitor_push_updated
    BEFORE UPDATE ON visitor_push_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_visitor_push_timestamp();
