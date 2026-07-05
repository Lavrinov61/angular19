-- Migration: Add shipment tracking fields to photo_print_orders
-- For Pochta Russia Otpravka API integration
-- Date: 2026-02-13

-- Трек-номер Почты России (штрих-код)
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(50);

-- ID отправления в системе Otpravka
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS shipment_id VARCHAR(100);

-- Статус отправления: none → created → label_generated → shipped → delivered / error
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS shipment_status VARCHAR(50) DEFAULT 'none';

-- Путь к PDF этикетке
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS label_url TEXT;

-- Когда создано отправление
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS shipment_created_at TIMESTAMP WITH TIME ZONE;

-- Рассчитанный вес в граммах
ALTER TABLE photo_print_orders ADD COLUMN IF NOT EXISTS shipment_weight_grams INTEGER;

-- Индексы
CREATE INDEX IF NOT EXISTS idx_ppo_tracking_number ON photo_print_orders(tracking_number)
  WHERE tracking_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ppo_shipment_status ON photo_print_orders(shipment_status)
  WHERE shipment_status != 'none';
