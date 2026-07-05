-- 125_update_max_processing_price.sql — Повышение цены "Максимальная обработка" с 1350₽ до 1400₽
-- Дата: 2026-04-20

UPDATE service_options
SET base_price = 1400,
    price_studio = 1400,
    price_online = 1400
WHERE slug = 'processing-max'
  AND base_price = 1350;

UPDATE retouch_presets
SET price = 1400
WHERE document_type = 'passport_rf'
  AND retouch_level = 'maximum'
  AND price = 1350;
