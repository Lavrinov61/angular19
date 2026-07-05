-- Photo Approval Sessions: группировка фото для согласования с клиентом
CREATE TABLE IF NOT EXISTS photo_approval_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    public_token VARCHAR(64) UNIQUE NOT NULL,
    client_name VARCHAR(255),
    client_phone VARCHAR(20),
    client_id UUID REFERENCES users(id) ON DELETE SET NULL,
    photographer_id UUID NOT NULL REFERENCES users(id),
    order_id UUID,
    task_id UUID,
    status VARCHAR(30) DEFAULT 'pending'
        CHECK (status IN ('pending','in_review','approved','partially_approved','changes_requested','completed')),
    title VARCHAR(255),
    description TEXT,
    deadline TIMESTAMPTZ,
    total_photos INTEGER DEFAULT 0,
    approved_count INTEGER DEFAULT 0,
    rejected_count INTEGER DEFAULT 0,
    link_sent_via VARCHAR(20),
    link_sent_at TIMESTAMPTZ,
    first_viewed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_approval_sessions_token ON photo_approval_sessions(public_token);
CREATE INDEX IF NOT EXISTS idx_approval_sessions_client ON photo_approval_sessions(client_phone);
CREATE INDEX IF NOT EXISTS idx_approval_sessions_status ON photo_approval_sessions(status);
CREATE INDEX IF NOT EXISTS idx_approval_sessions_photographer ON photo_approval_sessions(photographer_id);

-- Связь photo_approvals с сессией
ALTER TABLE photo_approvals
    ADD COLUMN IF NOT EXISTS approval_session_id UUID REFERENCES photo_approval_sessions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_photo_approvals_session ON photo_approvals(approval_session_id);
