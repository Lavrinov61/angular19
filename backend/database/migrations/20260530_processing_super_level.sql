-- Супер обработка (3000 ₽) — новая верхняя ступень в группе "Уровень обработки"
-- (service_categories.slug='photo-docs' → option_groups.slug='processing-level').
--
-- Лесенка обработки: Без обработки (0) → Базовая (700) → Расширенная (950)
--                    → Максимальная (1400) → Супер (3000).
--
-- Ценовая модель скопирована с "Максимальной обработки" (processing-max):
--   price_next_unit = NULL и price_max = NULL → цена линейна по числу фото
--   (pricing-engine откатывается к base_price для каждой единицы): 3000 ₽ × N фото.
--
-- Идемпотентно: при повторном прогоне обновляет существующую строку.

INSERT INTO service_options (
  option_group_id,
  slug,
  name,
  description,
  base_price,
  price_studio,
  price_online,
  price_next_unit,
  price_max,
  features,
  popular,
  estimated_minutes,
  sort_order,
  is_active
)
SELECT
  og.id,
  'processing-super',
  'Супер обработка',
  'Премиум-уровень: 10+ вариантов обработки сразу — несколько вариантов макияжа, вариантов одежды и художественной обработки на выбор.',
  3000.00,
  3000.00,
  3000.00,
  NULL,           -- как у "Максимальной обработки": следующая единица = base_price
  NULL,           -- без потолка цены
  '[
    "Чистка лица",
    "Чистка фона",
    "Выравнивание плеч",
    "Коррекция причёски",
    "Убрать очки/блики",
    "Убрать морщины",
    "Убрать второй подбородок",
    "Несколько вариантов макияжа",
    "Несколько вариантов одежды",
    "Художественная цветокоррекция",
    "Замена/обработка фона",
    "Несколько вариантов обработки на выбор"
  ]'::jsonb,
  false,
  60,             -- больше работы, чем у Максимальной (30 мин)
  40,             -- после processing-max (sort_order 30)
  true
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'processing-level'
  AND sc.slug = 'photo-docs'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  name              = EXCLUDED.name,
  description       = EXCLUDED.description,
  base_price        = EXCLUDED.base_price,
  price_studio      = EXCLUDED.price_studio,
  price_online      = EXCLUDED.price_online,
  price_next_unit   = EXCLUDED.price_next_unit,
  price_max         = EXCLUDED.price_max,
  features          = EXCLUDED.features,
  popular           = EXCLUDED.popular,
  estimated_minutes = EXCLUDED.estimated_minutes,
  sort_order        = EXCLUDED.sort_order,
  is_active         = EXCLUDED.is_active,
  updated_at        = now();
