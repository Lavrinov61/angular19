-- 2026-05-15: "Файлик" now costs 10 RUB; pricing engine enforces the 10 RUB minimum check.
BEGIN;

UPDATE service_options
SET base_price = 10,
    price_studio = 10,
    price_online = CASE WHEN price_online IS NULL THEN NULL ELSE 10 END,
    updated_at = now()
WHERE slug = 'file-sleeve';

COMMIT;
