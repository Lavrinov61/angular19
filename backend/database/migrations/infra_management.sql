-- Infrastructure Management System — Phase 0 Foundation
-- Таблицы для мульти-агентной архитектуры, auto-update, алертов, телеметрии
-- Идемпотентная миграция (IF NOT EXISTS / OR REPLACE)

BEGIN;

-- ── agents: единый реестр агентов всех типов ──
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  agent_type VARCHAR(20) NOT NULL CHECK (agent_type IN ('print','pos','vision','monitor')),
  name VARCHAR(100) NOT NULL,
  hostname VARCHAR(255),
  current_version VARCHAR(20),
  target_version VARCHAR(20),
  mqtt_username VARCHAR(100) NOT NULL UNIQUE,
  mqtt_password_hash VARCHAR(255) NOT NULL,
  is_online BOOLEAN DEFAULT FALSE,
  last_heartbeat_at TIMESTAMPTZ,
  last_connected_at TIMESTAMPTZ,
  last_disconnected_at TIMESTAMPTZ,
  os_version VARCHAR(100),
  os_arch VARCHAR(20),
  config_version INT DEFAULT 0,
  desired_config JSONB DEFAULT '{}',
  applied_config JSONB DEFAULT '{}',
  uptime_seconds BIGINT DEFAULT 0,
  last_restart_reason VARCHAR(200),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(studio_id, agent_type)
);

CREATE INDEX IF NOT EXISTS idx_agents_studio ON agents(studio_id);
CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(agent_type);
CREATE INDEX IF NOT EXISTS idx_agents_online ON agents(is_online) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_agents_heartbeat ON agents(last_heartbeat_at) WHERE is_active AND is_online;

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION update_agents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agents_updated_at ON agents;
CREATE TRIGGER trg_agents_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_agents_updated_at();

-- ── agent_releases: реестр версий для auto-update ──
CREATE TABLE IF NOT EXISTS agent_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type VARCHAR(20) NOT NULL CHECK (agent_type IN ('print','pos','vision','monitor')),
  version VARCHAR(20) NOT NULL,
  platform VARCHAR(20) NOT NULL CHECK (platform IN ('windows_x64','linux_x64','linux_arm64')),
  artifact_url TEXT NOT NULL,
  artifact_hash_sha256 VARCHAR(64) NOT NULL,
  artifact_size_bytes BIGINT NOT NULL,
  release_notes TEXT,
  is_stable BOOLEAN DEFAULT FALSE,
  min_os_version VARCHAR(50),
  released_by UUID REFERENCES users(id),
  released_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_type, version, platform)
);

