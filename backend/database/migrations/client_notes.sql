-- Client notes — заметки оператора по клиенту (привязка по телефону)
CREATE TABLE IF NOT EXISTS client_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_phone VARCHAR(20) NOT NULL,
    author_id UUID NOT NULL REFERENCES users(id),
    text TEXT NOT NULL,
    pinned BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_client_notes_phone ON client_notes(client_phone);
CREATE INDEX IF NOT EXISTS idx_client_notes_created ON client_notes(created_at DESC);
