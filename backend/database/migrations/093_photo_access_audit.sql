-- Migration 093: Audit trail for photo access (152-FZ compliance)
CREATE TABLE IF NOT EXISTS photo_access_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  approval_session_id UUID REFERENCES photo_approval_sessions(id) ON DELETE CASCADE,
  photo_approval_id UUID REFERENCES photo_approvals(id) ON DELETE SET NULL,
  accessed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  accessed_by_role VARCHAR(50),
  access_type VARCHAR(20) NOT NULL, -- 'view', 'download', 'share'
  access_method VARCHAR(30), -- 'public_token', 'admin_panel', 'photographer_view', 'api'
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photo_access_audit_session ON photo_access_audit(approval_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photo_access_audit_user ON photo_access_audit(accessed_by_user_id, created_at DESC);
