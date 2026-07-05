-- Migration 051: Расширенный набор промокодов для флайеров (все услуги)
-- FLR340 (реставрация), FLR450 (холст), FLR560 (кружка), FLR670 (визитки), FLR780 (портрет)

INSERT INTO promotions (slug, title, description, promo_code, discount_amount, service_slug, conditions, starts_at, is_active, sort_order)
VALUES
  ('flyer-flr340', 'Скидка 100₽ на реставрацию фото — флайер FLR340',
   'Скидка 100₽ на реставрацию старых фотографий. Промокод с флайера.',
   'FLR340', 100.00, 'restoration',
   'На реставрацию фото', '2026-04-30T00:00:00+03:00', true, 22),

  ('flyer-flr450', 'Скидка 200₽ на печать на холсте — флайер FLR450',
   'Скидка 200₽ на печать фото на холсте. Промокод с флайера.',
   'FLR450', 200.00, 'canvas-print',
   'На печать на холсте', '2026-04-30T00:00:00+03:00', true, 23),

  ('flyer-flr560', 'Скидка 100₽ на кружку с фото — флайер FLR560',
   'Скидка 100₽ на печать фото на кружке. Промокод с флайера.',
   'FLR560', 100.00, 'mug-print',
   'На кружку с фото', '2026-04-30T00:00:00+03:00', true, 24),

  ('flyer-flr670', 'Скидка 100₽ на визитки — флайер FLR670',
   'Скидка 100₽ на печать визиток от 100 шт. Промокод с флайера.',
   'FLR670', 100.00, 'business-cards',
   'На визитки от 100 шт', '2026-04-30T00:00:00+03:00', true, 25),

  ('flyer-flr780', 'Скидка 200₽ на деловой портрет — флайер FLR780',
   'Скидка 200₽ на деловой портрет. Промокод с флайера.',
   'FLR780', 200.00, 'portrait-session',
   'На деловой портрет', '2026-04-30T00:00:00+03:00', true, 26)

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
