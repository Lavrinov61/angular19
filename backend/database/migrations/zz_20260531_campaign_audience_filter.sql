-- Audience segmentation for Telegram broadcast campaigns.
-- Stores the segment filter (channel + serviceSlugs + recencyDays) on the campaign
-- header. The real target channel lives HERE (not in marketing_campaigns.channel,
-- whose CHECK only allows print/digital/mixed/telegram); the column stays 'telegram'.
-- Additive + idempotent: safe to re-run on the shared prod DB.
ALTER TABLE marketing_campaigns
  ADD COLUMN IF NOT EXISTS audience_filter JSONB NULL;

COMMENT ON COLUMN marketing_campaigns.audience_filter IS
  'Audience segment filter for broadcast campaigns: {channel, serviceSlugs?, recencyDays?}. '
  'NULL = legacy "all telegram contacts" audience. The real send channel is audience_filter.channel '
  '(marketing_campaigns.channel stays telegram due to its CHECK constraint).';
