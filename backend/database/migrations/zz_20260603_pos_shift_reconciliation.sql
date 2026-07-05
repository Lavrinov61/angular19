-- Сверка эквайринга (op59) при закрытии смены: одна строка на смену (UNIQUE shift_id).
-- Касса пишет безнал как card; терминал op59 даёт отдельно карты/QR/итого.
-- В Этапе 1 — только запись + diff; авто-алерт за фича-флагом POS_RECON_ALERT_ENABLED.
-- Idempotent, аддитивно, без backfill.

CREATE TABLE IF NOT EXISTS pos_shift_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES pos_shifts(id) ON DELETE CASCADE,
  studio_id uuid NOT NULL,
  settlement_tx_id uuid REFERENCES pos_transactions(id),
  cash_card_sum numeric(12,2),           -- касса: SUM card completed (без transfer/cash)
  terminal_card_sum numeric(12,2),       -- терминал: ОПЕРАЦИИ ПО КАРТАМ
  terminal_qr_sum numeric(12,2),         -- терминал: ОПЕРАЦИИ ПО QR
  terminal_total_sum numeric(12,2),      -- терминал: ИТОГО
  diff_card numeric(12,2) GENERATED ALWAYS AS (
    CASE WHEN terminal_card_sum IS NOT NULL THEN COALESCE(cash_card_sum,0) - terminal_card_sum END) STORED,
  diff_total numeric(12,2) GENERATED ALWAYS AS (
    CASE WHEN terminal_total_sum IS NOT NULL THEN COALESCE(cash_card_sum,0) - terminal_total_sum END) STORED,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','ok','mismatch','low_confidence','no_operations','settlement_failed','no_agent')),
  raw_report text,
  notes text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_pos_shift_reconciliation_shift UNIQUE (shift_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_shift_reconciliation_attention
  ON pos_shift_reconciliation (status) WHERE status IN ('mismatch','low_confidence','settlement_failed');
