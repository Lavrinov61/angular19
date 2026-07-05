-- ============================================================
-- Bridge System — MQTT-based remote print infrastructure
-- Версия: v0.55.0 (2026-03-06)
-- ============================================================

-- ─── bridge_devices: реестр устройств ───────────────────────

CREATE TABLE IF NOT EXISTS bridge_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID REFERENCES studios(id) ON DELETE SET NULL,
  api_key VARCHAR(128) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  hostname VARCHAR(255),
  bridge_version VARCHAR(50),
  os_version VARCHAR(100),
  is_online BOOLEAN DEFAULT FALSE,
  last_connected_at TIMESTAMPTZ,
  last_disconnected_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  mqtt_username VARCHAR(100) NOT NULL UNIQUE,
  mqtt_password_hash VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bridge_devices_studio ON bridge_devices(studio_id);
CREATE INDEX IF NOT EXISTS idx_bridge_devices_active ON bridge_devices(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_bridge_devices_api_key ON bridge_devices(api_key);

-- ─── printer_telemetry: телеметрия принтеров ────────────────

CREATE TABLE IF NOT EXISTS printer_telemetry (
  id BIGSERIAL PRIMARY KEY,
  printer_id UUID NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
  studio_id UUID REFERENCES studios(id) ON DELETE SET NULL,
  bridge_device_id UUID REFERENCES bridge_devices(id) ON DELETE SET NULL,
  is_online BOOLEAN DEFAULT FALSE,
  state VARCHAR(50),               -- idle, processing, stopped, unknown
  state_reasons TEXT[],             -- paused, media-jam, toner-low, etc.
  supplies JSONB DEFAULT '[]',     -- [{name, type, level, max_level, color}]
  trays JSONB DEFAULT '[]',        -- [{name, media_size, level, max_level}]
  counters JSONB DEFAULT '{}',     -- {total_pages, color_pages, bw_pages, duplex_pages}
  errors JSONB DEFAULT '[]',       -- [{code, severity, message}]
  model VARCHAR(200),
  manufacturer VARCHAR(100),
  serial_number VARCHAR(100),
  firmware_version VARCHAR(100),
  collected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_printer ON printer_telemetry(printer_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_studio ON printer_telemetry(studio_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_collected ON printer_telemetry(collected_at DESC);

-- ─── printer_current_status: view последней телеметрии ──────

CREATE OR REPLACE VIEW printer_current_status AS
SELECT DISTINCT ON (printer_id)
  pt.*,
  p.name AS printer_name,
  p.printer_type,
  p.win_printer_name,
  bd.name AS bridge_name,
  bd.is_online AS bridge_online
FROM printer_telemetry pt
JOIN printers p ON p.id = pt.printer_id
LEFT JOIN bridge_devices bd ON bd.id = pt.bridge_device_id
ORDER BY printer_id, collected_at DESC;

-- ─── PG Trigger: NOTIFY при INSERT в print_jobs ─────────────

CREATE OR REPLACE FUNCTION notify_print_job_new() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('print_jobs_new', json_build_object(
    'id', NEW.id,
    'printer_id', NEW.printer_id,
    'studio_id', NEW.studio_id,
    'status', NEW.status
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_print_jobs_new ON print_jobs;
CREATE TRIGGER trg_print_jobs_new
  AFTER INSERT ON print_jobs
  FOR EACH ROW
  WHEN (NEW.status = 'queued')
  EXECUTE FUNCTION notify_print_job_new();

-- Также notify при retry (UPDATE status → 'queued')
CREATE OR REPLACE FUNCTION notify_print_job_retry() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'queued' AND OLD.status != 'queued' THEN
    PERFORM pg_notify('print_jobs_new', json_build_object(
      'id', NEW.id,
      'printer_id', NEW.printer_id,
      'studio_id', NEW.studio_id,
      'status', NEW.status
    )::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_print_jobs_retry ON print_jobs;
CREATE TRIGGER trg_print_jobs_retry
  AFTER UPDATE ON print_jobs
  FOR EACH ROW
  EXECUTE FUNCTION notify_print_job_retry();
