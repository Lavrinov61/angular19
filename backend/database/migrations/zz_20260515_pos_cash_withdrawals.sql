-- Cash withdrawals from a POS shift.
-- Employees record amount + reason, admins can audit movements by shift.

BEGIN;

ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS cash_collected NUMERIC(12,2) DEFAULT 0;
ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS collection_count INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS pos_cash_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES pos_shifts(id) ON DELETE CASCADE,
  studio_id UUID NOT NULL REFERENCES studios(id),
  employee_id UUID NOT NULL REFERENCES users(id),
  movement_type VARCHAR(20) NOT NULL CHECK (movement_type IN ('withdrawal')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_cash_movements_shift_created
  ON pos_cash_movements(shift_id, created_at);

CREATE INDEX IF NOT EXISTS idx_pos_cash_movements_studio_created
  ON pos_cash_movements(studio_id, created_at);

COMMIT;
