-- 20260507_cost_fixed_staff_daily_rate.sql
-- Purpose: correct cost model staff day rate from 1500 to 2300 rubles
-- and refresh precomputed per-page cost summary.

BEGIN;

UPDATE dynamic_pricing_config
SET
  config_value = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(config_value, '{staff,daily_rate}', '2300'::jsonb, true),
        '{staff,monthly_estimate}', '69000'::jsonb, true
      ),
      '{total_fixed_estimate}', '94000'::jsonb, true
    ),
    '{updated}', to_jsonb('2026-05-07'::text), true
  ),
  updated_at = NOW()
WHERE config_key = 'cost_fixed_monthly';

UPDATE dynamic_pricing_config
SET
  config_value = '{
    "at_5k_pages":  {"a4_bw": 19.68, "a4_color": 20.20, "a3_bw": 21.85, "a3_color": 22.38, "note": "Высокая доля фиксированных расходов"},
    "at_50k_pages": {"a4_bw": 2.76,  "a4_color": 3.28,  "a3_bw": 4.93,  "a3_color": 5.46,  "note": "Базовый сценарий для ценообразования"},
    "at_1m_pages":  {"a4_bw": 0.97,  "a4_color": 1.50,  "a3_bw": 3.14,  "a3_color": 3.67,  "note": "Целевой масштаб, нужно 7 принтеров"},
    "retail_prices": {"a4_bw": 6, "a4_color": 15, "a3_bw": 12, "a3_color": 25},
    "updated": "2026-05-07"
  }'::jsonb,
  updated_at = NOW()
WHERE config_key = 'cost_per_page_summary';

COMMIT;
