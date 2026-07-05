-- Migration 050: Промокоды для флайеров (cross-sell при печати)
-- FLR120 (документы->фотопечать), FLR230 (фотопечать->фото на документы)

INSERT INTO promotions (slug, title, description, promo_code, discount_amount, service_slug, conditions, starts_at, is_active, sort_order)
VALUES
  ('flyer-flr120', 'Скидка 100₽ на печать фото — флайер FLR120',
   'Скидка 100₽ при печати от 10 фотографий. Промокод с флайера для клиентов печати документов.',
   'FLR120', 100.00, 'photo-print',
   'При печати от 10 фотографий', '2026-04-30T00:00:00+03:00', true, 20),

  ('flyer-flr230', 'Скидка 100₽ на фото на документы — флайер FLR230',
   'Скидка 100₽ на фото на документы. Промокод с флайера для клиентов фотопечати.',
   'FLR230', 100.00, 'photo-docs',
   'При предъявлении флайера', '2026-04-30T00:00:00+03:00', true, 21)

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
