-- Таблица для хранения разбивки наличных по номиналам при сдаче кассы
CREATE TABLE IF NOT EXISTS pos_cash_counts (
  id SERIAL PRIMARY KEY,
  shift_id UUID NOT NULL REFERENCES pos_shifts(id) ON DELETE CASCADE,
  denomination NUMERIC(10,2) NOT NULL,
  denomination_type TEXT NOT NULL CHECK (denomination_type IN ('banknote', 'coin')),
  count INTEGER NOT NULL DEFAULT 0,
  subtotal NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_counts_shift ON pos_cash_counts(shift_id);
