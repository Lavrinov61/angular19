-- Add NPS rating and service info to review_requests for enterprise review flow
ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS nps_rating SMALLINT;
ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS service_name TEXT;

-- Index for analytics: NPS distribution
CREATE INDEX IF NOT EXISTS idx_review_requests_nps
  ON review_requests (nps_rating) WHERE nps_rating IS NOT NULL;

-- Add 'nps_internal' source to customer_feedback for negative NPS captures
COMMENT ON TABLE customer_feedback IS 'Unified satisfaction signals. Sources: approval_*, review_click, order_completed, manual, nps_positive, nps_negative';
