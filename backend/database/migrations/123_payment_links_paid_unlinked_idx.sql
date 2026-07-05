-- Migration 123: partial index for fast "paid but not linked to order" inbox badge.
-- Used by crm_inbox SELECT:
--   EXISTS (SELECT 1 FROM payment_links WHERE conversation_id = ?
--           AND status = 'paid' AND order_ref_linked IS NULL)
-- Without this index, every inbox fetch does a full scan of payment_links.
--
-- Idempotent: IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS idx_payment_links_paid_unlinked
  ON public.payment_links (conversation_id)
  WHERE status = 'paid' AND order_ref_linked IS NULL;
