-- 20260507_cost_variable_per_page_summary.sql
-- Purpose: store variable print cost separately from full cost at monthly volume.

BEGIN;

INSERT INTO dynamic_pricing_config (config_key, config_value, description) VALUES
('cost_variable_per_page_summary', '{
  "cost_type": "variable_without_fixed_costs",
  "unit": "rub/page",
  "page_definition": "Одна страница = одна напечатанная сторона; расчёт ниже использует симплекс-модель: одна страница на одном физическом листе.",
  "includes": ["paper", "toner", "equipment_amortization"],
  "excludes": ["rent", "staff", "electricity"],
  "source_config_keys": ["cost_consumables", "cost_equipment"],
  "full_cost_config_key": "cost_per_page_summary",
  "a4_bw": {
    "paper": 0.618,
    "toner": 0.0903,
    "equipment_amortization": 0.167,
    "total": 0.8753
  },
  "a4_color": {
    "paper": 0.618,
    "toner": 0.6198,
    "equipment_amortization": 0.167,
    "total": 1.4048
  },
  "a3_bw": {
    "paper": 2.792,
    "toner": 0.0903,
    "equipment_amortization": 0.167,
    "total": 3.0493
  },
  "a3_color": {
    "paper": 2.792,
    "toner": 0.6198,
    "equipment_amortization": 0.167,
    "total": 3.5788
  },
  "display_totals": {
    "a4_bw": 0.88,
    "a4_color": 1.40,
    "a3_bw": 3.05,
    "a3_color": 3.58
  },
  "updated": "2026-05-07"
}'::jsonb, 'Переменная себестоимость страницы без постоянных расходов')
ON CONFLICT (config_key) DO UPDATE SET
  config_value = EXCLUDED.config_value,
  description = EXCLUDED.description,
  updated_at = NOW();

UPDATE dynamic_pricing_config
SET
  config_value = config_value
    || '{
      "cost_type": "full_with_fixed_costs",
      "unit": "rub/page",
      "page_definition": "Одна страница = одна напечатанная сторона; расчёт использует симплекс-модель: одна страница на одном физическом листе.",
      "variable_cost_config_key": "cost_variable_per_page_summary",
      "fixed_monthly_assumption": 94000,
      "fixed_cost_per_page": {
        "at_5k_pages": 18.8,
        "at_50k_pages": 1.88,
        "at_1m_pages": 0.094
      },
      "updated": "2026-05-07"
    }'::jsonb,
  updated_at = NOW()
WHERE config_key = 'cost_per_page_summary';

COMMIT;
