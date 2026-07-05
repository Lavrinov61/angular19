-- Fix: sync features JSONB with actual plan_items data
-- Features were showing inflated/wrong numbers that don't match included quantities
-- Idempotent: safe to re-run

BEGIN;

-- doc-print: features showed 2x the actual plan_items quantities
UPDATE subscription_plans SET features = '["50 стр A4 ч/б", "5 стр A4 цвет", "Скидка 15% сверх лимита", "Перенос на 3 мес"]'::jsonb
WHERE slug = 'doc-print-student';

UPDATE subscription_plans SET features = '["200 стр A4 ч/б", "20 стр A4 цвет", "10 стр A3 ч/б", "Скидка 20% сверх лимита", "Перенос на 3 мес"]'::jsonb
WHERE slug = 'doc-print-business';

UPDATE subscription_plans SET features = '["500 стр A4 ч/б", "50 стр A4 цвет", "20 стр A3 ч/б", "Скидка 30% сверх лимита", "Перенос на 3 мес"]'::jsonb
WHERE slug = 'doc-print-office';

-- photo-print: features still described old discount-model, now credit-based
UPDATE subscription_plans SET features = '["15 фото 10×15", "Скидка 10% сверх лимита", "Перенос на 3 мес"]'::jsonb
WHERE slug = 'photoprint-fan';

UPDATE subscription_plans SET features = '["25 фото 10×15", "5 фото 15×21", "Скидка 15% сверх лимита", "Перенос на 3 мес"]'::jsonb
WHERE slug = 'photoprint-family';

UPDATE subscription_plans SET features = '["50 фото 10×15", "10 фото 15×21", "3 фото 21×30", "Скидка 20% сверх лимита", "Перенос на 3 мес"]'::jsonb
WHERE slug = 'photoprint-photographer';

-- photo-docs: features look correct, just format consistently
UPDATE subscription_plans SET features = '["5 комплектов документов", "2 подстановки формы", "1 нейро-стандарт", "Скидка 10% сверх лимита", "Перенос на 3 мес"]'::jsonb
WHERE slug = 'photo-docs-agent';

UPDATE subscription_plans SET features = '["12 комплектов документов", "6 подстановок формы", "3 нейро-стандарт", "1 нейро-полный", "Скидка 15% сверх лимита", "Перенос на 3 мес"]'::jsonb
WHERE slug = 'photo-docs-agency';

UPDATE subscription_plans SET features = '["25 комплектов документов", "15 подстановок формы", "2 срочных", "5 нейро-стандарт", "2 нейро-полных", "Скидка 25% сверх лимита", "Перенос на 3 мес"]'::jsonb
WHERE slug = 'photo-docs-corp';

-- retouch: features match plan_items, add "Перенос на 3 мес"
UPDATE subscription_plans SET features = '["5 простых ретушей", "1 базовая ретушь", "Скидка 10% сверх лимита", "Перенос на 3 мес"]'::jsonb
WHERE slug = 'retouch-fan';

UPDATE subscription_plans SET features = '["10 простых", "3 базовых", "5 репортажных", "1 профессиональная", "Скидка 20% сверх лимита", "Перенос на 3 мес"]'::jsonb
WHERE slug = 'retouch-pro';

UPDATE subscription_plans SET features = '["30 простых", "5 базовых", "10 репортажных", "1 профессиональная", "Скидка 30% сверх лимита", "Перенос на 3 мес"]'::jsonb
WHERE slug = 'retouch-studio';

-- scan: features match plan_items, add "Перенос на 3 мес"
UPDATE subscription_plans SET features = '["100 авто-сканов", "5 ручных сканов", "Скидка 10% сверх лимита", "Перенос на 3 мес"]'::jsonb
WHERE slug = 'scan-lite';

UPDATE subscription_plans SET features = '["300 авто-сканов", "20 ручных сканов", "10 кадрирований", "Скидка 15% сверх лимита", "Перенос на 3 мес"]'::jsonb
WHERE slug = 'scan-pro';

UPDATE subscription_plans SET features = '["500 авто-сканов", "30 ручных сканов", "20 кадрирований", "10 ламинирований", "Скидка 25% сверх лимита", "Перенос на 3 мес"]'::jsonb
WHERE slug = 'scan-biz';

COMMIT;
