-- Migration: SVG097 per-service promo codes
BEGIN;

-- Удаляем старый уникальный индекс (только по коду)
DROP INDEX IF EXISTS idx_promotions_promo_code_unique;

-- Новый: уникальный по (код + service_slug)
CREATE UNIQUE INDEX idx_promotions_promo_code_unique
  ON promotions (UPPER(promo_code::text), COALESCE(service_slug, ''))
  WHERE promo_code IS NOT NULL AND is_active = true;

-- Деактивируем старый SVG097 (5% на всё)
UPDATE promotions
SET is_active = false, updated_at = NOW()
WHERE UPPER(promo_code) = 'SVG097' AND is_active = true;

-- 3 per-service записи
INSERT INTO promotions (slug, title, description, promo_code, service_slug, discount_amount, discount_percent, is_active, starts_at, sort_order)
VALUES
  ('svg097-copy-print', 'Флаер Сын Оли — Печать/Ксерокопия', '2 копии бесплатно (скидка 20₽ на печать/ксерокопию)', 'SVG097', 'copy-print', 20, NULL, true, '2026-04-30', 100),
  ('svg097-photo-docs', 'Флаер Сын Оли — Фото на документы', 'Скидка 100₽ на фото на документы', 'SVG097', 'photo-docs', 100, NULL, true, '2026-04-30', 101),
  ('svg097-scan-services', 'Флаер Сын Оли — Сканирование', 'Первые 10 стр по 3₽ вместо 5₽ (скидка 20₽)', 'SVG097', 'scan-services', 20, NULL, true, '2026-04-30', 102)
ON CONFLICT DO NOTHING;

COMMIT;
