-- Migration 097: Fix prices, rename A4 options, recalculate combos, remove fake savings
-- Idempotent: safe to run multiple times

BEGIN;

-- =============================================================================
-- 1. Portrait retouch: 600 -> 900
-- =============================================================================
UPDATE service_options
SET base_price = 900, price_online = 900, price_studio = 900, updated_at = now()
WHERE slug = 'portrait-retouch-option';

-- =============================================================================
-- 2. A4 Xerocopy group: rename + price adjustments
-- =============================================================================

-- A4 Ксерокопия -> А4 до 15% (price 10, unchanged)
UPDATE service_options
SET name = 'А4 до 15%', updated_at = now()
WHERE slug = 'km-а4-ксерокопия';

-- A4 Ксерокопия Цветная -> А4 до 50% (price 15 -> 25)
UPDATE service_options
SET name = 'А4 до 50%', base_price = 25, price_studio = 25, updated_at = now()
WHERE slug = 'km-а4-ксерокопия-цветная';

-- A4 Ксерокопия Фото Цветная -> А4 до 100% (price 60, unchanged)
UPDATE service_options
SET name = 'А4 до 100%', updated_at = now()
WHERE slug = 'km-а4-ксерокопия-фото-цветная';

-- INSERT new "А4 до 75%" = 35 in xerocopy group (sort_order between 50% and 100%)
INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, sort_order, is_active, satisfies_requires)
SELECT
    option_group_id,
    'km-а4-до-75',
    'А4 до 75%',
    40,
    40,
    2,  -- will be fixed below
    true,
    true
FROM service_options
WHERE slug = 'km-а4-ксерокопия'
ON CONFLICT (option_group_id, slug) DO UPDATE
SET name = 'А4 до 75%', base_price = 40, price_studio = 40, is_active = true, updated_at = now();

-- Fix sort_order: 15%=1, 50%=2, 75%=3, 100%=4 (shift 100% up)
UPDATE service_options SET sort_order = 4 WHERE slug = 'km-а4-ксерокопия-фото-цветная';
UPDATE service_options SET sort_order = 3 WHERE slug = 'km-а4-до-75';

-- =============================================================================
-- 3. A4 Print group: rename + price adjustments
-- =============================================================================

-- А4 Печать документа -> А4 Печать до 15% (price 10, unchanged)
UPDATE service_options
SET name = 'А4 Печать до 15%', updated_at = now()
WHERE slug = 'km-а4-печать-документа';

-- А4 Печать документа цветная -> А4 Печать до 50% (price 15 -> 25)
UPDATE service_options
SET name = 'А4 Печать до 50%', base_price = 25, price_studio = 25, updated_at = now()
WHERE slug = 'km-а4-печать-документа-цветная';

-- А4 фото-документ -> А4 Печать до 100% (price 60, unchanged)
UPDATE service_options
SET name = 'А4 Печать до 100%', updated_at = now()
WHERE slug = 'km-а4-фото-документ';

-- INSERT new "А4 Печать до 75%" = 35 in print group
INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, sort_order, is_active, satisfies_requires)
SELECT
    option_group_id,
    'km-а4-печать-до-75',
    'А4 Печать до 75%',
    40,
    40,
    9,  -- between 50%(8) and 100%(10)
    true,
    true
FROM service_options
WHERE slug = 'km-а4-печать-документа'
ON CONFLICT (option_group_id, slug) DO UPDATE
SET name = 'А4 Печать до 75%', base_price = 40, price_studio = 40, is_active = true, updated_at = now();

-- =============================================================================
-- 4. Combo packages: remove fake savings, recalculate real totals
-- =============================================================================

-- Clear all savings labels and original_total
UPDATE combo_packages SET original_total = NULL, savings_label = NULL;

-- Recalculate combo_price as real sum of components (AFTER retouch price update)
UPDATE combo_packages cp
SET combo_price = sub.real_total
FROM (
    SELECT cpi.combo_package_id, SUM(so.base_price * cpi.quantity) AS real_total
    FROM combo_package_items cpi
    JOIN service_options so ON cpi.service_option_id = so.id
    GROUP BY cpi.combo_package_id
) sub
WHERE cp.id = sub.combo_package_id;

-- =============================================================================
-- 5. Subscription plans: remove fake savings_label
-- =============================================================================

UPDATE subscription_plans SET savings_label = NULL;

COMMIT;
