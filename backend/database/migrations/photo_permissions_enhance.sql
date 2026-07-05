-- Enhance permissions table for photo permission management
-- Adds session_id, type, purposes array, comments, signature support

ALTER TABLE permissions ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES photo_sessions(id) ON DELETE SET NULL;
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS type varchar(50) NOT NULL DEFAULT 'all_photos';
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS purposes text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS comments text;
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS signature_image text;
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS signed_at timestamptz;
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS revoke_reason text;

CREATE INDEX IF NOT EXISTS idx_permissions_session_id ON permissions(session_id);
CREATE INDEX IF NOT EXISTS idx_permissions_type ON permissions(type);
