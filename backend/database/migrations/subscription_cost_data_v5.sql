-- Subscription Cost Data v5: real cost prices, photo paper, ink, equipment config
-- Applied: 2026-03-26
-- Idempotent: ON CONFLICT DO UPDATE, safe to re-run

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- 1. Fix paper cost_price (real purchase prices from SvetoCopy)
-- ═══════════════════════════════════════════════════════════════
UPDATE products SET cost_price = 0.62, sell_price = 1.00 WHERE name = 'Бумага A4 80g офисная';
UPDATE products SET cost_price = 2.80, sell_price = 4.00 WHERE name = 'Бумага A3 80g офисная';

-- ═══════════════════════════════════════════════════════════════
-- 2. Photo paper: real sell_price from service_options + cost (paper+ink)
-- ═══════════════════════════════════════════════════════════════
-- Super = сатин / суперглянец, Premium = матовая / глянец
UPDATE products SET sell_price = 19.50, cost_price = 7.04  WHERE name = 'Фотобумага 10x15 Premium';
UPDATE products SET sell_price = 36.00, cost_price = 10.80 WHERE name = 'Фотобумага 10x15 Super';
UPDATE products SET sell_price = 49.00, cost_price = 14.00 WHERE name = 'Фотобумага 15x21 Premium';
UPDATE products SET sell_price = 70.00, cost_price = 20.00 WHERE name = 'Фотобумага 15x21 Super';
UPDATE products SET sell_price = 117.00, cost_price = 30.10 WHERE name = 'Фотобумага 21x30 (A4) Premium';
UPDATE products SET sell_price = 450.00, cost_price = NULL  WHERE name = 'Фотобумага 30x40 Premium';  -- подрядчик
UPDATE products SET sell_price = 600.00, cost_price = NULL  WHERE name = 'Фотобумага 40x50 Premium';  -- подрядчик

-- Create 21x30 Super if not exists
INSERT INTO products (name, sell_price, cost_price, category_id, is_subscription_eligible, is_active)
SELECT 'Фотобумага 21x30 (A4) Super', 140.00, 47.00, id, false, true
FROM product_categories WHERE name = 'Фотобумага'
ON CONFLICT DO NOTHING;
-- In case it already exists, update
UPDATE products SET sell_price = 140.00, cost_price = 47.00 WHERE name = 'Фотобумага 21x30 (A4) Super';

-- ═══════════════════════════════════════════════════════════════
-- 3. Exclude photo paper from subscriptions (loss-making)
-- ═══════════════════════════════════════════════════════════════
UPDATE products SET is_subscription_eligible = false WHERE name ILIKE 'Фотобумага%';

-- Deactivate photo-print subscription plans
UPDATE subscription_plans SET is_active = false WHERE category = 'photo-print';

-- ═══════════════════════════════════════════════════════════════
-- 4. Scan/service product cost_price
-- ═══════════════════════════════════════════════════════════════
UPDATE products SET cost_price = 1.54  WHERE name = 'Авто-скан документа';
UPDATE products SET cost_price = 4.94, sell_price = 15.00 WHERE name = 'Ручное сканирование';
UPDATE products SET cost_price = 9.70, sell_price = 20.00 WHERE name = 'Кадрирование скана';
UPDATE products SET cost_price = 6.25, sell_price = 15.00 WHERE name = 'Ламинирование A4';

-- ═══════════════════════════════════════════════════════════════
-- 5. Business cost parameters in dynamic_pricing_config
-- ═══════════════════════════════════════════════════════════════

-- Laser consumables (paper + toner)
INSERT INTO dynamic_pricing_config (config_key, config_value, description) VALUES
('cost_consumables', '{
  "paper": {
    "a4_80g": {"brand": "SvetoCopy", "pack_sheets": 500, "pack_count": 5, "total_price": 1545, "per_sheet": 0.618},
    "a3_80g": {"brand": "SvetoCopy", "pack_sheets": 500, "pack_count": 1, "total_price": 1396, "per_sheet": 2.792}
  },
  "toner": {
    "model": "Canon C-EXV54", "type": "non-original",
    "black":   {"part": "C-EXV54BK", "price": 1399, "yield_pages": 15500, "per_page": 0.0903},
    "cyan":    {"part": "C-EXV54C",  "price": 1500, "yield_pages": 8500,  "per_page": 0.1765},
    "magenta": {"part": "C-EXV54M",  "price": 1500, "yield_pages": 8500,  "per_page": 0.1765},
    "yellow":  {"part": "C-EXV54Y",  "price": 1500, "yield_pages": 8500,  "per_page": 0.1765}
  },
  "toner_total_per_page": {"bw": 0.0903, "color": 0.6198},
  "updated": "2026-03-26"
}'::jsonb, 'Себестоимость расходных материалов: бумага, тонер (актуальные закупочные цены)')
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, description = EXCLUDED.description, updated_at = now();

-- Equipment (laser printer)
INSERT INTO dynamic_pricing_config (config_key, config_value, description) VALUES
('cost_equipment', '{
  "printer": {
    "model": "Canon imageRUNNER C3226i", "type": "color_laser_mfp",
    "purchase_price": 250000, "estimated_lifecycle_pages": 1500000,
    "per_page_amortization": 0.167, "speed_ppm": 26, "max_monthly_duty": 150000,
    "features": ["print", "copy", "scan", "duplex"], "paper_sizes": ["A4", "A3"]
  },
  "updated": "2026-03-26"
}'::jsonb, 'Оборудование: принтер/МФУ, амортизация, характеристики')
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, description = EXCLUDED.description, updated_at = now();

