-- Migration: expire_stuck_photo_print_orders
-- Mark photo_print_orders stuck in 'processing' for > 3 days as 'expired'
-- Run date: 2026-03-31

UPDATE photo_print_orders
SET status = 'expired',
    updated_at = NOW(),
    fail_reason = COALESCE(fail_reason, '') || ' [auto-expired: stuck in processing since ' || created_at::date || ']'
WHERE status = 'processing'
  AND created_at < NOW() - INTERVAL '3 days';
