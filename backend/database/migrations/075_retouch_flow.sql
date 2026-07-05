-- Migration 075: Retouch Flow
-- Extends work_tasks for retouch pipeline, adds audit history table and queue view
-- Idempotent: safe to run multiple times

BEGIN;

-- 1. Extend work_tasks with retouch-specific columns
ALTER TABLE work_tasks
  ADD COLUMN IF NOT EXISTS approval_session_id UUID REFERENCES photo_approval_sessions(id),
  ADD COLUMN IF NOT EXISTS retouch_level VARCHAR(20) CHECK (retouch_level IN ('basic', 'extended', 'maximum')),
  ADD COLUMN IF NOT EXISTS retouch_options JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS result_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revision_count INTEGER DEFAULT 0;

-- 2. Retouch task audit history
CREATE TABLE IF NOT EXISTS retouch_task_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  from_status VARCHAR(30),
  to_status VARCHAR(30) NOT NULL,
  changed_by UUID REFERENCES users(id),
  reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_work_tasks_approval_session
  ON work_tasks(approval_session_id) WHERE approval_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_tasks_retouch_active
  ON work_tasks(assigned_to, status)
  WHERE task_type = 'retouch' AND status NOT IN ('completed', 'cancelled');

CREATE INDEX IF NOT EXISTS idx_users_retoucher_skill
  ON users USING gin(skills) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_retouch_task_history_task
  ON retouch_task_history(task_id, created_at DESC);

-- 4. Retouch queue view
CREATE OR REPLACE VIEW retouch_queue AS
SELECT
  t.id, t.task_number, t.title, t.status, t.priority,
  t.retouch_level, t.retouch_options, t.source_photo_url, t.result_photo_url,
  t.revision_count, t.assigned_to, t.assigned_studio_id,
  t.client_name, t.client_phone, t.order_id, t.approval_session_id,
  t.chat_session_id, t.due_date, t.started_at, t.created_at, t.updated_at,
  u_assigned.display_name AS retoucher_name,
  s.name AS studio_name,
  pas.public_token AS approval_token,
  pas.status AS approval_status,
  pas.total_photos, pas.approved_count, pas.rejected_count
FROM work_tasks t
LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to
LEFT JOIN studios s ON s.id = t.assigned_studio_id
LEFT JOIN photo_approval_sessions pas ON pas.id = t.approval_session_id
WHERE t.task_type = 'retouch';

COMMIT;
