-- CRM Notes: универсальные заметки для заказов, бронирований, чатов
CREATE TABLE IF NOT EXISTS crm_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(20) NOT NULL,  -- 'booking', 'order', 'chat'
  entity_id VARCHAR(100) NOT NULL,
  author_id UUID REFERENCES users(id),
  author_name VARCHAR(255),
  note_type VARCHAR(30) DEFAULT 'comment',  -- 'comment', 'system'
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_crm_notes_entity ON crm_notes(entity_type, entity_id);

GRANT ALL ON crm_notes TO magnus_user;