CREATE INDEX IF NOT EXISTS idx_agent_releases_type ON agent_releases(agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_releases_stable ON agent_releases(agent_type, is_stable) WHERE is_stable;

-- ── agent_update_commands: трекинг обновлений ──
CREATE TABLE IF NOT EXISTS agent_update_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  release_id UUID NOT NULL REFERENCES agent_releases(id),
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending','downloading','installing','completed','failed','rolled_back')),
  error_message TEXT,
  previous_version VARCHAR(20),
  rollback_url TEXT,
  initiated_by UUID REFERENCES users(id),
  initiated_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_update_commands_agent ON agent_update_commands(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_update_commands_status ON agent_update_commands(status) WHERE status NOT IN ('completed','failed','rolled_back');

-- ── infra_alerts: алерты инфраструктуры ──
CREATE TABLE IF NOT EXISTS infra_alerts (
  id BIGSERIAL PRIMARY KEY,
  studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  alert_type VARCHAR(50) NOT NULL,
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('info','warning','critical')),
  title VARCHAR(200) NOT NULL,
  details JSONB DEFAULT '{}',
  is_acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_infra_alerts_studio ON infra_alerts(studio_id);
CREATE INDEX IF NOT EXISTS idx_infra_alerts_unresolved ON infra_alerts(created_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_infra_alerts_severity ON infra_alerts(severity, created_at DESC) WHERE resolved_at IS NULL;

-- ── alert_rules: конфигурируемые правила алертов ──
CREATE TABLE IF NOT EXISTS alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type VARCHAR(20),
  alert_type VARCHAR(50) NOT NULL,
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('info','warning','critical')),
  condition_config JSONB NOT NULL,
  notification_channels JSONB DEFAULT '["telegram"]',
  cooldown_minutes INT DEFAULT 30,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── system_telemetry: метрики ОС от Device Monitor ──
CREATE TABLE IF NOT EXISTS system_telemetry (
  id BIGSERIAL PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  cpu_percent FLOAT,
  memory_used_mb INT,
  memory_total_mb INT,
  disk_used_gb FLOAT,
  disk_total_gb FLOAT,
  network_rx_bytes_sec BIGINT,
  network_tx_bytes_sec BIGINT,
  peripherals JSONB DEFAULT '[]',
  agent_statuses JSONB DEFAULT '{}',
  collected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_telemetry_agent ON system_telemetry(agent_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_telemetry_studio ON system_telemetry(studio_id, collected_at DESC);

-- ── pos_transactions: транзакции POS агента ──
CREATE TABLE IF NOT EXISTS pos_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('payment','refund','sbp_payment','sbp_refund')),
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'RUB',
  terminal_response JSONB DEFAULT '{}',
  fiscal_receipt JSONB DEFAULT '{}',
  order_id UUID,
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  error_message TEXT,
  initiated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pos_transactions_studio ON pos_transactions(studio_id, initiated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_transactions_order ON pos_transactions(order_id) WHERE order_id IS NOT NULL;

-- ── cameras: реестр IP-камер ──
CREATE TABLE IF NOT EXISTS cameras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  name VARCHAR(100) NOT NULL,
  camera_type VARCHAR(20) CHECK (camera_type IN ('ip','usb','rtsp')),
  rtsp_url TEXT,
  onvif_url TEXT,
  location_description VARCHAR(200),
  is_online BOOLEAN DEFAULT FALSE,
  last_snapshot_at TIMESTAMPTZ,
  motion_detection_enabled BOOLEAN DEFAULT FALSE,
  motion_sensitivity INT DEFAULT 50,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cameras_studio ON cameras(studio_id);

-- ── ALTER studios для инфраструктуры ──
ALTER TABLE studios ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'Europe/Moscow';
ALTER TABLE studios ADD COLUMN IF NOT EXISTS operating_hours JSONB DEFAULT '{}';
ALTER TABLE studios ADD COLUMN IF NOT EXISTS contact_person_id UUID;
ALTER TABLE studios ADD COLUMN IF NOT EXISTS network_config JSONB DEFAULT '{}';
ALTER TABLE studios ADD COLUMN IF NOT EXISTS location_type VARCHAR(20) DEFAULT 'owned';
ALTER TABLE studios ADD COLUMN IF NOT EXISTS region VARCHAR(100);
ALTER TABLE studios ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE studios ADD COLUMN IF NOT EXISTS is_infra_enabled BOOLEAN DEFAULT FALSE;

-- ── Seed: default alert rules ──
INSERT INTO alert_rules (agent_type, alert_type, severity, condition_config, notification_channels, cooldown_minutes)
VALUES
  (NULL, 'heartbeat_timeout', 'critical', '{"threshold_seconds": 180}', '["telegram"]', 30),
  (NULL, 'heartbeat_timeout', 'warning', '{"threshold_seconds": 90}', '["crm"]', 15),
  ('print', 'print_error_rate', 'warning', '{"threshold_percent": 20, "window_minutes": 60}', '["telegram","crm"]', 60),
  ('pos', 'transaction_failure', 'critical', '{"consecutive_failures": 3}', '["telegram"]', 15),
  ('monitor', 'disk_space_low', 'warning', '{"threshold_percent": 85}', '["crm"]', 120),
  ('monitor', 'disk_space_critical', 'critical', '{"threshold_percent": 95}', '["telegram","crm"]', 30),
  ('monitor', 'memory_high', 'warning', '{"threshold_percent": 90}', '["crm"]', 60),
  ('vision', 'camera_offline', 'warning', '{"threshold_seconds": 300}', '["crm"]', 60)
ON CONFLICT DO NOTHING;

-- ── View: agent_fleet_status — агрегированный статус флота ──
CREATE OR REPLACE VIEW agent_fleet_status AS
SELECT
  a.agent_type,
  a.current_version,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE a.is_online) AS online,
  COUNT(*) FILTER (WHERE NOT a.is_online) AS offline,
  COUNT(*) FILTER (WHERE a.target_version IS NOT NULL AND a.target_version != a.current_version) AS pending_update
FROM agents a
WHERE a.is_active
GROUP BY a.agent_type, a.current_version;

COMMIT;
