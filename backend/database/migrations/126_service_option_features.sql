-- Migration 126: service_option_features + disabled_features in order_items
-- Phase 3 (retouch-options-arch): Feature-Level Pricing для processing-* options.
-- Архитектура:
--   1. service_option_features — per-row feature с frozen price (tier_price/count, 2 знака).
--      tier_index (0/1/2) сохраняет порядок, origin_tier_index указывает где feature появилась
--      впервые (для ретушёра: выделить "новые" для этого tier).
--   2. order_items.metadata.disabled_features — jsonb array of feature names, snapshot на момент
--      заказа. Имя, не FK: metadata — denormalized (как unit_price), переживает rename/delete feature.
--   3. v_order_item_features — разворачивает features + флаг disabled для UI ретушёра.
--
-- Идемпотентно (IF NOT EXISTS, ON CONFLICT, OR REPLACE). Rollback в 126_rollback.sql.

BEGIN;

-- ============================================================================
-- 1. Таблица service_option_features
-- ============================================================================
CREATE TABLE IF NOT EXISTS service_option_features (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_option_id uuid NOT NULL REFERENCES service_options(id) ON DELETE CASCADE,
  name            varchar(255) NOT NULL,
  price           numeric(10,2) NOT NULL CHECK (price >= 0),
  tier_index      smallint NOT NULL CHECK (tier_index >= 0),
  origin_tier_index smallint NOT NULL CHECK (origin_tier_index >= 0),
  sort_order      integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sof_origin_le_tier CHECK (origin_tier_index <= tier_index),
  CONSTRAINT sof_unique_name_per_option UNIQUE (service_option_id, name)
);

CREATE INDEX IF NOT EXISTS ix_sof_option_active
  ON service_option_features (service_option_id, sort_order)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS ix_sof_name_trgm
  ON service_option_features (name);

COMMENT ON TABLE  service_option_features IS
  'Feature-Level Pricing: per-feature frozen price для processing-* options.';
COMMENT ON COLUMN service_option_features.price IS
  'Frozen цена feature в момент seed. tier_price/count, равномерно.';
COMMENT ON COLUMN service_option_features.tier_index IS
  '0=basic, 1=extended, 2=max. Определяет к какому tier принадлежит эта строка.';
COMMENT ON COLUMN service_option_features.origin_tier_index IS
  'Tier где feature появилась впервые. Новые features extended/max ярче в UI ретушёра.';

-- ============================================================================
-- 2. updated_at trigger (reuse существующей функции set_updated_at если есть)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'sof_set_updated_at') THEN
    CREATE OR REPLACE FUNCTION sof_set_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $fn$ LANGUAGE plpgsql;
  END IF;
END$$;

DROP TRIGGER IF EXISTS trg_sof_updated_at ON service_option_features;
CREATE TRIGGER trg_sof_updated_at
  BEFORE UPDATE ON service_option_features
  FOR EACH ROW EXECUTE FUNCTION sof_set_updated_at();

-- ============================================================================
-- 3. Seed данных для processing-basic/extended/max
-- origin_tier_index: где feature появилась впервые (basic=0, extended=1, max=2)
-- price = round(tier_base_price / count, 2) — равномерно внутри tier
-- ============================================================================

-- processing-basic: 700 / 4 = 175.00 × 4
INSERT INTO service_option_features
  (service_option_id, name, price, tier_index, origin_tier_index, sort_order)
SELECT so.id, x.name, 175.00, 0, 0, x.sort_order
FROM service_options so
CROSS JOIN (VALUES
  ('Чистка лица',          10),
  ('Чистка фона',          20),
  ('Выравнивание плеч',    30),
  ('Коррекция причёски',   40)
) AS x(name, sort_order)
WHERE so.slug = 'processing-basic'
ON CONFLICT (service_option_id, name) DO UPDATE SET
  price = EXCLUDED.price,
  tier_index = EXCLUDED.tier_index,
  origin_tier_index = EXCLUDED.origin_tier_index,
  sort_order = EXCLUDED.sort_order,
  is_active = true;

-- processing-extended: 950 / 5 = 190.00 × 5
-- "Убрать очки/блики" появляется впервые здесь → origin_tier_index=1
INSERT INTO service_option_features
  (service_option_id, name, price, tier_index, origin_tier_index, sort_order)
