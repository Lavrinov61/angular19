-- Order Templates — пользовательские шаблоны заказов (F57)
-- Идемпотентная миграция

CREATE TABLE IF NOT EXISTS order_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          varchar(255) NOT NULL,
  icon          varchar(50) NOT NULL DEFAULT 'bookmark',
  description   text,
  created_by    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope         varchar(20) NOT NULL DEFAULT 'personal'
                CHECK (scope IN ('personal', 'shared')),
  option_slugs  text[] NOT NULL DEFAULT '{}',
  usage_count   int NOT NULL DEFAULT 0,
  last_used_at  timestamptz,
  sort_order    int NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_templates_created_by
  ON order_templates(created_by) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_order_templates_scope_shared
  ON order_templates(scope, sort_order) WHERE scope = 'shared' AND is_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_templates_personal_name
  ON order_templates(created_by, lower(name)) WHERE is_active;

-- Seed: перенести hardcoded presets как shared
INSERT INTO order_templates (name, icon, scope, option_slugs, sort_order, created_by)
SELECT
  v.name, v.icon, 'shared', v.slugs, v.sort_order,
  (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1)
FROM (VALUES
  ('Фото + ретушь',  'photo_camera',  ARRAY['express', 'retouch-studio-only'], 1),
  ('Ксерокопия ч/б', 'content_copy',  ARRAY['copy-a4-bw'], 2),
  ('Экспресс фото',  'bolt',          ARRAY['express'], 3)
) AS v(name, icon, slugs, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM order_templates WHERE scope = 'shared' AND name = v.name);
