-- F14 Bugfix: Allow NULL client_id and user_id for session-based approval flow

-- Bug 1: Allow NULL client_id (session-based flow, client may not be registered)
ALTER TABLE photo_approvals ALTER COLUMN client_id DROP NOT NULL;

-- Bug 2: Allow NULL user_id in annotations (public review flow, client not authenticated)
ALTER TABLE photo_approval_annotations ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE photo_approval_annotations DROP CONSTRAINT IF EXISTS photo_approval_annotations_user_id_fkey;
ALTER TABLE photo_approval_annotations ADD CONSTRAINT photo_approval_annotations_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Bug 3: Store original photo per session
ALTER TABLE photo_approval_sessions
  ADD COLUMN IF NOT EXISTS original_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS original_thumbnail_url TEXT;
