-- AV scan status column for media_attachments
-- Values: 'pending', 'clean', 'infected', 'error', 'skipped'
ALTER TABLE media_attachments
  ADD COLUMN IF NOT EXISTS av_status varchar(20) DEFAULT 'pending';

-- Index for monitoring/querying infected files
CREATE INDEX IF NOT EXISTS idx_media_attachments_av_status
  ON media_attachments (av_status)
  WHERE av_status != 'clean';
