-- Server-side cart for visitor chat sessions

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE visitor_chat_sessions
ADD COLUMN IF NOT EXISTS context JSONB DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS visitor_chat_cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES visitor_chat_sessions(id) ON DELETE CASCADE,
  service_id VARCHAR(200) NOT NULL,
  service_name VARCHAR(200) NOT NULL,
  service_description TEXT,
  service_icon VARCHAR(100),
  price NUMERIC(10,2) NOT NULL,
  next_price NUMERIC(10,2),
  price_max NUMERIC(10,2),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  note TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_visitor_chat_cart_items_session
  ON visitor_chat_cart_items(session_id);

CREATE INDEX IF NOT EXISTS idx_visitor_chat_cart_items_updated_at
  ON visitor_chat_cart_items(updated_at DESC);

CREATE OR REPLACE FUNCTION set_visitor_chat_cart_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_visitor_chat_cart_items_updated_at ON visitor_chat_cart_items;
CREATE TRIGGER trg_visitor_chat_cart_items_updated_at
BEFORE UPDATE ON visitor_chat_cart_items
FOR EACH ROW
EXECUTE FUNCTION set_visitor_chat_cart_items_updated_at();
