-- Revision rounds: track which round of corrections each photo belongs to
-- Round 1 = original set, round 2+ = corrections after client feedback

ALTER TABLE photo_approvals ADD COLUMN IF NOT EXISTS revision_round INT DEFAULT 1;
ALTER TABLE photo_approval_sessions ADD COLUMN IF NOT EXISTS current_revision_round INT DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_approvals_session_round
  ON photo_approvals(approval_session_id, revision_round);
