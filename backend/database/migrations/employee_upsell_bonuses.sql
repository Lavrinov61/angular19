-- Migration: employee_upsell_bonuses
-- Upsell tracking & bonus system for employees
-- Idempotent: safe to re-run

-- Log of every upsell offer made by an employee
CREATE TABLE IF NOT EXISTS employee_upsell_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES users(id),
  order_id uuid REFERENCES orders(id),
  offered_items text[] NOT NULL,
  accepted boolean NOT NULL DEFAULT false,
  shift_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);

-- Indexes for upsell offers
CREATE INDEX IF NOT EXISTS idx_upsell_offers_employee_shift
  ON employee_upsell_offers (employee_id, shift_date);

-- Use range scan on shift_date instead of date_trunc (not immutable)
-- The idx_upsell_offers_employee_shift index covers monthly queries via range scan

-- Bonuses awarded to employees
CREATE TABLE IF NOT EXISTS employee_upsell_bonuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES users(id),
  bonus_type varchar(30) NOT NULL,
  period varchar(10) NOT NULL,
  amount numeric(10,2) NOT NULL,
  description text,
  status varchar(20) DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

-- Index for bonus lookup
CREATE INDEX IF NOT EXISTS idx_upsell_bonuses_employee_period
  ON employee_upsell_bonuses (employee_id, period);

CREATE INDEX IF NOT EXISTS idx_upsell_bonuses_status
  ON employee_upsell_bonuses (status) WHERE status = 'pending';
