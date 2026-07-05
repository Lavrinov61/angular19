-- Контур надёжности POS-оплаты (Этап 1): persistent in_doubt в отдельной колонке.
-- payment_resolution живёт ОТДЕЛЬНО от status (status пишет Rust pos-agent безусловным
-- UPDATE), поэтому гонка Rust<->Node физически исключена. Эффективный статус оплаты =
-- COALESCE(payment_resolution, status). CHECK на status НЕ трогаем.
-- Idempotent, аддитивно, без backfill (resolution NULL => эффективный статус = status).

ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS payment_resolution text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pos_transactions_payment_resolution_check') THEN
    ALTER TABLE pos_transactions ADD CONSTRAINT pos_transactions_payment_resolution_check
      CHECK (payment_resolution IS NULL OR payment_resolution = ANY (ARRAY['in_doubt','resolved_paid','resolved_unpaid']));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pos_transactions_in_doubt
  ON pos_transactions (studio_id, initiated_at)
  WHERE transaction_type='payment' AND payment_resolution='in_doubt';

CREATE INDEX IF NOT EXISTS idx_pos_transactions_payment_open
  ON pos_transactions (initiated_at)
  WHERE transaction_type='payment' AND status IN ('pending','processing');
