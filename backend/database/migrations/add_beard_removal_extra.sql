BEGIN;

-- Сдвигаем sort_order существующих extras чтобы освободить место для beard-removal
UPDATE service_options SET sort_order = 3 WHERE slug = 'all-docs-bundle';
UPDATE service_options SET sort_order = 4 WHERE slug = 'print-delivery';

-- Новая опция «Убрать бороду»
INSERT INTO service_options (
  option_group_id, slug, name, description, icon, color,
  base_price, price_online, price_studio,
  features, popular, satisfies_requires, sort_order
) VALUES (
  'b54d4bf2-c402-478e-a605-f66a5396d1d8',  -- extras group (photo-docs)
  'beard-removal',
  'Убрать бороду',
  'Аккуратное удаление бороды / щетины на фото',
  'content_cut', '#ff6b6b',
  300, 300, 300,
  '["Естественный результат", "Профессиональная ретушь"]'::jsonb,
  false, false, 2
);

-- requires rule: beard-removal требует обработку (retouch или vip)
-- Движок проверяет: есть ли в группе target любая опция с satisfies_requires=true среди выбранных
INSERT INTO option_rules (
  service_category_id, rule_type,
  source_option_id, target_option_id, description
) VALUES (
  '695512d1-0c80-40d3-8663-8f3f31b98257',  -- photo-docs category
  'requires',
  (SELECT id FROM service_options WHERE slug = 'beard-removal'),
  'e69d76bb-1143-4e29-ad6c-fc79f0a551af',  -- retouch (satisfies_requires=true)
  'Удаление бороды требует обработку (С обработкой или VIP)'
);

COMMIT;
