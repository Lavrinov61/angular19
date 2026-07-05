-- ============================================================
-- CRM 1M DAU: Phone normalization expression indexes
-- + Analytics covering indexes
--
-- Phone lookups in crm-clients.routes.ts use:
--   RIGHT(REGEXP_REPLACE(phone, '\D', '', 'g'), 10)
-- Without expression index → full table scan per table.
-- photo_print_orders already has idx_ppo_phone_normalized.
--
-- Idempotent: IF NOT EXISTS / CONCURRENTLY
-- ============================================================

-- ── Phone normalization expression indexes ───────────────────

-- bookings: crm-clients.routes.ts:51,93; crm-search.routes.ts:64
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bookings_phone_normalized
  ON bookings (RIGHT(REGEXP_REPLACE(client_phone, '\D', '', 'g'), 10))
  WHERE client_phone IS NOT NULL;

-- users: crm-clients.routes.ts:38; crm-search.routes.ts:108
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_phone_normalized
  ON users (RIGHT(REGEXP_REPLACE(phone, '\D', '', 'g'), 10))
  WHERE phone IS NOT NULL;

-- pos_receipts: crm-clients.routes.ts:78,98
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pos_receipts_phone_normalized
  ON pos_receipts (RIGHT(REGEXP_REPLACE(customer_phone, '\D', '', 'g'), 10))
  WHERE customer_phone IS NOT NULL;

-- conversations: crm-clients.routes.ts:315 (visitor_phone lookup)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_phone_normalized
  ON conversations (RIGHT(REGEXP_REPLACE(visitor_phone, '\D', '', 'g'), 10))
  WHERE visitor_phone IS NOT NULL;

-- ── Analytics covering indexes ───────────────────────────────

-- conversations: crm-analytics.routes.ts funnel/channels — filter by created_at + channel
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_created_channel
  ON conversations (created_at DESC, channel)
  WHERE status != 'closed';

-- bookings: crm-analytics.routes.ts studio funnel — filter by created_at + status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bookings_created_status
  ON bookings (created_at DESC, status);

-- photo_print_orders: conversion stats — created_at + payment_status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ppo_created_payment
  ON photo_print_orders (created_at DESC, payment_status)
  WHERE status != 'cancelled';
