-- Add chat_session_id to review_requests for channel-based delivery
-- Allows sending review requests directly through the active chat channel
ALTER TABLE review_requests
  ADD COLUMN IF NOT EXISTS chat_session_id UUID;

CREATE INDEX IF NOT EXISTS idx_review_req_session
  ON review_requests(chat_session_id) WHERE chat_session_id IS NOT NULL;
