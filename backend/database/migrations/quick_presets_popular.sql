-- Fix popular flags for Quick Presets in POS
-- Before: popular was only on niche B2B services (marketplace 10000₽, infographics 8000₽, etc.)
-- After: popular on everyday studio services (xerocopy, scanning, photo print, retouch, etc.)

BEGIN;

-- 1. Remove popular from niche/expensive B2B services
UPDATE service_options SET popular = false, updated_at = now()
WHERE slug IN ('artistic', '10-articles', 'pack-10', 'pack-5-reels', 'selling-standard')
  AND popular = true;

-- 2. Mark everyday studio services as popular
UPDATE service_options SET popular = true, updated_at = now()
WHERE slug IN (
  'copy-a4-bw',         -- Ксерокопия А4 ч/б 10₽
  'print-a4-bw',        -- Печать А4 ч/б 10₽
  'print-a4-color',     -- Печать А4 цветная 15₽
  'scan-manual',        -- Сканирование 50₽
  '10x15-premium',      -- Фото 10×15 премиум 19₽
  'lamination',         -- Ламинирование 100₽
  'studio-retouch',     -- Ретушь 600₽
  'scan-auto'           -- Сканирование авто 5₽
) AND popular = false;

-- 'retouch' (Профессиональный 700₽) already popular=true, no change needed

COMMIT;
