-- F62: POS Favorites per Employee
-- Employee-specific favorites for service_options in POS

CREATE TABLE IF NOT EXISTS employee_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_option_id uuid NOT NULL REFERENCES service_options(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, service_option_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_favorites_employee ON employee_favorites(employee_id);