SELECT so.id, x.name, 190.00, 1, x.origin, x.sort_order
FROM service_options so
CROSS JOIN (VALUES
  ('Чистка лица',          0, 10),
  ('Чистка фона',          0, 20),
  ('Выравнивание плеч',    0, 30),
  ('Коррекция причёски',   0, 40),
  ('Убрать очки/блики',    1, 50)
) AS x(name, origin, sort_order)
WHERE so.slug = 'processing-extended'
ON CONFLICT (service_option_id, name) DO UPDATE SET
  price = EXCLUDED.price,
  tier_index = EXCLUDED.tier_index,
  origin_tier_index = EXCLUDED.origin_tier_index,
  sort_order = EXCLUDED.sort_order,
  is_active = true;

-- processing-max: 1400 / 7 = 200.00 × 7
-- "Убрать морщины", "Убрать второй подбородок" появляются впервые → origin_tier_index=2
INSERT INTO service_option_features
  (service_option_id, name, price, tier_index, origin_tier_index, sort_order)
SELECT so.id, x.name, 200.00, 2, x.origin, x.sort_order
FROM service_options so
CROSS JOIN (VALUES
  ('Чистка лица',              0, 10),
  ('Чистка фона',              0, 20),
  ('Выравнивание плеч',        0, 30),
  ('Коррекция причёски',       0, 40),
  ('Убрать очки/блики',        1, 50),
  ('Убрать морщины',           2, 60),
  ('Убрать второй подбородок', 2, 70)
) AS x(name, origin, sort_order)
WHERE so.slug = 'processing-max'
ON CONFLICT (service_option_id, name) DO UPDATE SET
  price = EXCLUDED.price,
  tier_index = EXCLUDED.tier_index,
  origin_tier_index = EXCLUDED.origin_tier_index,
  sort_order = EXCLUDED.sort_order,
  is_active = true;

-- ============================================================================
-- 4. order_items.metadata.disabled_features — partial index для быстрого поиска
-- заказов со снятыми галочками (для ретушёра-дашборда)
-- ============================================================================
CREATE INDEX IF NOT EXISTS ix_order_items_disabled_features
  ON order_items USING gin ((metadata -> 'disabled_features'))
  WHERE metadata ? 'disabled_features';

COMMENT ON COLUMN order_items.metadata IS
  'JSONB snapshot. Ключ disabled_features: string[] имён features (из service_option_features.name), '
  'снятых оператором. Хранится как имя (не FK) — denormalized snapshot, как и unit_price.';

-- ============================================================================
-- 5. VIEW v_order_item_features — разворот для ретушёр-UI
-- ============================================================================
CREATE OR REPLACE VIEW v_order_item_features AS
SELECT
  oi.id                 AS order_item_id,
  oi.order_id,
  oi.service_option_id,
  sof.id                AS feature_id,
  sof.name              AS feature_name,
  sof.price             AS feature_price,
  sof.tier_index,
  sof.origin_tier_index,
  sof.sort_order,
  CASE
    WHEN oi.metadata ? 'disabled_features'
     AND (oi.metadata -> 'disabled_features') @> to_jsonb(sof.name)
    THEN true
    ELSE false
  END                   AS is_disabled
FROM order_items oi
JOIN service_option_features sof
  ON sof.service_option_id = oi.service_option_id
 AND sof.is_active = true
WHERE oi.service_option_id IS NOT NULL;

COMMENT ON VIEW v_order_item_features IS
  'Развернутый список features для каждого order_item с флагом disabled. '
  'Ретушёр-UI: SELECT ... WHERE order_id = ? ORDER BY sort_order.';

COMMIT;

-- ============================================================================
-- Post-conditions (проверить после применения):
--   SELECT so.slug, COUNT(*), SUM(sof.price) FROM service_options so
--     JOIN service_option_features sof ON sof.service_option_id = so.id
--    WHERE so.slug LIKE 'processing-%' GROUP BY so.slug;
--   Ожидание:
--     processing-basic    | 4 | 700.00
--     processing-extended | 5 | 950.00
--     processing-max      | 7 | 1400.00
-- ============================================================================