-- Fixed monthly costs
INSERT INTO dynamic_pricing_config (config_key, config_value, description) VALUES
('cost_fixed_monthly', '{
  "rent": {"amount": 23000, "unit": "rub/month", "note": "Аренда помещения"},
  "staff": {"daily_rate": 1500, "hours": "09:00-19:30", "hours_total": 10.5, "monthly_estimate": 45000},
  "electricity": {"rate_per_kwh": 14, "printer_consumption_kw": 1.5, "monthly_estimate": 2000},
  "total_fixed_estimate": 70000,
  "updated": "2026-03-26"
}'::jsonb, 'Постоянные ежемесячные расходы: аренда, ЗП, электричество')
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, description = EXCLUDED.description, updated_at = now();

-- Per-page cost summary at different volumes
INSERT INTO dynamic_pricing_config (config_key, config_value, description) VALUES
('cost_per_page_summary', '{
  "at_5k_pages":  {"a4_bw": 3.61, "a4_color": 4.14, "a3_bw": 5.78, "a3_color": 6.31, "note": "Высокая доля фиксированных"},
  "at_50k_pages": {"a4_bw": 2.25, "a4_color": 2.78, "a3_bw": 4.42, "a3_color": 4.95, "note": "Базовый сценарий"},
  "at_1m_pages":  {"a4_bw": 0.96, "a4_color": 1.49, "a3_bw": 3.13, "a3_color": 3.66, "note": "Целевой масштаб, 7 принтеров"},
  "retail_prices": {"a4_bw": 6, "a4_color": 15, "a3_bw": 12, "a3_color": 25},
  "updated": "2026-03-26"
}'::jsonb, 'Сводная себестоимость страницы при разных объёмах + розничные цены')
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, description = EXCLUDED.description, updated_at = now();

-- Photo paper purchase prices
INSERT INTO dynamic_pricing_config (config_key, config_value, description) VALUES
('cost_photo_paper', '{
  "a4_matte_220g_25":          {"name": "Матовая A4 220г",              "sheets": 25,  "price": 264,  "per_sheet": 10.56},
  "a4_matte_220g_400":         {"name": "Матовая A4 220г (4×100)",      "sheets": 400, "price": 2824, "per_sheet": 7.06},
  "a4_matte_double_220g_100":  {"name": "Матовая двусторонняя A4 220г", "sheets": 100, "price": 646,  "per_sheet": 6.46},
  "a4_matte_300g_50":          {"name": "Матовая A4 300г",              "sheets": 50,  "price": 801,  "per_sheet": 16.02},
  "a4_gloss_230g_50_437":      {"name": "Глянец A4 230г (437₽)",       "sheets": 50,  "price": 437,  "per_sheet": 8.74},
  "a4_gloss_230g_50_377":      {"name": "Глянец A4 230г (377₽)",       "sheets": 50,  "price": 377,  "per_sheet": 7.54},
  "a4_supergloss_260g_20":     {"name": "Суперглянец A4 260г (супер)",  "sheets": 20,  "price": 489,  "per_sheet": 24.45},
  "a4_adhesive_128g_20":       {"name": "Самоклейка A4 128г",           "sheets": 20,  "price": 314,  "per_sheet": 15.70},
  "10x15_gloss_240g_500":      {"name": "Глянец 10×15 240г",           "sheets": 500, "price": 865,  "per_sheet": 1.73},
  "10x15_satin_260g_100":      {"name": "Сатин 10×15 260г",            "sheets": 100, "price": 549,  "per_sheet": 5.49},
  "10x15_satin_260g_500":      {"name": "Сатин 10×15 260г (опт)",      "sheets": 500, "price": 2607, "per_sheet": 5.214},
  "10x15_supergloss_200g_50":  {"name": "Суперглянец 10×15 200г",      "sheets": 50,  "price": 1300, "per_sheet": 26.00},
  "updated": "2026-03-26"
}'::jsonb, 'Фотобумага: все виды, закупочные цены, стоимость за лист')
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, description = EXCLUDED.description, updated_at = now();

-- Photo ink (Epson L8050)
INSERT INTO dynamic_pricing_config (config_key, config_value, description) VALUES
('cost_photo_ink', '{
  "printer": {"model": "Epson L8050", "type": "inkjet_6color", "purchase_price": 35000},
  "ink_set": {
    "brand": "совместимые", "volume_ml": 500,
    "colors": {
      "black":   {"price": 592, "note": "из набора CMYK 2369₽"},
      "cyan":    {"price": 592, "note": "из набора CMYK 2369₽"},
      "magenta": {"price": 592, "note": "из набора CMYK 2369₽"},
      "yellow":  {"price": 592, "note": "из набора CMYK 2369₽"},
      "light_cyan":    {"price": 679},
      "light_magenta": {"price": 933}
    },
    "total_6_bottles": 3981, "total_volume_ml": 3000, "cost_per_ml": 1.327
  },
  "estimated_yield": {
    "10x15_photo": {"ink_ml": 4, "ink_cost": 5.31, "note": "~750 фото с комплекта"},
    "a4_photo":    {"ink_ml": 17, "ink_cost": 22.56, "note": "~175 фото A4 с комплекта"}
  },
  "updated": "2026-03-26"
}'::jsonb, 'Чернила Epson L8050: 6 цветов, стоимость за мл, расход на фото')
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, description = EXCLUDED.description, updated_at = now();

COMMIT;
