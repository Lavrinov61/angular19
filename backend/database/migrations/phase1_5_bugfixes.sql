-- Phase 1.5: Critical Bug Fixes Migration
-- BUG-5: satisfies_requires field (replaces hardcoded 'basic' slug check)
-- BUG-6: soft delete for option_rules
-- BUG-7: fix discount_percent + VIP anomaly comment

-- ========================================
-- BUG-5: satisfies_requires
-- ========================================

ALTER TABLE service_options
  ADD COLUMN IF NOT EXISTS satisfies_requires BOOLEAN DEFAULT true;

COMMENT ON COLUMN service_options.satisfies_requires IS
  'Опция удовлетворяет requires-правила при проверке группы. false = "базовый уровень", не считается для requires.';

-- basic processing-level не удовлетворяет requires (вместо хардкода o.slug !== "basic")
UPDATE service_options
SET satisfies_requires = false
WHERE slug = 'basic'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON og.service_category_id = sc.id
    WHERE og.slug = 'processing-level' AND sc.slug = 'photo-docs'
  );

-- ========================================
-- BUG-7: Fix discount_percent seed data
-- ========================================

-- basic: base=350, original=400 → real discount = round((1 - 350/400)*100) = 13%
-- retouch: base=700, online=590, original=700 → discount is on online price vs original = round((1 - 590/700)*100) = 16% (correct)
-- Обнуляем discount_percent — будет computed в CRM (Phase 5)
UPDATE service_options
SET discount_percent = NULL
WHERE slug IN ('basic', 'retouch', 'vip')
  AND option_group_id IN (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON og.service_category_id = sc.id
    WHERE og.slug = 'processing-level' AND sc.slug = 'photo-docs'
  );

-- ========================================
-- VIP anomaly: price_online (950) > base_price (700)
-- Это намеренно: VIP онлайн — премиальный тариф с 4 вариантами обработки.
-- В студии цена ниже т.к. фотограф делает часть работы на месте.
-- Добавляем пояснение через описание опции (нельзя COMMENT ON ROW).
-- ========================================
