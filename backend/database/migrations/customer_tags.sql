-- Customer Tags (F66: Customer Segments)
-- Idempotent migration

CREATE TABLE IF NOT EXISTS customer_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(50) NOT NULL,
  color varchar(7) NOT NULL DEFAULT '#6b7280',
  icon varchar(50) DEFAULT 'label',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_tags_name
  ON customer_tags(lower(name));

CREATE TABLE IF NOT EXISTS customer_tag_assignments (
  customer_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES customer_tags(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_tag_assignments_tag
  ON customer_tag_assignments(tag_id);

-- Seed preset tags
INSERT INTO customer_tags (name, color, icon) VALUES
  ('VIP', '#f59e0b', 'star'),
  ('Постоянный', '#22c55e', 'loyalty'),
  ('Фотограф', '#8b5cf6', 'camera_alt'),
  ('Школа', '#3b82f6', 'school'),
  ('Новый', '#06b6d4', 'person_add')
ON CONFLICT DO NOTHING;
