-- Add approved_by audit trail to photo_approvals
-- Tracks WHO approved: client, employee, or anonymous (token)

ALTER TABLE photo_approvals
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by_role VARCHAR(20) CHECK (approved_by_role IN ('client', 'employee', 'anonymous'));

COMMENT ON COLUMN photo_approvals.approved_by IS 'User ID who approved (null for anonymous token approval)';
COMMENT ON COLUMN photo_approvals.approved_by_role IS 'Role of approver: client, employee, or anonymous (token)';

\echo '✅ approved_by columns added to photo_approvals'
