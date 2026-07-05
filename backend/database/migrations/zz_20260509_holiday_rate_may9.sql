-- 2026-05-09: holiday working day rate.
-- Applied by pricing-engine.service.ts only when conditions.type='holiday_rate'.

INSERT INTO price_modifiers (
  name,
  modifier_type,
  scope,
  modifier_action,
  modifier_value,
  conditions,
  priority,
  starts_at,
  ends_at,
  is_active
)
SELECT
  'Праздничный тариф 9 мая ×2',
  'seasonal',
  'global',
  'multiply',
  2.0000,
  jsonb_build_object(
    'type', 'holiday_rate',
    'label', 'Праздничный тариф 9 мая ×2',
    'customer_notice', '9 мая работаем в праздничный день. На услуги действует праздничный тариф ×2; фото на документы и портреты без наценки.',
    'exclude_category_slugs', jsonb_build_array('photo-docs', 'portrait'),
    'exclude_option_slugs', jsonb_build_array(
      'portrait-photo',
      'km-портретное-фото-бизнес-резюме-реклама-и-тд'
    ),
    'exclude_name_contains', jsonb_build_array('портрет')
  ),
  1000,
  '2026-05-09 00:00:00+03'::timestamptz,
  '2026-05-10 00:00:00+03'::timestamptz,
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM price_modifiers
  WHERE name = 'Праздничный тариф 9 мая ×2'
    AND modifier_type = 'seasonal'
    AND COALESCE(conditions->>'type', '') = 'holiday_rate'
);
