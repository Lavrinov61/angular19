-- Migration 049: Промокоды для конвертов фото на документы (cross-sell)
-- SLC210 (печать фото), SLC315 (портрет), SLC412 (фотокнига), SLC507 (реставрация)

INSERT INTO promotions (slug, title, description, promo_code, discount_amount, service_slug, conditions, starts_at, is_active, sort_order)
VALUES
  ('envelope-slc210', 'Скидка 100₽ на печать фото — конверт SLC210',
   'Скидка 100₽ при печати от 10 фотографий. Промокод с конверта для фото на документы.',
   'SLC210', 100.00, 'photo-print',
   'При печати от 10 фотографий', '2026-04-30T00:00:00+03:00', true, 10),

  ('envelope-slc315', 'Скидка 200₽ на портретную съёмку — конверт SLC315',
   'Скидка 200₽ на портретную или семейную съёмку. Промокод с конверта для фото на документы.',
   'SLC315', 200.00, 'portrait-session',
   'На портретную или семейную съёмку', '2026-04-30T00:00:00+03:00', true, 11),

  ('envelope-slc412', 'Скидка 100₽ на фотокнигу — конверт SLC412',
   'Скидка 100₽ на изготовление фотокниги. Промокод с конверта для фото на документы.',
   'SLC412', 100.00, 'photobook',
   'На изготовление фотокниги', '2026-04-30T00:00:00+03:00', true, 12),

  ('envelope-slc507', 'Скидка 100₽ на реставрацию фото — конверт SLC507',
   'Скидка 100₽ на реставрацию старых фотографий. Промокод с конверта для фото на документы.',
   'SLC507', 100.00, 'restoration',
   'На реставрацию старых фотографий', '2026-04-30T00:00:00+03:00', true, 13)

ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  promo_code = EXCLUDED.promo_code,
  discount_amount = EXCLUDED.discount_amount,
  service_slug = EXCLUDED.service_slug,
  conditions = EXCLUDED.conditions,
  starts_at = EXCLUDED.starts_at,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();
