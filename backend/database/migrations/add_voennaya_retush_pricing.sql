-- Add pricing category for military retouch service "Parade Hero"

INSERT INTO service_categories (slug, name, description, icon, gradient, price_range, display_channels, sort_order)
VALUES (
  'voennaya-retush',
  'Парадный Герой',
  'Военная художественная ретушь: удаление бороды, форма, награды',
  'military_tech',
  'linear-gradient(135deg, #2f4f4f 0%, #4b6b58 100%)',
  'от 1 500₽',
  '{website,chatbot,pos}',
  6
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO option_groups (service_category_id, slug, name, description, selection_type, is_required, max_selections, sort_order)
VALUES (
  (SELECT id FROM service_categories WHERE slug = 'voennaya-retush'),
  'package',
  'Пакет услуги',
  'Выберите уровень военной ретуши',
  'single',
  true,
  1,
  1
)
ON CONFLICT (service_category_id, slug) DO NOTHING;

INSERT INTO service_options (
  option_group_id,
  slug,
  name,
  description,
  icon,
  color,
  base_price,
  price_online,
  price_studio,
  features,
  popular,
  original_price,
  discount_percent,
  sort_order
)
VALUES
  (
    (SELECT id FROM option_groups WHERE slug = 'package' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
    'basic',
    'Базовый',
    'Убрать бороду и добавить простую форму',
    'checkroom',
    '#5f7c69',
    1500,
    1500,
    1500,
    '["Убрать бороду", "Простая форма", "Ручная ретушь"]'::jsonb,
    false,
    1800,
    16,
    1
  ),
  (
    (SELECT id FROM option_groups WHERE slug = 'package' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
    'parade',
    'Парадный',
    'Добавление медалей, погон и цветокоррекция',
    'workspace_premium',
    '#4f6f7f',
    2500,
    2500,
    2500,
    '["Форма и награды", "Медали и погоны", "Цвет и детализация"]'::jsonb,
    true,
    3000,
    17,
    2
  ),
  (
    (SELECT id FROM option_groups WHERE slug = 'package' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
    'full',
    'Полный',
    'Восстановление старого фото, шевроны и текст',
    'auto_fix_high',
    '#6a5f8f',
    3500,
    3500,
    3500,
    '["Восстановление", "Шевроны", "Текстовая персонализация"]'::jsonb,
    false,
    4200,
    16,
    3
  ),
  (
    (SELECT id FROM option_groups WHERE slug = 'package' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
    'gift',
    'Подарочный',
    'Максимальный пакет с рамкой "С Днем Победы!"',
    'card_giftcard',
    '#9b6a4f',
    4500,
    4500,
    4500,
    '["Все из Полного", "Рамка \"С Днем Победы!\"", "Подарочная подача"]'::jsonb,
    false,
    5200,
    13,
    4
  )
ON CONFLICT (option_group_id, slug) DO NOTHING;
