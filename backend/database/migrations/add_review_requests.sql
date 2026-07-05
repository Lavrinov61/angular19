-- Таблица запросов на отзывы
-- Хранит отложенные и отправленные запросы, трекинг кликов

CREATE TABLE IF NOT EXISTS review_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id TEXT,
    client_name TEXT,
    client_phone TEXT,
    client_email TEXT,
    channel TEXT NOT NULL DEFAULT 'email',
    external_chat_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    send_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    click_platform TEXT,
    source TEXT NOT NULL,
    location_slug TEXT,
    review_token TEXT UNIQUE,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_req_pending ON review_requests(status, send_at)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_review_req_phone ON review_requests(client_phone)
    WHERE client_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_review_req_order ON review_requests(order_id)
    WHERE order_id IS NOT NULL;
