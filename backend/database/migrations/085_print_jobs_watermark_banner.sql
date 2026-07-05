-- Migration 085: Add watermark and banner page columns to print_jobs
-- S19: Watermark params passed through to agent
-- S20: Banner page flag + info JSON

ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS watermark_text TEXT;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS watermark_opacity REAL DEFAULT 0.3;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS watermark_position TEXT DEFAULT 'center';
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS banner_page BOOLEAN DEFAULT FALSE;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS banner_info JSONB;
