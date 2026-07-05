-- Migration: order_creation_enhancements
-- Adds deadline_at, description, source to photo_print_orders
-- Creates order_attachments table
-- Extends order_items.order_type CHECK to include 'crm'

BEGIN;

-- deadline_at для заказов
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ;

-- description в photo_print_orders (внутреннее описание заказа)
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS description TEXT;

-- source в photo_print_orders (откуда создан: pos, crm, chat, online, walk_in)
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'online';

-- order_attachments таблица
CREATE TABLE IF NOT EXISTS order_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id VARCHAR(50) NOT NULL,
  s3_key VARCHAR(500) NOT NULL,
  s3_url VARCHAR(1000) NOT NULL,
  file_name VARCHAR(255),
  mime_type VARCHAR(100),
  file_size_bytes BIGINT,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_attachments_order_id ON order_attachments(order_id);

-- Extend order_items.order_type CHECK to include 'crm'
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_order_type_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_order_type_check
  CHECK (order_type IN ('chat', 'app', 'pos', 'crm'));

COMMIT;
