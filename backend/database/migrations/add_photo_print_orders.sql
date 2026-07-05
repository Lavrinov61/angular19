-- Migration: Add photo_print_orders table
-- Date: 2026-01-28
-- Description: Creates table for online photo print orders from the website

-- Photo print orders table (for online photo print ordering)
CREATE TABLE IF NOT EXISTS photo_print_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id VARCHAR(50) UNIQUE NOT NULL, -- Human-readable order ID like PP-250128-ABCD
    mode VARCHAR(20) NOT NULL CHECK (mode IN ('simple', 'custom')),
    contact_name VARCHAR(255) NOT NULL,
    contact_phone VARCHAR(20) NOT NULL,
    contact_email VARCHAR(255),
    comments TEXT,
    total_price DECIMAL(10, 2),
    items JSONB NOT NULL DEFAULT '[]', -- Array of {uploadedUrl, format, paperType, quantity}
    status VARCHAR(50) DEFAULT 'new' CHECK (status IN ('new', 'processing', 'ready', 'completed', 'cancelled')),
    processed_by UUID REFERENCES users(id) ON DELETE SET NULL, -- Staff member who processed
    processed_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for photo_print_orders
CREATE INDEX IF NOT EXISTS idx_photo_print_orders_order_id ON photo_print_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_photo_print_orders_status ON photo_print_orders(status);
CREATE INDEX IF NOT EXISTS idx_photo_print_orders_phone ON photo_print_orders(contact_phone);
CREATE INDEX IF NOT EXISTS idx_photo_print_orders_created_at ON photo_print_orders(created_at DESC);

-- Trigger for photo_print_orders updated_at
DROP TRIGGER IF EXISTS update_photo_print_orders_updated_at ON photo_print_orders;
CREATE TRIGGER update_photo_print_orders_updated_at BEFORE UPDATE ON photo_print_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Grant necessary permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE ON photo_print_orders TO your_app_user;
