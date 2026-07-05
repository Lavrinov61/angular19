-- F102: Combo Packages — bundled service offers with discount
-- Allows creating pre-defined bundles like "Portrait + Retouch + Canvas" at a combo price

BEGIN;

-- ========================================
-- COMBO PACKAGES
-- ========================================

CREATE TABLE IF NOT EXISTS combo_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  combo_price DECIMAL(10,2) NOT NULL,
  original_total DECIMAL(10,2),
  savings_label VARCHAR(100),
  display_channels TEXT[] DEFAULT '{crm,pos}',
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_combo_packages_active ON combo_packages(is_active, sort_order);

-- ========================================
-- COMBO PACKAGE ITEMS
-- ========================================

CREATE TABLE IF NOT EXISTS combo_package_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_package_id UUID NOT NULL REFERENCES combo_packages(id) ON DELETE CASCADE,
  service_option_id UUID NOT NULL REFERENCES service_options(id) ON DELETE RESTRICT,
  quantity INT DEFAULT 1 NOT NULL,
  sort_order INT DEFAULT 0,
  UNIQUE(combo_package_id, service_option_id)
);

CREATE INDEX IF NOT EXISTS idx_combo_package_items_package ON combo_package_items(combo_package_id);
CREATE INDEX IF NOT EXISTS idx_combo_package_items_option ON combo_package_items(service_option_id);

-- ========================================
-- SEED: Портрет + Ретушь + Холст 30x40
-- ========================================
-- portrait-photo: 900, portrait-retouch-option: 600, km-печать-на-холсте-30x40: 2200
-- original_total = 3700, combo_price = 3330 (скидка ~10%, экономия 370)

INSERT INTO combo_packages (slug, name, description, combo_price, original_total, savings_label, display_channels, sort_order)
VALUES (
  'portrait-retouch-canvas',
  'Портрет + Ретушь + Холст 30x40',
  'Портретное фото с профессиональной ретушью и печатью на холсте 30x40 см',
  3330.00,
  3700.00,
  'Экономия 370₽',
  '{crm,pos}',
  1
)
ON CONFLICT (slug) DO NOTHING;

-- Items: portrait-photo
INSERT INTO combo_package_items (combo_package_id, service_option_id, quantity, sort_order)
SELECT cp.id, so.id, 1, 1
FROM combo_packages cp, service_options so
WHERE cp.slug = 'portrait-retouch-canvas' AND so.slug = 'portrait-photo'
  AND NOT EXISTS (
    SELECT 1 FROM combo_package_items cpi
    WHERE cpi.combo_package_id = cp.id AND cpi.service_option_id = so.id
  );

-- Items: portrait-retouch-option
INSERT INTO combo_package_items (combo_package_id, service_option_id, quantity, sort_order)
SELECT cp.id, so.id, 1, 2
FROM combo_packages cp, service_options so
WHERE cp.slug = 'portrait-retouch-canvas' AND so.slug = 'portrait-retouch-option'
  AND NOT EXISTS (
    SELECT 1 FROM combo_package_items cpi
    WHERE cpi.combo_package_id = cp.id AND cpi.service_option_id = so.id
  );

-- Items: km-печать-на-холсте-30x40
INSERT INTO combo_package_items (combo_package_id, service_option_id, quantity, sort_order)
SELECT cp.id, so.id, 1, 3
FROM combo_packages cp, service_options so
WHERE cp.slug = 'portrait-retouch-canvas' AND so.slug = 'km-печать-на-холсте-30x40'
  AND NOT EXISTS (
    SELECT 1 FROM combo_package_items cpi
    WHERE cpi.combo_package_id = cp.id AND cpi.service_option_id = so.id
  );

COMMIT;
