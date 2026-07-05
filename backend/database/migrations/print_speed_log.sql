-- Print speed log — track printing performance metrics
-- 72 photos / 45 minutes = 1.6 photos/min (baseline for 10x15)

CREATE TABLE IF NOT EXISTS print_speed_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      TEXT REFERENCES photo_print_orders(order_id) ON DELETE SET NULL,
  photo_count   INT NOT NULL,
  format        TEXT NOT NULL DEFAULT '10x15',
  duration_minutes NUMERIC(6,1) NOT NULL,
  photos_per_minute NUMERIC(6,2) GENERATED ALWAYS AS (
    photo_count / NULLIF(duration_minutes, 0)
  ) STORED,
  operator_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  printer_name  TEXT,
  notes         TEXT,
  printed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_print_speed_log_printed_at ON print_speed_log(printed_at DESC);
CREATE INDEX IF NOT EXISTS idx_print_speed_log_format     ON print_speed_log(format);

COMMENT ON TABLE  print_speed_log IS 'Historical print speed metrics per job';
COMMENT ON COLUMN print_speed_log.photos_per_minute IS 'Auto-calculated: photo_count / duration_minutes';
