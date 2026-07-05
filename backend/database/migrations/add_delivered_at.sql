-- Migration: add delivered_at for message delivery tracking (WhatsApp-style checkmarks)
-- Applied: 2026-03-02

ALTER TABLE visitor_chat_messages
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- Partial index for quick lookup of undelivered/unread operator messages
CREATE INDEX IF NOT EXISTS idx_vcm_delivery
  ON visitor_chat_messages (session_id, sender_type, delivered_at, read_at)
  WHERE sender_type = 'operator';
