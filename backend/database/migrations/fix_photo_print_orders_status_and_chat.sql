-- Migration: fix photo_print_orders status and auto-link chats
-- Idempotent: safe to run multiple times

-- 1. Fix orders stuck in 'new' status → 'processing'
UPDATE photo_print_orders
SET status = 'processing', updated_at = NOW()
WHERE status = 'new'
  AND source IN ('online', 'website')
  AND payment_status IN ('none', 'pending');

-- 2. Auto-link chat sessions by phone for orders without chat_session_id
UPDATE photo_print_orders p
SET chat_session_id = (
  SELECT c.id FROM conversations c
  WHERE REPLACE(REPLACE(c.visitor_phone, '+', ''), ' ', '')
        LIKE '%' || RIGHT(REPLACE(REPLACE(p.contact_phone, '+', ''), ' ', ''), 10) || '%'
    AND c.status IN ('active', 'waiting')
  ORDER BY c.created_at DESC
  LIMIT 1
),
updated_at = NOW()
WHERE p.chat_session_id IS NULL
  AND p.contact_phone IS NOT NULL
  AND p.contact_phone != ''
  AND EXISTS (
    SELECT 1 FROM conversations c
    WHERE REPLACE(REPLACE(c.visitor_phone, '+', ''), ' ', '')
          LIKE '%' || RIGHT(REPLACE(REPLACE(p.contact_phone, '+', ''), ' ', ''), 10) || '%'
      AND c.status IN ('active', 'waiting')
  );
