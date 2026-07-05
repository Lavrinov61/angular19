-- Chat tags system
CREATE TABLE IF NOT EXISTS chat_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL UNIQUE,
  color VARCHAR(20) NOT NULL DEFAULT '#757575',
  icon VARCHAR(30),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS visitor_chat_session_tags (
  session_id UUID NOT NULL REFERENCES visitor_chat_sessions(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES chat_tags(id) ON DELETE CASCADE,
  added_by UUID REFERENCES users(id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_session_tags_session ON visitor_chat_session_tags(session_id);
CREATE INDEX IF NOT EXISTS idx_session_tags_tag ON visitor_chat_session_tags(tag_id);

-- Preset tags
INSERT INTO chat_tags (name, color, icon, sort_order) VALUES
  ('VIP', '#9c27b0', 'star', 1),
  ('Жалоба', '#f44336', 'warning', 2),
  ('Спам', '#757575', 'block', 3),
  ('Срочно', '#ff5722', 'priority_high', 4),
  ('Повтор', '#ff9800', 'replay', 5)
ON CONFLICT (name) DO NOTHING;
