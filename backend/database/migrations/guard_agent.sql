-- Guard Agent infrastructure: security events, CDR stats, agent records, alert rules
-- Idempotent (IF NOT EXISTS / ON CONFLICT)

-- Expand agent_type CHECK to include 'guard'
DO $$
BEGIN
    ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_agent_type_check;
    ALTER TABLE agents ADD CONSTRAINT agents_agent_type_check
        CHECK (agent_type IN ('print', 'pos', 'vision', 'monitor', 'guard'));
END $$;

-- Test studio (for laptop testing)
INSERT INTO studios (id, name, address)
VALUES ('00000000-0000-0000-0000-000000000000', 'Test Laptop', 'Test')
ON CONFLICT DO NOTHING;

-- Security events table
CREATE TABLE IF NOT EXISTS security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id),
    studio_id UUID NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('scan', 'threat', 'defender_status')),
    file_name TEXT,
    file_hash TEXT,
    original_size BIGINT,
    clean_size BIGINT,
    threat_type TEXT,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_studio ON security_events(studio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type, created_at DESC);

-- CDR daily aggregates
CREATE TABLE IF NOT EXISTS cdr_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id),
    studio_id UUID NOT NULL,
    date DATE NOT NULL,
    files_scanned INT DEFAULT 0,
    files_cleaned INT DEFAULT 0,
    files_quarantined INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(agent_id, date)
);

-- Guard agent records
INSERT INTO agents (id, studio_id, agent_type, name, hostname, is_online, mqtt_username, mqtt_password_hash)
VALUES
    ('3174ca99-98ae-448e-bf74-5e65dce4d2a5', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', 'guard', 'Guard — Соборный 21', '', false, 'agent_soborny_guard', 'emqx_managed'),
    ('6c289952-97d9-470a-a124-9d02155e02bd', 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69', 'guard', 'Guard — Баррикадная 4', '', false, 'agent_barrikadnaya_guard', 'emqx_managed'),
    ('df203ef2-628e-43ed-9bbb-3e1e414b65c2', '00000000-0000-0000-0000-000000000000', 'guard', 'Guard — Test Laptop', '', false, 'agent_test_guard', 'emqx_managed')
ON CONFLICT (id) DO NOTHING;

-- Alert rules for guard events
INSERT INTO alert_rules (id, agent_type, alert_type, severity, condition_config, notification_channels, cooldown_minutes, is_active)
SELECT gen_random_uuid(), 'guard', 'threat_detected', 'critical',
    '{"metric":"threat_count","operator":">","threshold":0}'::jsonb, '["telegram","crm"]'::jsonb, 15, true
WHERE NOT EXISTS (SELECT 1 FROM alert_rules WHERE agent_type='guard' AND alert_type='threat_detected');

INSERT INTO alert_rules (id, agent_type, alert_type, severity, condition_config, notification_channels, cooldown_minutes, is_active)
SELECT gen_random_uuid(), 'guard', 'defender_realtime_off', 'critical',
    '{"metric":"defender_realtime","operator":"=","threshold":0}'::jsonb, '["telegram","crm"]'::jsonb, 30, true
WHERE NOT EXISTS (SELECT 1 FROM alert_rules WHERE agent_type='guard' AND alert_type='defender_realtime_off');

INSERT INTO alert_rules (id, agent_type, alert_type, severity, condition_config, notification_channels, cooldown_minutes, is_active)
SELECT gen_random_uuid(), 'guard', 'quarantine_spike', 'warning',
    '{"metric":"files_quarantined","operator":">","threshold":5}'::jsonb, '["crm"]'::jsonb, 60, true
WHERE NOT EXISTS (SELECT 1 FROM alert_rules WHERE agent_type='guard' AND alert_type='quarantine_spike');
