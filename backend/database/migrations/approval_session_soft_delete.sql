-- Add soft delete support for photo_approval_sessions
-- Allows operators to delete approval sessions sent to clients

ALTER TABLE photo_approval_sessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_approval_sessions_deleted_at
  ON photo_approval_sessions (deleted_at) WHERE deleted_at IS NOT NULL;

-- Add 'cancelled' status to CHECK constraint (if exists, recreate)
DO $$
BEGIN
  ALTER TABLE photo_approval_sessions DROP CONSTRAINT IF EXISTS photo_approval_sessions_status_check;
  ALTER TABLE photo_approval_sessions ADD CONSTRAINT photo_approval_sessions_status_check
    CHECK (status IN ('pending','in_review','approved','partially_approved','changes_requested','completed','cancelled'));
EXCEPTION WHEN OTHERS THEN
  -- No constraint to drop, just add the new one
  NULL;
END $$;
