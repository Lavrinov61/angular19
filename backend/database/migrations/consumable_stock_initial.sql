-- Migration: consumable_stock_initial
-- Create bridge_devices for print agents and seed consumable_stock
-- Idempotent: ON CONFLICT DO NOTHING

-- Step 1: Create print-agent bridge_devices for each studio (if not exist)
-- Соборный 21
INSERT INTO bridge_devices (id, studio_id, api_key, name, mqtt_username, mqtt_password_hash, agent_type, is_active)
VALUES (
  'b0000001-0000-0000-0000-000000000001',
  '30ef357f-06a6-4b01-b1ff-dbbe7eaed446',
  'print-agent-soborny-key-001',
  'Соборный 21 — Print Agent',
  'print_soborny',
  '$2b$12$placeholder_hash_soborny_print',
  'print',
  true
) ON CONFLICT (id) DO NOTHING;

-- Баррикадная
INSERT INTO bridge_devices (id, studio_id, api_key, name, mqtt_username, mqtt_password_hash, agent_type, is_active)
VALUES (
  'b0000002-0000-0000-0000-000000000002',
  'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69',
  'print-agent-barrikadnaya-key-002',
  'Баррикадная — Print Agent',
  'print_barrikadnaya',
  '$2b$12$placeholder_hash_barrikadnaya_print',
  'print',
  true
) ON CONFLICT (id) DO NOTHING;

-- Step 2: Seed consumable_stock for photo printers (L8050, SC-F100)
-- Соборный: L8050 левый (8d8e2a14-...), L8050 правый (b39fc4b4-...), SC-F100 (51a5e090-...)
-- Баррикадная: L8050 (d6d0ecdb-...)

-- Helper: use station_id = bridge_device for that studio
-- Соборный print agent = b0000001-...
-- Баррикадная print agent = b0000002-...

-- === Соборный 21 — photo printers (L8050 x2 + SC-F100) ===
-- Ink for photo printers
INSERT INTO consumable_stock (station_id, consumable_type, current_amount, max_capacity, unit, low_threshold, cost_per_unit)
VALUES
  -- Ink (shared across all photo printers in Соборный)
  ('b0000001-0000-0000-0000-000000000001', 'ink_cyan', 70, 70, 'ml', 15, 3.5),
  ('b0000001-0000-0000-0000-000000000001', 'ink_magenta', 70, 70, 'ml', 15, 3.5),
  ('b0000001-0000-0000-0000-000000000001', 'ink_yellow', 70, 70, 'ml', 15, 3.5),
  ('b0000001-0000-0000-0000-000000000001', 'ink_black', 70, 70, 'ml', 15, 3.5),
  ('b0000001-0000-0000-0000-000000000001', 'ink_light_cyan', 70, 70, 'ml', 15, 3.5),
  ('b0000001-0000-0000-0000-000000000001', 'ink_light_magenta', 70, 70, 'ml', 15, 3.5),
  -- Paper
  ('b0000001-0000-0000-0000-000000000001', 'paper_glossy_10x15', 500, 1000, 'sheets', 100, 1.2),
  ('b0000001-0000-0000-0000-000000000001', 'paper_glossy_a4', 200, 500, 'sheets', 50, 3.0)
ON CONFLICT (station_id, consumable_type) DO NOTHING;

-- === Соборный 21 — MFP: Canon C3226i (49a1bd1a-...) ===
INSERT INTO consumable_stock (station_id, consumable_type, current_amount, max_capacity, unit, low_threshold, cost_per_unit)
VALUES
  ('b0000001-0000-0000-0000-000000000001', 'toner_black', 100, 100, 'percent', 20, 50.0),
  ('b0000001-0000-0000-0000-000000000001', 'toner_cyan', 100, 100, 'percent', 20, 45.0),
  ('b0000001-0000-0000-0000-000000000001', 'toner_magenta', 100, 100, 'percent', 20, 45.0),
  ('b0000001-0000-0000-0000-000000000001', 'toner_yellow', 100, 100, 'percent', 20, 45.0),
  ('b0000001-0000-0000-0000-000000000001', 'paper_a4', 500, 1000, 'sheets', 100, 0.5)
ON CONFLICT (station_id, consumable_type) DO NOTHING;

-- === Баррикадная — photo printer: L8050 (d6d0ecdb-...) ===
INSERT INTO consumable_stock (station_id, consumable_type, current_amount, max_capacity, unit, low_threshold, cost_per_unit)
VALUES
  ('b0000002-0000-0000-0000-000000000002', 'ink_cyan', 70, 70, 'ml', 15, 3.5),
  ('b0000002-0000-0000-0000-000000000002', 'ink_magenta', 70, 70, 'ml', 15, 3.5),
  ('b0000002-0000-0000-0000-000000000002', 'ink_yellow', 70, 70, 'ml', 15, 3.5),
  ('b0000002-0000-0000-0000-000000000002', 'ink_black', 70, 70, 'ml', 15, 3.5),
  ('b0000002-0000-0000-0000-000000000002', 'ink_light_cyan', 70, 70, 'ml', 15, 3.5),
  ('b0000002-0000-0000-0000-000000000002', 'ink_light_magenta', 70, 70, 'ml', 15, 3.5),
  ('b0000002-0000-0000-0000-000000000002', 'paper_glossy_10x15', 300, 1000, 'sheets', 100, 1.2),
  ('b0000002-0000-0000-0000-000000000002', 'paper_glossy_a4', 100, 500, 'sheets', 50, 3.0)
ON CONFLICT (station_id, consumable_type) DO NOTHING;

-- === Баррикадная — MFP: Canon MF655CDw (877f10f9-...) ===
INSERT INTO consumable_stock (station_id, consumable_type, current_amount, max_capacity, unit, low_threshold, cost_per_unit)
VALUES
  ('b0000002-0000-0000-0000-000000000002', 'toner_black', 100, 100, 'percent', 20, 40.0),
  ('b0000002-0000-0000-0000-000000000002', 'toner_cyan', 100, 100, 'percent', 20, 35.0),
  ('b0000002-0000-0000-0000-000000000002', 'toner_magenta', 100, 100, 'percent', 20, 35.0),
  ('b0000002-0000-0000-0000-000000000002', 'toner_yellow', 100, 100, 'percent', 20, 35.0),
  ('b0000002-0000-0000-0000-000000000002', 'paper_a4', 300, 500, 'sheets', 100, 0.5)
ON CONFLICT (station_id, consumable_type) DO NOTHING;
