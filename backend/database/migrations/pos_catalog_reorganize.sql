-- POS Catalog Reorganization Migration
-- Idempotent: safe to run multiple times
-- Created: 2026-03-19

BEGIN;

-- ============================================================
-- STEP 1: CREATE/UPDATE CATEGORIES (10 POS categories)
-- ============================================================

INSERT INTO service_categories (id, slug, name, icon, sort_order, is_active)
VALUES
  (gen_random_uuid(), 'copy-print',          'Ксерокопия и печать',            'content_copy',   2, true),
  (gen_random_uuid(), 'photo-print-format',  'Фотопечать',                     'photo_library',  3, true),
  (gen_random_uuid(), 'scan-services',       'Сканирование и доп. услуги',     'scanner',        4, true),
  (gen_random_uuid(), 'retouch',             'Ретушь и обработка',             'auto_fix_high',  5, true),
  (gen_random_uuid(), 'restoration',         'Реставрация фото',               'healing',        6, true),
  (gen_random_uuid(), 'frames-souvenirs',    'Рамки и сувениры',               'frame_inspect',  7, true),
  (gen_random_uuid(), 'polygraphy',          'Визитки и полиграфия',           'style',          8, true),
  (gen_random_uuid(), 'design-text',         'Дизайн и тексты',                'palette',        9, true),
  (gen_random_uuid(), 'studio-special',      'Студийные и спец. услуги',       'camera_indoor', 10, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  is_active = true;

-- Update existing photo-docs
UPDATE service_categories SET name = 'Фото на документы', icon = 'photo_camera', sort_order = 1, is_active = true WHERE slug = 'photo-docs';

-- ============================================================
-- STEP 2: CREATE OPTION GROUPS IN NEW CATEGORIES
-- ============================================================

INSERT INTO option_groups (id, service_category_id, slug, name, sort_order, is_active, selection_type)
SELECT gen_random_uuid(), sc.id, 'copy-print-items', 'Ксерокопия и печать', 1, true, 'multi'
FROM service_categories sc WHERE sc.slug = 'copy-print'
AND NOT EXISTS (SELECT 1 FROM option_groups og WHERE og.slug = 'copy-print-items' AND og.service_category_id = sc.id);

INSERT INTO option_groups (id, service_category_id, slug, name, sort_order, is_active, selection_type)
SELECT gen_random_uuid(), sc.id, 'photo-formats', 'Фотопечать', 1, true, 'multi'
FROM service_categories sc WHERE sc.slug = 'photo-print-format'
AND NOT EXISTS (SELECT 1 FROM option_groups og WHERE og.slug = 'photo-formats' AND og.service_category_id = sc.id);

INSERT INTO option_groups (id, service_category_id, slug, name, sort_order, is_active, selection_type)
SELECT gen_random_uuid(), sc.id, 'scan-misc-items', 'Сканирование и доп. услуги', 1, true, 'multi'
FROM service_categories sc WHERE sc.slug = 'scan-services'
AND NOT EXISTS (SELECT 1 FROM option_groups og WHERE og.slug = 'scan-misc-items' AND og.service_category_id = sc.id);

INSERT INTO option_groups (id, service_category_id, slug, name, sort_order, is_active, selection_type)
SELECT gen_random_uuid(), sc.id, 'retouch-items', 'Ретушь и обработка', 1, true, 'multi'
FROM service_categories sc WHERE sc.slug = 'retouch'
AND NOT EXISTS (SELECT 1 FROM option_groups og WHERE og.slug = 'retouch-items' AND og.service_category_id = sc.id);

INSERT INTO option_groups (id, service_category_id, slug, name, sort_order, is_active, selection_type)
SELECT gen_random_uuid(), sc.id, 'restoration-items', 'Реставрация фото', 1, true, 'multi'
FROM service_categories sc WHERE sc.slug = 'restoration'
AND NOT EXISTS (SELECT 1 FROM option_groups og WHERE og.slug = 'restoration-items' AND og.service_category_id = sc.id);

INSERT INTO option_groups (id, service_category_id, slug, name, sort_order, is_active, selection_type)
SELECT gen_random_uuid(), sc.id, 'frames-souvenirs-items', 'Рамки и сувениры', 1, true, 'multi'
FROM service_categories sc WHERE sc.slug = 'frames-souvenirs'
AND NOT EXISTS (SELECT 1 FROM option_groups og WHERE og.slug = 'frames-souvenirs-items' AND og.service_category_id = sc.id);

INSERT INTO option_groups (id, service_category_id, slug, name, sort_order, is_active, selection_type)
SELECT gen_random_uuid(), sc.id, 'polygraphy-items', 'Визитки и полиграфия', 1, true, 'multi'
FROM service_categories sc WHERE sc.slug = 'polygraphy'
AND NOT EXISTS (SELECT 1 FROM option_groups og WHERE og.slug = 'polygraphy-items' AND og.service_category_id = sc.id);

INSERT INTO option_groups (id, service_category_id, slug, name, sort_order, is_active, selection_type)
SELECT gen_random_uuid(), sc.id, 'design-text-items', 'Дизайн и тексты', 1, true, 'multi'
FROM service_categories sc WHERE sc.slug = 'design-text'
AND NOT EXISTS (SELECT 1 FROM option_groups og WHERE og.slug = 'design-text-items' AND og.service_category_id = sc.id);

INSERT INTO option_groups (id, service_category_id, slug, name, sort_order, is_active, selection_type)
SELECT gen_random_uuid(), sc.id, 'studio-special-items', 'Студийные и спец. услуги', 1, true, 'multi'
FROM service_categories sc WHERE sc.slug = 'studio-special'
AND NOT EXISTS (SELECT 1 FROM option_groups og WHERE og.slug = 'studio-special-items' AND og.service_category_id = sc.id);

-- ============================================================
-- STEP 3: DEACTIVATE DUPLICATES FIRST (before moving)
-- ============================================================

-- 3a. Online tariffs (not needed in POS)
UPDATE service_options SET is_active = false
WHERE slug IN ('basic', 'retouch', 'vip', 'vip-all-docs')
AND option_group_id IN (SELECT id FROM option_groups WHERE slug = 'processing-level');

-- 3b. Normal speed in photo-docs
UPDATE service_options SET is_active = false
WHERE slug = 'normal'
AND option_group_id IN (
  SELECT og.id FROM option_groups og
  JOIN service_categories sc ON sc.id = og.service_category_id
  WHERE og.slug = 'speed' AND sc.slug = 'photo-docs'
);

-- 3c. Urgent speed in photo-docs (online-only)
UPDATE service_options SET is_active = false
WHERE slug = 'urgent'
AND option_group_id IN (
  SELECT og.id FROM option_groups og
  JOIN service_categories sc ON sc.id = og.service_category_id
  WHERE og.slug = 'speed' AND sc.slug = 'photo-docs'
);

-- 3d. Extras in photo-docs (online-only)
UPDATE service_options SET is_active = false
WHERE slug IN ('uniform', 'beard-removal', 'all-docs-bundle', 'print-delivery', 'studio-retouch')
AND option_group_id IN (
  SELECT og.id FROM option_groups og
  JOIN service_categories sc ON sc.id = og.service_category_id
  WHERE og.slug = 'extras' AND sc.slug = 'photo-docs'
);

-- 3e. Document duplicates (have KM versions: km-фото-на-паспорт, km-фото-на-загран)
UPDATE service_options SET is_active = false
WHERE slug IN ('passport-rf', 'passport-zagran', 'photo-student')
AND option_group_id IN (SELECT id FROM option_groups WHERE slug = 'document-type');

-- 3f. KM studio generic duplicates
UPDATE service_options SET is_active = false
WHERE slug IN (
  'km-фото-на-документы-паспорт-загран-студ-и-тд',
  'km-фото-на-другие-документы'
);

-- 3g. Copy/print non-KM duplicates (KM versions exist)
UPDATE service_options SET is_active = false
WHERE slug IN (
  'copy-a4-bw', 'copy-a4-color', 'copy-a4-photo-color',
  'copy-a3-bw', 'copy-a3-color', 'copy-a3-photo-color',
  'print-a4-bw', 'print-a4-color', 'print-a3-bw',
  'print-a4-adhesive',
  'photo-doc-a4', 'photo-doc-a3-color', 'photo-doc-a3-bw'
);
-- print-a3-color stays active (no KM duplicate per task)
-- file-sleeve stays active (no KM duplicate)

-- 3h. Scan non-KM — NO KM versions exist for scan/lamination, so keep active!
-- scan-manual, scan-auto, lamination, cutting, cropping stay active

-- 3i. Photo print non-KM duplicates (KM versions exist)
UPDATE service_options SET is_active = false
WHERE slug IN (
  '10x15-premium', '10x15-super',
  '15x20-premium', '15x20-super',
  '20x30-premium', '20x30-super',
  '30x40', '40x50'
);
-- photo-a2 stays? Let me check — there IS km-а2-42-x-60-печать-фото.
-- But photo-a2 slug doesn't exist in current DB. Skip.

-- 3j. Frame non-KM duplicates (KM versions exist)
UPDATE service_options SET is_active = false
WHERE slug IN ('frame-a6', 'frame-a5', 'frame-a4', 'frame-a3');

-- 3k. Business card non-KM duplicates
UPDATE service_options SET is_active = false WHERE slug = 'cards-paper-100';
UPDATE service_options SET is_active = false WHERE slug = 'cards-plastic-50';
UPDATE service_options SET is_active = false WHERE slug = 'cards-samples-2';

-- 3l. Deactivate km-визитки-бумага-100-шт from km-print (keep the one in km-cards)
UPDATE service_options SET is_active = false
WHERE id = '4108b7d2-8f2e-492d-b5be-3dfe4c89c020';
-- This is the km-print version without the dot

-- 3m. Souvenir non-KM duplicates (KM versions exist)
UPDATE service_options SET is_active = false
WHERE slug IN (
  'mug-print', 'tshirt-print',
  'canvas-30x40', 'canvas-50x70', 'canvas-70x100'
);

-- 3n. Restoration non-KM duplicates (KM versions exist)
UPDATE service_options SET is_active = false
WHERE slug IN (
  'restore-simple', 'restore-medium', 'restore-complex',
  'restore-pro', 'restore-grav'
);

-- 3o. Souvenir category duplicates
-- polaroid in souvenirs (polaroid-reportage in misc is kept)
UPDATE service_options SET is_active = false
WHERE slug = 'polaroid'
AND option_group_id IN (SELECT id FROM option_groups WHERE slug = 'souvenir-type');

-- card-print in souvenirs stays active (moved to copy-print)
-- studio-retouch-* in souvenirs — they ARE the canonical retouch items (no KM retouch exists), keep active

-- 3p. Non-KM drawing duplicates (KM versions exist)
UPDATE service_options SET is_active = false
WHERE slug IN ('drawing-a4-bw', 'drawing-a4-color', 'drawing-a3-bw', 'drawing-a3-color');

-- 3q. Non-KM student duplicates (KM versions exist)
UPDATE service_options SET is_active = false
WHERE slug IN ('student-print-a4', 'student-photo-doc-a4');

-- 3r. portrait-business — KM version exists (km-портретное-фото)
UPDATE service_options SET is_active = false WHERE slug = 'portrait-business';

-- ============================================================
-- STEP 4: MOVE ITEMS TO NEW CATEGORIES/GROUPS
-- ============================================================

-- 4-pre. PHOTO-DOCS: move km-фото-на-паспорт and km-фото-на-загран from km-studio to document-type
UPDATE service_options so
SET option_group_id = og.id
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'document-type' AND sc.slug = 'photo-docs'
AND so.slug IN ('km-фото-на-паспорт', 'km-фото-на-загран');

-- 4a. COPY-PRINT: move KM print items
UPDATE service_options so
SET option_group_id = og_new.id
FROM option_groups og_new
WHERE og_new.slug = 'copy-print-items'
AND so.is_active = true
AND so.slug IN (
  'km-а4-ксерокопия', 'km-а4-ксерокопия-цветная', 'km-а4-ксерокопия-фото-цветная',
  'km-а3-ксерокопия', 'km-а3-ксерокопия-цветная', 'km-а3-ксерокопия-фото-цветная',
  'km-а4-печать-документа', 'km-а4-печать-документа-цветная', 'km-а3-печать-документа',
  'km-а4-фото-документ', 'km-а3-фото-документ-цвет', 'km-а3-чб-фото-документ',
  'km-а4-на-самоклеющейся-бумаге',
  'km-а4-печать-документа-студент', 'km-а4-фото-документ-студент',
  'km-а3-цв-печать-чертежей', 'km-а3-чб-печать-чертежей',
  'km-а4-цв-печать-чертежей', 'km-а4-чб-печать-чертежей'
);

-- Move non-KM active items to copy-print
UPDATE service_options so
SET option_group_id = og_new.id
FROM option_groups og_new
WHERE og_new.slug = 'copy-print-items'
AND so.is_active = true
AND so.slug IN ('print-a3-color', 'file-sleeve', 'card-print');

-- 4b. PHOTO-PRINT-FORMAT: move KM photo print items
UPDATE service_options so
SET option_group_id = og_new.id
FROM option_groups og_new
WHERE og_new.slug = 'photo-formats'
AND so.is_active = true
AND so.slug IN (
  'km-фото-10x15-премиум', 'km-фото-10x15-супер',
  'km-фото-15x20-премиум', 'km-фото-15x20-супер',
  'km-фото-20x30-премиум', 'km-фото-20x30-супер',
  'km-30x40-печать-фото', 'km-40x50-печать-фото',
  'km-а2-42-x-60-печать-фото'
);

-- 4c. SCAN-SERVICES: move scan/misc items
UPDATE service_options so
SET option_group_id = og_new.id
FROM option_groups og_new
WHERE og_new.slug = 'scan-misc-items'
AND so.is_active = true
AND so.slug IN (
  'scan-manual', 'scan-auto',
  'lamination', 'cutting', 'cropping',
  'disc-recording'
);

-- 4d. RETOUCH: move retouch items
UPDATE service_options so
SET option_group_id = og_new.id
FROM option_groups og_new
WHERE og_new.slug = 'retouch-items'
AND so.is_active = true
AND so.slug IN (
  'studio-retouch-basic', 'studio-retouch-pro', 'studio-retouch-premium',
  'portfolio-retouch', 'retouch-reportage'
);

-- 4e. RESTORATION: move KM restoration items
UPDATE service_options so
SET option_group_id = og_new.id
FROM option_groups og_new
WHERE og_new.slug = 'restoration-items'
AND so.is_active = true
AND so.slug IN (
  'km-реставрация-фото-простая', 'km-реставрация-фото-средняя',
  'km-реставрация-фото-сложная', 'km-реставрация-фото-профи',
  'km-реставрация-фото-под-гравировку'
);

-- 4f. FRAMES-SOUVENIRS: move KM frames + souvenirs
UPDATE service_options so
SET option_group_id = og_new.id
FROM option_groups og_new
WHERE og_new.slug = 'frames-souvenirs-items'
AND so.is_active = true
AND so.slug IN (
  'km-а6-фоторамка', 'km-а5-фоторамка', 'km-а4-фоторамка', 'km-а3-фоторамка',
  'km-печать-на-кружках',
  'km-печать-на-холсте-30x40', 'km-печать-на-холсте-50x70', 'km-печать-на-холсте-70x100'
);

-- Move Печать на футболке (no KM version — the non-KM one stays active)
-- Wait — tshirt-print was deactivated as having KM version. But there IS no KM tshirt!
-- Let me re-check: km-печать-на-кружках exists, but km-печать-на-футболке does NOT.
-- So tshirt-print should stay active. Re-activate it.
UPDATE service_options SET is_active = true WHERE slug = 'tshirt-print';
UPDATE service_options so
SET option_group_id = og_new.id
FROM option_groups og_new
WHERE og_new.slug = 'frames-souvenirs-items'
AND so.slug = 'tshirt-print';

-- 4g. POLYGRAPHY: move KM business cards (only from km-cards, the km-print one is deactivated)
UPDATE service_options so
SET option_group_id = og_new.id
FROM option_groups og_new
WHERE og_new.slug = 'polygraphy-items'
AND so.is_active = true
AND so.option_group_id IN (SELECT id FROM option_groups WHERE slug = 'km-cards')
AND so.slug IN (
  'km-визитки-бумага-100-шт',
  'km-визитки-образцы-2-шт',
  'km-визитки-пластик-50-шт'
);

-- 4h. DESIGN-TEXT: move design items
UPDATE service_options so
SET option_group_id = og_new.id
FROM option_groups og_new
WHERE og_new.slug = 'design-text-items'
AND so.is_active = true
AND so.slug IN (
  'design-card', 'design-flyer', 'design-booklet',
  'design-menu', 'design-pricelist',
  'text-set', 'text-edit', 'text-layout'
);

-- 4i. STUDIO-SPECIAL: move studio/misc items
UPDATE service_options so
SET option_group_id = og_new.id
FROM option_groups og_new
WHERE og_new.slug = 'studio-special-items'
AND so.is_active = true
AND so.slug IN (
  'km-портретное-фото-бизнес-резюме-реклама-и-тд',
  'immortal-regiment', 'memorial-photo',
  'custom-order', 'polaroid-reportage',
  'portrait-photo', 'event-photography'
);

-- ============================================================
-- STEP 5: DEACTIVATE OLD CATEGORIES
-- ============================================================

UPDATE service_categories SET sort_order = 100, is_active = false WHERE slug = 'neuro-photo';
UPDATE service_categories SET sort_order = 101, is_active = false WHERE slug = 'photo-restore';
UPDATE service_categories SET sort_order = 102, is_active = false WHERE slug = 'event-photo';
UPDATE service_categories SET sort_order = 103, is_active = false WHERE slug = 'voennaya-retush';
UPDATE service_categories SET sort_order = 104, is_active = false WHERE slug = 'portfolio';
UPDATE service_categories SET sort_order = 105, is_active = false WHERE slug = 'photo-print';
UPDATE service_categories SET sort_order = 106, is_active = false WHERE slug = 'drawings';
UPDATE service_categories SET sort_order = 107, is_active = false WHERE slug = 'students';
UPDATE service_categories SET sort_order = 108, is_active = false WHERE slug = 'scan-copy';
UPDATE service_categories SET sort_order = 109, is_active = false WHERE slug = 'marketplace-photo';
UPDATE service_categories SET sort_order = 110, is_active = false WHERE slug = 'infographics';
UPDATE service_categories SET sort_order = 111, is_active = false WHERE slug = 'smm-content';
UPDATE service_categories SET sort_order = 112, is_active = false WHERE slug = 'selling-pack';
UPDATE service_categories SET sort_order = 113, is_active = false WHERE slug = 'misc-services';
UPDATE service_categories SET sort_order = 114, is_active = false WHERE slug = 'souvenirs';
UPDATE service_categories SET sort_order = 115, is_active = false WHERE slug = 'design';

-- ============================================================
-- STEP 6: SORT ORDER FOR OPTIONS WITHIN CATEGORIES
-- ============================================================

-- photo-docs (document-type group): by frequency
UPDATE service_options SET sort_order = 1  WHERE slug = 'km-фото-на-паспорт';
UPDATE service_options SET sort_order = 2  WHERE slug = 'km-фото-на-загран';
UPDATE service_options SET sort_order = 3  WHERE slug = 'photo-visa';
UPDATE service_options SET sort_order = 4  WHERE slug = 'photo-license';
UPDATE service_options SET sort_order = 5  WHERE slug = 'photo-medbook';
UPDATE service_options SET sort_order = 6  WHERE slug = 'photo-pass';
UPDATE service_options SET sort_order = 7  WHERE slug = 'photo-military';
UPDATE service_options SET sort_order = 8  WHERE slug = 'photo-greencard';
UPDATE service_options SET sort_order = 9  WHERE slug = 'urgent-photo-docs';

-- copy-print: A4 before A3, cheap before expensive
UPDATE service_options SET sort_order = 1  WHERE slug = 'km-а4-ксерокопия';
UPDATE service_options SET sort_order = 2  WHERE slug = 'km-а4-ксерокопия-цветная';
UPDATE service_options SET sort_order = 3  WHERE slug = 'km-а4-ксерокопия-фото-цветная';
UPDATE service_options SET sort_order = 4  WHERE slug = 'km-а3-ксерокопия';
UPDATE service_options SET sort_order = 5  WHERE slug = 'km-а3-ксерокопия-цветная';
UPDATE service_options SET sort_order = 6  WHERE slug = 'km-а3-ксерокопия-фото-цветная';
UPDATE service_options SET sort_order = 7  WHERE slug = 'km-а4-печать-документа';
UPDATE service_options SET sort_order = 8  WHERE slug = 'km-а4-печать-документа-цветная';
UPDATE service_options SET sort_order = 9  WHERE slug = 'km-а3-печать-документа';
UPDATE service_options SET sort_order = 10 WHERE slug = 'km-а4-фото-документ';
UPDATE service_options SET sort_order = 11 WHERE slug = 'km-а3-чб-фото-документ';
UPDATE service_options SET sort_order = 12 WHERE slug = 'km-а3-фото-документ-цвет';
UPDATE service_options SET sort_order = 13 WHERE slug = 'km-а4-на-самоклеющейся-бумаге';
UPDATE service_options SET sort_order = 14 WHERE slug = 'km-а4-печать-документа-студент';
UPDATE service_options SET sort_order = 15 WHERE slug = 'km-а4-фото-документ-студент';
UPDATE service_options SET sort_order = 16 WHERE slug = 'km-а4-чб-печать-чертежей';
UPDATE service_options SET sort_order = 17 WHERE slug = 'km-а4-цв-печать-чертежей';
UPDATE service_options SET sort_order = 18 WHERE slug = 'km-а3-чб-печать-чертежей';
UPDATE service_options SET sort_order = 19 WHERE slug = 'km-а3-цв-печать-чертежей';
UPDATE service_options SET sort_order = 20 WHERE slug = 'card-print';
UPDATE service_options SET sort_order = 21 WHERE slug = 'print-a3-color';
UPDATE service_options SET sort_order = 22 WHERE slug = 'file-sleeve';

-- photo-print-format: cheap to expensive
UPDATE service_options SET sort_order = 1 WHERE slug = 'km-фото-10x15-премиум';
UPDATE service_options SET sort_order = 2 WHERE slug = 'km-фото-10x15-супер';
UPDATE service_options SET sort_order = 3 WHERE slug = 'km-фото-15x20-премиум';
UPDATE service_options SET sort_order = 4 WHERE slug = 'km-фото-15x20-супер';
UPDATE service_options SET sort_order = 5 WHERE slug = 'km-фото-20x30-премиум';
UPDATE service_options SET sort_order = 6 WHERE slug = 'km-фото-20x30-супер';
UPDATE service_options SET sort_order = 7 WHERE slug = 'km-30x40-печать-фото';
UPDATE service_options SET sort_order = 8 WHERE slug = 'km-40x50-печать-фото';
UPDATE service_options SET sort_order = 9 WHERE slug = 'km-а2-42-x-60-печать-фото';

-- scan-services: by price
UPDATE service_options SET sort_order = 1 WHERE slug = 'scan-auto';
UPDATE service_options SET sort_order = 2 WHERE slug = 'cutting';
UPDATE service_options SET sort_order = 3 WHERE slug = 'cropping';
UPDATE service_options SET sort_order = 4 WHERE slug = 'scan-manual';
UPDATE service_options SET sort_order = 5 WHERE slug = 'lamination';
UPDATE service_options SET sort_order = 6 WHERE slug = 'disc-recording';

-- retouch: by price
UPDATE service_options SET sort_order = 1 WHERE slug = 'portfolio-retouch';
UPDATE service_options SET sort_order = 2 WHERE slug = 'retouch-reportage';
UPDATE service_options SET sort_order = 3 WHERE slug = 'studio-retouch-basic';
UPDATE service_options SET sort_order = 4 WHERE slug = 'studio-retouch-pro';
UPDATE service_options SET sort_order = 5 WHERE slug = 'studio-retouch-premium';

-- restoration: by price
UPDATE service_options SET sort_order = 1 WHERE slug = 'km-реставрация-фото-простая';
UPDATE service_options SET sort_order = 2 WHERE slug = 'km-реставрация-фото-средняя';
UPDATE service_options SET sort_order = 3 WHERE slug = 'km-реставрация-фото-под-гравировку';
UPDATE service_options SET sort_order = 4 WHERE slug = 'km-реставрация-фото-сложная';
UPDATE service_options SET sort_order = 5 WHERE slug = 'km-реставрация-фото-профи';

-- frames-souvenirs: frames first (A6→A3), then souvenirs by price
UPDATE service_options SET sort_order = 1 WHERE slug = 'km-а6-фоторамка';
UPDATE service_options SET sort_order = 2 WHERE slug = 'km-а5-фоторамка';
UPDATE service_options SET sort_order = 3 WHERE slug = 'km-а4-фоторамка';
UPDATE service_options SET sort_order = 4 WHERE slug = 'km-а3-фоторамка';
UPDATE service_options SET sort_order = 5 WHERE slug = 'km-печать-на-кружках';
UPDATE service_options SET sort_order = 6 WHERE slug = 'tshirt-print';
UPDATE service_options SET sort_order = 7 WHERE slug = 'km-печать-на-холсте-30x40';
UPDATE service_options SET sort_order = 8 WHERE slug = 'km-печать-на-холсте-50x70';
UPDATE service_options SET sort_order = 9 WHERE slug = 'km-печать-на-холсте-70x100';

-- polygraphy: by price
UPDATE service_options so SET sort_order = 1
FROM option_groups og
WHERE so.option_group_id = og.id AND og.slug = 'polygraphy-items'
AND so.slug = 'km-визитки-образцы-2-шт';

UPDATE service_options so SET sort_order = 2
FROM option_groups og
WHERE so.option_group_id = og.id AND og.slug = 'polygraphy-items'
AND so.slug = 'km-визитки-бумага-100-шт';

UPDATE service_options so SET sort_order = 3
FROM option_groups og
WHERE so.option_group_id = og.id AND og.slug = 'polygraphy-items'
AND so.slug = 'km-визитки-пластик-50-шт';

-- design-text: texts cheap first, then designs by price
UPDATE service_options SET sort_order = 1 WHERE slug = 'text-layout';
UPDATE service_options SET sort_order = 2 WHERE slug = 'text-edit';
UPDATE service_options SET sort_order = 3 WHERE slug = 'text-set';
UPDATE service_options SET sort_order = 4 WHERE slug = 'design-card';
UPDATE service_options SET sort_order = 5 WHERE slug = 'design-flyer';
UPDATE service_options SET sort_order = 6 WHERE slug = 'design-pricelist';
UPDATE service_options SET sort_order = 7 WHERE slug = 'design-booklet';
UPDATE service_options SET sort_order = 8 WHERE slug = 'design-menu';

-- studio-special: by price
UPDATE service_options SET sort_order = 1 WHERE slug = 'polaroid-reportage';
UPDATE service_options SET sort_order = 2 WHERE slug = 'portrait-photo';
UPDATE service_options SET sort_order = 3 WHERE slug = 'custom-order';
UPDATE service_options SET sort_order = 4 WHERE slug = 'immortal-regiment';
UPDATE service_options SET sort_order = 5 WHERE slug = 'km-портретное-фото-бизнес-резюме-реклама-и-тд';
UPDATE service_options SET sort_order = 6 WHERE slug = 'memorial-photo';
UPDATE service_options SET sort_order = 7 WHERE slug = 'event-photography';

-- ============================================================
-- STEP 7: POPULAR FLAGS (TOP-10)
-- ============================================================

UPDATE service_options SET popular = false WHERE popular = true;

UPDATE service_options SET popular = true WHERE slug = 'km-а4-ксерокопия';
UPDATE service_options SET popular = true WHERE slug = 'km-а4-печать-документа';
UPDATE service_options SET popular = true WHERE slug = 'km-фото-на-паспорт';
UPDATE service_options SET popular = true WHERE slug = 'km-фото-на-загран';
UPDATE service_options SET popular = true WHERE slug = 'scan-auto';
UPDATE service_options SET popular = true WHERE slug = 'lamination';
UPDATE service_options SET popular = true WHERE slug = 'studio-retouch-basic';
UPDATE service_options SET popular = true WHERE slug = 'km-фото-10x15-премиум';
UPDATE service_options SET popular = true WHERE slug = 'km-а4-ксерокопия-цветная';
UPDATE service_options SET popular = true WHERE slug = 'scan-manual';

-- ============================================================
-- STEP 8: DEACTIVATE EMPTY OLD GROUPS
-- ============================================================

-- Deactivate option_groups belonging to deactivated categories
UPDATE option_groups og SET is_active = false
FROM service_categories sc
WHERE og.service_category_id = sc.id AND sc.is_active = false;

-- Deactivate KM groups (items moved)
UPDATE option_groups SET is_active = false WHERE slug IN (
  'km-print', 'km-frames', 'km-cards', 'km-souvenirs', 'km-studio', 'km-drawings', 'km-students'
);

-- Deactivate online-only groups in photo-docs
UPDATE option_groups SET is_active = false
WHERE slug IN ('processing-level', 'speed', 'extras')
AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs');

-- Deactivate old groups whose items have been moved
UPDATE option_groups SET is_active = false WHERE slug IN (
  'scan-copy-type', 'photo-format', 'photo-extras',
  'souvenir-type', 'design-type',
  'drawing-type', 'student-service', 'misc-type',
  'event-type', 'complexity', 'portfolio-type'
);

COMMIT;
