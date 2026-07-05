-- Migration: scraper_price_urls.sql
-- Update competitor scraper configs with explicit price_urls + CSS selectors.
-- Deactivate non-scrapable sources. Clean garbage prices.

-- 1. ТриНаЧетыре: одна страница /rnd (НЕ /rnd/price — 404!)
-- Tilda: .t-card__title (название) + .t-card__descr (описание+цена)
UPDATE kb_data_sources SET config = '{
  "url": "https://3x4photo.ru/rnd",
  "price_urls": ["https://3x4photo.ru/rnd"],
  "needs_js": true,
  "interval": "7d",
  "competitor_slug": "competitor-trinachetyre",
  "css_selectors": {
    "price_blocks": [".t-card__title", ".t-card__descr", ".t396__elem"],
    "exclude_zones": [".t-footer", ".t-menu", ".t-header"]
  }
}'::jsonb WHERE slug = 'web-trinachetyre';

-- 2. О!Фото: одна страница /
-- Tilda: .t-card__title (8 услуг) + .t-card__descr (dash-separated цены)
UPDATE kb_data_sources SET config = '{
  "url": "https://ophotosalon.tilda.ws",
  "price_urls": ["https://ophotosalon.tilda.ws"],
  "needs_js": true,
  "interval": "7d",
  "competitor_slug": "competitor-ofoto",
  "css_selectors": {
    "price_blocks": [".t-card__title", ".t-card__descr", ".t396__elem"],
    "exclude_zones": [".t-footer", ".t-menu", ".t-header"]
  }
}'::jsonb WHERE slug = 'web-ofoto';

-- 3. SkyPrint: ДЕАКТИВИРОВАТЬ scraper (цены в картинках, не в HTML)
UPDATE kb_data_sources SET is_active = FALSE WHERE slug = 'web-skyprint';

-- 4. Яркий: ДЕАКТИВИРОВАТЬ scraper (динамический калькулятор, не статические цены)
UPDATE kb_data_sources SET is_active = FALSE WHERE slug = 'web-yarkiy';

-- 5. Clean garbage prices (only unverified — protect verified markdown data)
DELETE FROM kb_competitor_prices WHERE service_name LIKE '| %' AND verified = FALSE;
DELETE FROM kb_competitor_prices WHERE service_name ~ '^\d[\d\s]*(₽|руб|р\.)' AND verified = FALSE;
DELETE FROM kb_competitor_prices WHERE service_name LIKE '[.%' AND verified = FALSE;
DELETE FROM kb_competitor_prices WHERE service_name LIKE '**%' AND verified = FALSE;
DELETE FROM kb_competitor_prices WHERE (service_name ILIKE '%проинвестировал%' OR service_name ILIKE '%000 000%') AND verified = FALSE;
DELETE FROM kb_competitor_prices WHERE (service_name ILIKE '%они%→%мы%' OR service_name ILIKE '%нет у них%' OR service_name ILIKE '%вывод:%') AND verified = FALSE;
DELETE FROM kb_competitor_prices WHERE service_name ~ '^от \d+$' AND verified = FALSE;

-- 6. Clean orphan history
DELETE FROM kb_price_history h WHERE NOT EXISTS (
    SELECT 1 FROM kb_competitor_prices p
    WHERE p.competitor_id = h.competitor_id AND p.service_name = h.service_name
);

-- 7. Reset crawled pages
DELETE FROM kb_crawled_pages;
