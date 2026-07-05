-- AI Retouch Jobs: pipeline для обработки фото через fal.ai
CREATE TABLE IF NOT EXISTS ai_retouch_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    approval_session_id UUID NOT NULL REFERENCES photo_approval_sessions(id) ON DELETE CASCADE,
    source_photo_id UUID REFERENCES photo_approvals(id) ON DELETE SET NULL,
    source_photo_url TEXT NOT NULL,
    operations JSONB NOT NULL DEFAULT '[]',
    status VARCHAR(30) DEFAULT 'pending'
        CHECK (status IN ('pending','processing','completed','failed','cancelled')),
    current_operation INT DEFAULT 0,
    total_operations INT DEFAULT 0,
    intermediate_urls JSONB DEFAULT '[]',
    result_url TEXT,
    result_thumbnail_url TEXT,
    result_photo_id UUID REFERENCES photo_approvals(id) ON DELETE SET NULL,
    cost_estimate_usd NUMERIC(8,5) DEFAULT 0,
    actual_cost_usd NUMERIC(8,5) DEFAULT 0,
    error TEXT,
    error_operation INT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_retouch_jobs_session ON ai_retouch_jobs(approval_session_id);
CREATE INDEX IF NOT EXISTS idx_retouch_jobs_status ON ai_retouch_jobs(status);
