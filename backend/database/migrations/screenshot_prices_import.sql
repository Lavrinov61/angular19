-- Screenshot-based price import (2026-03-09)
-- Replaces garbage regex-extracted data with clean manually-verified prices from competitor screenshots.
-- Source: /конкуренты/скрины сайтов/ (SkyPrint, ТриНаЧетыре, ЯркийФотомаркет)
-- Idempotent: uses ON CONFLICT (competitor_id, service_name) DO UPDATE

BEGIN;

-- ============================================================
-- 1. Clean up garbage from regex markdown import
-- ============================================================

-- Delete entries where service_name is clearly garbage (numbers, table fragments, comparison notes)
DELETE FROM kb_competitor_prices
WHERE competitor_id IN (
    SELECT id FROM kb_entities WHERE slug IN ('competitor-skyprint', 'competitor-yarkiy', 'competitor-trinachetyre')
)
AND (
    -- Pure numbers like "108 ₽", "580 ₽"
    service_name ~ '^\d[\d\s]*₽?$'
    -- Table cell fragments starting with |
    OR service_name LIKE '|%'
    -- Comparison notes from markdown
    OR service_name LIKE '%они %₽%мы%'
    OR service_name LIKE '%Нет у них%'
    OR service_name LIKE '%Вывод:%'
    -- Markdown bold fragments
    OR service_name LIKE '**%'
    -- Truncated descriptions with prices embedded
    OR service_name ~ '^\d[\d\s]*(₽|руб)'
    -- Entries that are just "А3 240 эл.: 1 200" style
    OR service_name ~ '^А[345]\s+\d+\s+эл'
    -- Entries that look like concatenated table rows
    OR service_name ~ ':\s*\d[\d\s]+$' AND length(service_name) > 40
    -- Яркий garbage: aggregated descriptions
    OR service_name LIKE 'Плакаты: мат%'
    OR service_name LIKE 'Фотокниги:%'
    OR service_name LIKE 'Фотопланшет:%'
    OR service_name LIKE 'Футболки:%'
    OR service_name LIKE 'Штендеры%'
    OR service_name LIKE 'Пенокартон:%'
    OR service_name LIKE 'Визитки: от%'
    OR service_name LIKE 'Печать фотографий:%'
    OR service_name LIKE 'Холст:%'
    OR service_name LIKE 'A4, срок%'
    OR service_name LIKE 'Проявка плёнки:%'
    OR service_name LIKE 'Печать с плёнки:%'
    -- SkyPrint: Сердце concatenated
    OR service_name LIKE 'Сердце 15×20, А5%'
    -- SkyPrint: Макет визитки mis-categorized as photo_documents
    OR (service_name LIKE 'Макет визитки%' AND service_category = 'photo_documents')
    -- SkyPrint: "Макет листовки..." with embedded prices
    OR service_name LIKE 'Макет листовки/флаера/буклета: 500%'
    OR service_name LIKE 'Редактирование в Photoshop и т.п.: 50%'
);

-- ============================================================
-- 2. SkyPrint — clean prices from prайс-листы (screenshots)
-- ============================================================

-- Helper: get competitor_id
DO $$
DECLARE
    v_skyprint_id uuid;
    v_yarkiy_id uuid;
    v_tri_id uuid;
BEGIN
    SELECT id INTO v_skyprint_id FROM kb_entities WHERE slug = 'competitor-skyprint';
    SELECT id INTO v_yarkiy_id FROM kb_entities WHERE slug = 'competitor-yarkiy';
    SELECT id INTO v_tri_id FROM kb_entities WHERE slug = 'competitor-trinachetyre';

    -- ── SkyPrint: Фото на документы ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_skyprint_id, 'Срочное фото на документы', 'photo_documents', 450, '450 руб.', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Фото на документы без печати', 'photo_documents', 400, '400 руб.', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Повторная печать документов', 'photo_documents', 150, '150 руб.', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Подстановка костюма/формы', 'photo_documents', 150, '150 руб.', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Фото в полный рост', 'photo_documents', 450, '450 руб.', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Печать с готового фото клиента', 'photo_documents', 150, '150 руб.', 'screenshot_import', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── SkyPrint: Фотопечать (мат/глянец) ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_skyprint_id, 'Фотопечать 9x13 срочная', 'print', 30, '30 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Фотопечать 9x13 лаборатория', 'print', 25, '25 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Фотопечать 10x15 срочная', 'print', 30, '30 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Фотопечать 10x15 лаборатория', 'print', 25, '25 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Фотопечать 13x18 срочная', 'print', 60, '60 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Фотопечать 13x18 лаборатория', 'print', 50, '50 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Фотопечать 15x21 срочная', 'print', 60, '60 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Фотопечать 15x21 лаборатория', 'print', 50, '50 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Фотопечать 21x30 срочная', 'print', 120, '120 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Фотопечать 21x30 лаборатория', 'print', 100, '100 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Фотопечать 30x40', 'print', 300, '300 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Фотопечать Полароид срочная', 'print', 40, '40 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Фотопечать Полароид лаборатория', 'print', 35, '35 ₽', 'screenshot_import', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── SkyPrint: Цветная печать ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_skyprint_id, 'Цветная печать A4 80г', 'copy', 30, '30 ₽', 'screenshot_import, 1-49шт', true, NOW()),
        (v_skyprint_id, 'Цветная печать A4 120г', 'copy', 40, '40 ₽', 'screenshot_import, 1-49шт', true, NOW()),
        (v_skyprint_id, 'Цветная печать A4 200-300г', 'copy', 40, '40 ₽', 'screenshot_import, 1-49шт', true, NOW()),
        (v_skyprint_id, 'Цветная печать A3 80г', 'copy', 60, '60 ₽', 'screenshot_import, 1-49шт', true, NOW()),
        (v_skyprint_id, 'Цветная печать A3 120г', 'copy', 80, '80 ₽', 'screenshot_import, 1-49шт', true, NOW()),
        (v_skyprint_id, 'Цветная печать A3 200-300г', 'copy', 80, '80 ₽', 'screenshot_import, 1-49шт', true, NOW()),
        (v_skyprint_id, 'Печать на дизайнерской бумаге A4 300г', 'copy', 100, '100 ₽', 'screenshot_import, 1-49шт', true, NOW()),
        (v_skyprint_id, 'Печать на дизайнерской бумаге A4 2стороны', 'copy', 150, '150 ₽', 'screenshot_import, 1-49шт', true, NOW()),
        (v_skyprint_id, 'Печать на самоклейке A4 полуглянец', 'copy', 80, '80 ₽', 'screenshot_import, 1-20шт', true, NOW()),
        (v_skyprint_id, 'Печать на самоклейке A3 полуглянец', 'copy', 160, '160 ₽', 'screenshot_import, 1-20шт', true, NOW()),
        (v_skyprint_id, 'Печать на самоклейке A4 прозрачная', 'copy', 200, '200 ₽', 'screenshot_import, 1-20шт', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── SkyPrint: Сканирование ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_skyprint_id, 'Сканирование A4', 'copy', 20, '20 ₽', 'screenshot_import, 1-20шт', true, NOW()),
        (v_skyprint_id, 'Сканирование A3', 'copy', 40, '40 ₽', 'screenshot_import, 1-20шт', true, NOW()),
        (v_skyprint_id, 'Фото сканер до A3', 'copy', 50, '50 ₽', 'screenshot_import, 1-20шт', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── SkyPrint: Ламинирование ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_skyprint_id, 'Ламинирование A5 125г', 'copy', 70, '70 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Ламинирование A4 125г', 'copy', 100, '100 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Ламинирование A3 125г', 'copy', 200, '200 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Ламинирование A4 250г', 'copy', 300, '300 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Ламинирование A3 250г', 'copy', 600, '600 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Ламинирование широкоформатное 1 сторона', 'copy', 1000, '1000 ₽/м²', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Ламинирование широкоформатное 2 стороны', 'copy', 2000, '2000 ₽/м²', 'screenshot_import', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── SkyPrint: Переплёт ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_skyprint_id, 'Переплёт пластиковый от 10л', 'copy', 200, '200 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Переплёт пластиковый от 100л', 'copy', 250, '250 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Переплёт пластиковый от 200л', 'copy', 300, '300 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Переплёт пластиковый от 300л', 'copy', 350, '350 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Переплёт пружинный металлический', 'copy', 300, '300 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Переплёт твёрдый', 'copy', 500, '500 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Перешивка твёрдого переплёта', 'copy', 200, '200 ₽', 'screenshot_import, 1-10шт', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── SkyPrint: Визитки, флаеры, листовки ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_skyprint_id, 'Визитки стандарт 4+0 (100шт)', 'polygraphy', 12, '12 ₽/шт', 'screenshot_import, мелов. картон 300г', true, NOW()),
        (v_skyprint_id, 'Визитки стандарт 4+4 (100шт)', 'polygraphy', 14, '14 ₽/шт', 'screenshot_import, мелов. картон 300г', true, NOW()),
        (v_skyprint_id, 'Визитки с ламинацией 4+0 (100шт)', 'polygraphy', 20, '20 ₽/шт', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Визитки с ламинацией 4+4 (100шт)', 'polygraphy', 22, '22 ₽/шт', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Визитки дизайнерская бумага 4+0 (50шт)', 'polygraphy', 28, '28 ₽/шт', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Визитки дизайнерская бумага 4+4 (50шт)', 'polygraphy', 30, '30 ₽/шт', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Флаер A4 срочно глянец 120г (500шт)', 'polygraphy', 18, '18 ₽/шт', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Флаер A5 срочно глянец 120г (500шт)', 'polygraphy', 9, '9 ₽/шт', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Флаер A6 срочно глянец 120г (500шт)', 'polygraphy', 5, '4,50 ₽/шт', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Флаер A7 срочно глянец 120г (500шт)', 'polygraphy', 2, '2,30 ₽/шт', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Еврофлаер срочно глянец 120г (500шт)', 'polygraphy', 8, '8 ₽/шт', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Листовки A4 глянец 130г (1000шт)', 'polygraphy', 11, '10,64 ₽/шт', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Листовки A5 глянец 130г (1000шт)', 'polygraphy', 6, '5,50 ₽/шт', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Этикетки макет + первая печать', 'polygraphy', 500, '500 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Этикетки следующая печать', 'polygraphy', 150, '150 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Сетка календаря', 'polygraphy', 150, 'от 150 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Макет календаря (1 лист)', 'polygraphy', 100, '100-150 ₽', 'screenshot_import', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── SkyPrint: Широкоформатная печать ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_skyprint_id, 'Баннер 440г/м² 720dpi', 'print_large', 450, 'от 450 ₽/м²', 'screenshot_import, от 10м²', true, NOW()),
        (v_skyprint_id, 'Баннер 440г/м² 1440dpi', 'print_large', 500, 'от 500 ₽/м²', 'screenshot_import, от 10м²', true, NOW()),
        (v_skyprint_id, 'Плёнка самоклеящаяся матовая/глянцевая', 'print_large', 500, 'от 500 ₽/м²', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Печать на холсте полимерный', 'print_large', 2600, 'от 2600 ₽/м²', 'screenshot_import, от 10м²', true, NOW()),
        (v_skyprint_id, 'Печать на холсте натуральный', 'print_large', 3600, 'от 3600 ₽/м²', 'screenshot_import, от 10м²', true, NOW()),
        (v_skyprint_id, 'Печать на фотобумаге широкоформат', 'print_large', 1500, 'от 1500 ₽/м²', 'screenshot_import, от 10м²', true, NOW()),
        (v_skyprint_id, 'Печать на плотной бумаге широкоформат', 'print_large', 1100, 'от 1100 ₽/м²', 'screenshot_import, от 10м²', true, NOW()),
        (v_skyprint_id, 'Печать на простой бумаге широкоформат', 'print_large', 700, 'от 700 ₽/м²', 'screenshot_import, от 10м²', true, NOW()),
        (v_skyprint_id, 'Печать на кальке широкоформат', 'print_large', 1000, 'от 1000 ₽/м²', 'screenshot_import, от 10м²', true, NOW()),
        (v_skyprint_id, 'Печать на гофрокартоне', 'print_large', 1200, 'от 1200 ₽/м²', 'screenshot_import, от 10м²', true, NOW()),
        (v_skyprint_id, 'Печать на пенакартоне', 'print_large', 2800, 'от 2800 ₽/м²', 'screenshot_import, от 10м²', true, NOW()),
        (v_skyprint_id, 'Печать на ПВХ 5мм + плёнка', 'print_large', 2800, 'от 2800 ₽/м²', 'screenshot_import, от 10м²', true, NOW()),
        (v_skyprint_id, 'Люверсы для баннера', 'print_large', 15, '15 ₽/шт', 'screenshot_import', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── SkyPrint: Сувениры — кружки ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_skyprint_id, 'Кружка белая 330мл', 'souvenirs', 400, '400 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Кружка цветная ручка и внутри 330мл', 'souvenirs', 500, '500 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Кружка цветная ручка и каёмка 330мл', 'souvenirs', 500, '500 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Кружка хамелеон 330мл', 'souvenirs', 750, '750 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Кружка с ложкой 330мл', 'souvenirs', 750, '750 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Кружка с мячиком 330мл', 'souvenirs', 750, '750 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Кружка большая белая 425мл', 'souvenirs', 700, '700 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Кружка металл белая 330мл премиум', 'souvenirs', 900, '900 ₽', 'screenshot_import, 1-10шт', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── SkyPrint: Сувениры — часы ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_skyprint_id, 'Фото на часах 15x25', 'souvenirs', 1150, '1150 ₽', 'screenshot_import, 1-3шт', true, NOW()),
        (v_skyprint_id, 'Фото на часах 20x40', 'souvenirs', 1850, '1850 ₽', 'screenshot_import, 1-3шт', true, NOW()),
        (v_skyprint_id, 'Фото на часах 30x40', 'souvenirs', 2300, '2300 ₽', 'screenshot_import, 1-3шт', true, NOW()),
        (v_skyprint_id, 'Фото на часах 40x50', 'souvenirs', 2500, '2500 ₽', 'screenshot_import, 1-3шт', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── SkyPrint: Сувениры — подушки ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_skyprint_id, 'Подушка атласная 40x40', 'souvenirs', 900, '900 ₽', 'screenshot_import, 1-3шт', true, NOW()),
        (v_skyprint_id, 'Подушка плюшевая 40x40', 'souvenirs', 950, '950 ₽', 'screenshot_import, 1-3шт', true, NOW()),
        (v_skyprint_id, 'Подушка сердце 40x40', 'souvenirs', 950, '950 ₽', 'screenshot_import, 1-3шт', true, NOW()),
        (v_skyprint_id, 'Наволочка с пайетками 40x40', 'souvenirs', 1500, '1500 ₽', 'screenshot_import, 1-3шт', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── SkyPrint: Сувениры — пазлы ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_skyprint_id, 'Пазл сердце 15x20 картон', 'souvenirs', 500, '500 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Пазл A5 15x20 60эл картон', 'souvenirs', 500, '500 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Пазл A4 21x30 120эл картон', 'souvenirs', 500, '500 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Пазл A3 30x40 240эл картон', 'souvenirs', 1200, '1200 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Пазл сердце 15x20 магнитный', 'souvenirs', 500, '500 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Пазл A5 15x20 60эл магнитный', 'souvenirs', 500, '500 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Пазл A4 21x30 120эл магнитный', 'souvenirs', 500, '500 ₽', 'screenshot_import, 1-10шт', true, NOW()),
        (v_skyprint_id, 'Пазл A3 30x40 240эл магнитный', 'souvenirs', 1400, '1400 ₽', 'screenshot_import, 1-10шт', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── SkyPrint: Дизайнерская работа / ретушь ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_skyprint_id, 'Работа дизайнера с клиентом', 'retouch', 500, '500 ₽/час', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Замена фона (1 человек)', 'retouch', 300, '300 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Оцветнение (ч/б → цвет)', 'retouch', 300, 'от 300 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Коллаж', 'retouch', 30, '30 ₽/фото + 200 ₽ работа', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Приглашение', 'retouch', 300, 'от 300 ₽ 2стороны +50%', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Открытка', 'retouch', 300, 'от 300 ₽ 2стороны +50%', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Грамота/диплом', 'retouch', 150, 'от 150 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Редактирование сертификата', 'retouch', 80, 'ФИО+печать 80 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Макет визитки', 'retouch', 300, '300-500 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Макет листовки/буклета', 'retouch', 500, '500-1000 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Макет широкоформатной рекламы', 'retouch', 300, '300-500 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Редактирование в Photoshop', 'retouch', 50, '50-300 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Разработка логотипа', 'retouch', 2000, 'от 2000 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Отрисовка логотипа', 'retouch', 1000, 'от 1000 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Реставрация фото', 'restoration', 300, 'от 300 ₽', 'screenshot_import', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── SkyPrint: Другие услуги ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_skyprint_id, 'Оцифровка фото с фотоплёнки', 'other', 20, '20 ₽/кадр', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Оцифровка видеокассет', 'other', 400, '1 час / 400 ₽, далее 7 ₽/мин', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Запись на диск CD', 'other', 50, '50 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Диск DVD-R / CD-R', 'other', 100, '100 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Запись на носитель более 10 MB', 'other', 50, '50 ₽', 'screenshot_import', true, NOW()),
        (v_skyprint_id, 'Разработка макета от 500 руб', 'polygraphy', 500, 'от 500 ₽', 'screenshot_import, листовки-флаера', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ============================================================
    -- 3. Яркий Фотомаркет — clean prices from calculator screenshots
    -- ============================================================

    -- ── Яркий: Фотопечать ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Фотопечать 10x15', 'print', 36, '36 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Фотопечать 11x15', 'print', 36, '36 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Фотопечать 15x20', 'print', 70, '70 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Фотопечать 20x30', 'print', 140, '140 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Фотопечать 30x40', 'print', 240, '240 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Фотопечать 30x45', 'print', 240, '240 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Фотопечать 30x90', 'print', 400, '400 ₽', 'screenshot_import, калькулятор', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Плакаты и постеры (мат 180г) ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Плакат/постер 30x40 мат', 'print_large', 504, '504 ₽', 'screenshot_import, калькулятор, мат 180г', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 30x45 мат', 'print_large', 567, '567 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 40x50 мат', 'print_large', 840, '840 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 45x60 мат', 'print_large', 1008, '1 008 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 40x60 мат', 'print_large', 1050, '1 050 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 50x70 мат', 'print_large', 1470, '1 470 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 60x90 мат', 'print_large', 2268, '2 268 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 70x100 мат', 'print_large', 2940, '2 940 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 100x100 мат', 'print_large', 6300, '6 300 ₽', 'screenshot_import, калькулятор', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Плакаты сулен (300г) ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Плакат/постер 30x40 сулен', 'print_large', 558, '558 ₽', 'screenshot_import, калькулятор, сулен 300г', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 30x45 сулен', 'print_large', 744, '744 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 40x50 сулен', 'print_large', 837, '837 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 40x60 сулен', 'print_large', 992, '992 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 45x60 сулен', 'print_large', 1240, '1 240 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 50x70 сулен', 'print_large', 1488, '1 488 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 55x70 сулен', 'print_large', 1550, '1 550 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 55x75 сулен', 'print_large', 1860, '1 860 ₽', 'screenshot_import, калькулятор', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Плакаты мат — доп. форматы ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Плакат/постер 35x45 мат', 'print_large', 630, '630 ₽', 'screenshot_import, калькулятор, мат 180г', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 50x50 мат', 'print_large', 1260, '1 260 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 55x70 мат', 'print_large', 1512, '1 512 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 55x75 мат', 'print_large', 1638, '1 638 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 63x90 мат', 'print_large', 2170, '2 170 ₽', 'screenshot_import, калькулятор', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Плакаты сулен — доп. форматы ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Плакат/постер 35x45 сулен', 'print_large', 698, '698 ₽', 'screenshot_import, калькулятор, сулен 300г', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 50x50 сулен', 'print_large', 1395, '1 395 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 60x90 сулен', 'print_large', 2232, '2 232 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 63x90 сулен', 'print_large', 2418, '2 418 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 70x100 сулен', 'print_large', 2940, '2 940 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Плакат/постер 100x100 сулен', 'print_large', 6510, '6 510 ₽', 'screenshot_import, калькулятор', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Фото на документы ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Фото на документы', 'photo_documents', 590, '590 ₽', 'screenshot_import, срок 24ч, самовывоз', true, NOW()),
        (v_yarkiy_id, 'Фото на документы — подбор костюма', 'photo_documents', 350, '350 ₽', 'screenshot_import, допуслуга', true, NOW()),
        (v_yarkiy_id, 'Фото на документы — создание с любого носителя', 'photo_documents', 250, '250 ₽', 'screenshot_import, допуслуга', true, NOW()),
        (v_yarkiy_id, 'Фото на документы — допечатка комплекта', 'photo_documents', 100, '100 ₽', 'screenshot_import, допуслуга', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Печать на пенокартоне ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Пенокартон 30x40', 'print_large', 1200, '1 200 ₽', 'screenshot_import, калькулятор, 5мм, срок 3 дня', true, NOW()),
        (v_yarkiy_id, 'Пенокартон 40x50', 'print_large', 1600, '1 600 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Пенокартон 40x60', 'print_large', 1920, '1 920 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Пенокартон 50x70', 'print_large', 2800, '2 800 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Пенокартон 60x90', 'print_large', 4320, '4 320 ₽', 'screenshot_import, калькулятор', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Фото на холсте ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Холст 30x40 на подрамнике', 'print_large', 2000, '2 000 ₽', 'screenshot_import, калькулятор, срок 3 дня', true, NOW()),
        (v_yarkiy_id, 'Холст 40x50 на подрамнике', 'print_large', 2700, '2 700 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Холст 40x60 на подрамнике', 'print_large', 3200, '3 200 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Холст 50x70 на подрамнике', 'print_large', 4500, '4 500 ₽', 'screenshot_import, калькулятор', true, NOW()),
        (v_yarkiy_id, 'Холст 60x90 на подрамнике', 'print_large', 6500, '6 500 ₽', 'screenshot_import, калькулятор', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Фотокниги ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Фотокнига Royal твёрдая 20x20', 'photobook', 2450, '2 450 ₽', 'screenshot_import, 20 стр, срок 10 дней', true, NOW()),
        (v_yarkiy_id, 'Фотокнига Стандарт твёрдая 20x20', 'photobook', 2200, '2 200 ₽', 'screenshot_import, 20 стр, срок 10 дней', true, NOW()),
        (v_yarkiy_id, 'Фотокнига Royal мягкая 20x20', 'photobook', 1010, '1 010 ₽', 'screenshot_import, 20 стр, срок 10 дней', true, NOW()),
        (v_yarkiy_id, 'Фотокнига Премиум дерево 20x20', 'photobook', 4200, '4 200 ₽', 'screenshot_import, деревянная обложка, срок 10 дней', true, NOW()),
        (v_yarkiy_id, 'Фотокнига Royal твёрдая 30x30', 'photobook', 3200, '3 200 ₽', 'screenshot_import, 20 стр', true, NOW()),
        (v_yarkiy_id, 'Фотокнига Стандарт твёрдая 30x30', 'photobook', 2800, '2 800 ₽', 'screenshot_import, 20 стр', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Фотопланшет ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Фотопланшет Стандарт', 'photobook', 1050, '1 050 ₽', 'screenshot_import, срок 10 дней', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Футболки ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Футболка прямая печать женская', 'souvenirs', 1300, '1 300 ₽', 'screenshot_import, срок 24ч', true, NOW()),
        (v_yarkiy_id, 'Футболка прямая печать мужская', 'souvenirs', 1500, '1 500 ₽', 'screenshot_import, срок 24ч', true, NOW()),
        (v_yarkiy_id, 'Футболка прямая печать детская', 'souvenirs', 1500, '1 500 ₽', 'screenshot_import, срок 24ч', true, NOW()),
        (v_yarkiy_id, 'Футболка сублимация женская', 'souvenirs', 1299, '1 299 ₽', 'screenshot_import, срок 24ч', true, NOW()),
        (v_yarkiy_id, 'Футболка сублимация мужская', 'souvenirs', 1299, '1 299 ₽', 'screenshot_import, срок 24ч', true, NOW()),
        (v_yarkiy_id, 'Футболка прямая печать женская (XS-M)', 'souvenirs', 1300, '1 300 ₽', 'screenshot_import', true, NOW()),
        (v_yarkiy_id, 'Футболка прямая печать женская (L-XL)', 'souvenirs', 1600, '1 600 ₽', 'screenshot_import', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Толстовки / Свитшоты ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Толстовка с капюшоном', 'souvenirs', 4550, '4 550 ₽', 'screenshot_import, срок 3 дня', true, NOW()),
        (v_yarkiy_id, 'Свитшот без капюшона', 'souvenirs', 4250, '4 250 ₽', 'screenshot_import, срок 3 дня', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Шопперы ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Шоппер с печатью', 'souvenirs', 1250, '1 250 ₽', 'screenshot_import, срок 24ч', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Подушки ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Подушка с фото', 'souvenirs', 1000, '1 000 ₽', 'screenshot_import, срок 24ч', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Мягкие игрушки ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Мягкая игрушка с печатью', 'souvenirs', 1950, '1 950 ₽', 'screenshot_import, срок 24ч', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Кружки ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Кружка белая', 'souvenirs', 850, '850 ₽', 'screenshot_import, срок 24ч', true, NOW()),
        (v_yarkiy_id, 'Кружка цветная внутри', 'souvenirs', 850, '850 ₽', 'screenshot_import, срок 24ч', true, NOW()),
        (v_yarkiy_id, 'Кружка хамелеон', 'souvenirs', 850, '850 ₽', 'screenshot_import, срок 24ч', true, NOW()),
        (v_yarkiy_id, 'Кружка латте', 'souvenirs', 850, '850 ₽', 'screenshot_import, срок 24ч', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Тарелки ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Тарелка с фото', 'souvenirs', 780, '780 ₽', 'screenshot_import, срок 24ч', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Этикетка на шампанское ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Этикетка на шампанское', 'souvenirs', 500, '500 ₽', 'screenshot_import, срок 24ч', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Камень с фото ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Камень с фото', 'souvenirs', 1000, '1 000 ₽', 'screenshot_import, срок 3 дня', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Часы с фото ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Часы с фото', 'souvenirs', 1900, '1 900 ₽', 'screenshot_import, срок 3 дня', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Ёлочные украшения ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Ёлочное украшение с фото', 'souvenirs', 450, '450 ₽', 'screenshot_import, срок 24ч', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Металлические таблички ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Металлическая табличка', 'souvenirs', 850, '850 ₽', 'screenshot_import, срок 3 дня', true, NOW()),
        (v_yarkiy_id, 'Металлическая табличка на дерев. подложке', 'souvenirs', 550, '550 ₽', 'screenshot_import, срок 3 дня', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Брелки ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Брелок с фото', 'souvenirs', 140, '140 ₽', 'screenshot_import, срок 24ч', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Значки ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Значок с фото', 'souvenirs', 150, '150 ₽', 'screenshot_import, срок 24ч', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Фотомагниты ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Фотомагнит виниловый', 'souvenirs', 120, '120 ₽', 'screenshot_import, срок 24ч', true, NOW()),
        (v_yarkiy_id, 'Фотомагнит акриловый', 'souvenirs', 230, '230 ₽', 'screenshot_import, срок 24ч', true, NOW()),
        (v_yarkiy_id, 'Фотомагнит круглый', 'souvenirs', 150, '150 ₽', 'screenshot_import, срок 24ч', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Открытки ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Открытка с фото 1шт', 'souvenirs', 120, '120 ₽', 'screenshot_import, срок 24ч', true, NOW()),
        (v_yarkiy_id, 'Открытка-гармошка', 'souvenirs', 1350, '1 350 ₽', 'screenshot_import, срок 3 дня', true, NOW()),
        (v_yarkiy_id, 'Набор фотокарточек', 'souvenirs', 2350, '2 350 ₽', 'screenshot_import, комплект', true, NOW()),
        (v_yarkiy_id, 'Комплект открыток 20шт буклет', 'souvenirs', 3240, '3 240 ₽', 'screenshot_import', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Календари ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Перекидной календарь', 'polygraphy', 820, '820 ₽', 'screenshot_import, срок 3 дня', true, NOW()),
        (v_yarkiy_id, 'Календарь-планер', 'polygraphy', 2800, '2 800 ₽', 'screenshot_import, срок 10 дней', true, NOW()),
        (v_yarkiy_id, 'Настольный календарь Домик', 'polygraphy', 1160, '1 160 ₽', 'screenshot_import, срок 3 дня', true, NOW()),
        (v_yarkiy_id, 'Квартальный календарь Премиум', 'polygraphy', 1180, '1 180 ₽', 'screenshot_import, срок 10 дней', true, NOW()),
        (v_yarkiy_id, 'Квартальный календарь Стандарт', 'polygraphy', 1470, '1 470 ₽', 'screenshot_import, срок 10 дней', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Визитки ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Визитки 50шт', 'polygraphy', 930, '930 ₽', 'screenshot_import, Konica Minolta, срок 24ч', true, NOW()),
        (v_yarkiy_id, 'Визитки 100шт', 'polygraphy', 1134, '1 134 ₽', 'screenshot_import, Konica Minolta, срок 24ч', true, NOW()),
        (v_yarkiy_id, 'Визитки 200шт', 'polygraphy', 1814, '1 814 ₽', 'screenshot_import, Konica Minolta', true, NOW()),
        (v_yarkiy_id, 'Визитки 500шт', 'polygraphy', 3856, '3 856 ₽', 'screenshot_import, Konica Minolta', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Листовки ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Листовки A6 50шт 4+0', 'polygraphy', 870, '870 ₽', 'screenshot_import, Konica Minolta, срок 24ч', true, NOW()),
        (v_yarkiy_id, 'Листовки A5 50шт 4+0', 'polygraphy', 1580, '1 580 ₽', 'screenshot_import, Konica Minolta, срок 24ч', true, NOW()),
        (v_yarkiy_id, 'Листовки A4 50шт 4+4 двуст', 'polygraphy', 3550, '3 550 ₽', 'screenshot_import, Konica Minolta, срок 24ч', true, NOW()),
        (v_yarkiy_id, 'Листовки A4 50шт 4+0', 'polygraphy', 2200, '2 200 ₽', 'screenshot_import, Konica Minolta', true, NOW()),
        (v_yarkiy_id, 'Листовки A6 100шт 4+0', 'polygraphy', 1160, '1 160 ₽', 'screenshot_import, Konica Minolta', true, NOW()),
        (v_yarkiy_id, 'Листовки A5 100шт 4+0', 'polygraphy', 2116, '2 116 ₽', 'screenshot_import, Konica Minolta', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Брошюры ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Брошюра на скобе A6 8стр 1шт', 'polygraphy', 344, '344 ₽', 'screenshot_import, мин 1шт, Konica Minolta, срок 3 дня', true, NOW()),
        (v_yarkiy_id, 'Брошюра на скобе A5 12стр 1шт', 'polygraphy', 408, '408 ₽', 'screenshot_import, мин 1шт, Konica Minolta', true, NOW()),
        (v_yarkiy_id, 'Брошюра на скобе A6 16стр 1шт', 'polygraphy', 482, '482 ₽', 'screenshot_import, мин 1шт', true, NOW()),
        (v_yarkiy_id, 'Брошюра на скобе A5 32стр 1шт', 'polygraphy', 1174, '1 174 ₽', 'screenshot_import, мин 1шт', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Кепки и панамы ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Кепка с печатью', 'souvenirs', 1600, '1 600 ₽', 'screenshot_import, срок 3 дня', true, NOW()),
        (v_yarkiy_id, 'Панама с печатью', 'souvenirs', 1700, '1 700 ₽', 'screenshot_import, срок 3 дня', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Бессмертный полк ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Штендер Бессмертный полк', 'souvenirs', 1100, '1 100 ₽', 'screenshot_import, срок 24ч', true, NOW()),
        (v_yarkiy_id, 'Наклейка на авто Бессмертный полк', 'souvenirs', 550, '550 ₽', 'screenshot_import', true, NOW()),
        (v_yarkiy_id, 'Значок Бессмертный полк', 'souvenirs', 385, '385 ₽', 'screenshot_import', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Печать из файла ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Печать ч/б A4', 'copy', 20, '20 ₽', 'screenshot_import, срок 15 мин', true, NOW()),
        (v_yarkiy_id, 'Печать ч/б A3', 'copy', 40, '40 ₽', 'screenshot_import, срок 15 мин', true, NOW()),
        (v_yarkiy_id, 'Печать цветная A4 (текст+графика)', 'copy', 40, '40 ₽', 'screenshot_import, срок 15 мин', true, NOW()),
        (v_yarkiy_id, 'Печать полноцветная A4 (фото)', 'copy', 240, '240 ₽', 'screenshot_import, срок 15 мин', true, NOW()),
        (v_yarkiy_id, 'Печать цветная A3 (текст+графика)', 'copy', 80, '80 ₽', 'screenshot_import, срок 15 мин', true, NOW()),
        (v_yarkiy_id, 'Печать полноцветная A3 (фото)', 'copy', 480, '480 ₽', 'screenshot_import, срок 15 мин', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Копирование ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Копирование ч/б A4', 'copy', 20, '20 ₽', 'screenshot_import, срок 15 мин', true, NOW()),
        (v_yarkiy_id, 'Копирование ч/б A3', 'copy', 40, '40 ₽', 'screenshot_import, срок 15 мин', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Сканирование ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Сканирование A4', 'copy', 50, '50 ₽', 'screenshot_import, срок 15 мин', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Ламинирование ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Ламинирование A4', 'copy', 150, '150 ₽', 'screenshot_import, срок 15 мин', true, NOW()),
        (v_yarkiy_id, 'Ламинирование A3', 'copy', 300, '300 ₽', 'screenshot_import, срок 15 мин', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Печать с фотоплёнки ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Печать с фотоплёнки 10x15', 'other', 80, '80 ₽/кадр', 'screenshot_import, срок 3 дня', true, NOW()),
        (v_yarkiy_id, 'Проявка фотоплёнки C-41', 'other', 500, '500 ₽', 'screenshot_import, срок 3 дня', true, NOW()),
        (v_yarkiy_id, 'Оцифровка негативов', 'other', 50, '50 ₽/кадр', 'screenshot_import, срок 3 дня', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ── Яркий: Реставрация фото ──
    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_yarkiy_id, 'Реставрация фото простая', 'restoration', 500, '500 ₽', 'screenshot_import, срок 3 дня', true, NOW()),
        (v_yarkiy_id, 'Реставрация фото сложная', 'restoration', 1500, '1 500 ₽', 'screenshot_import, срок 5 дней', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

    -- ============================================================
    -- 4. ТриНаЧетыре — clean prices from screenshots
    -- ============================================================

    INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, verified, scraped_at)
    VALUES
        (v_tri_id, 'Быстрое фото на документы', 'photo_documents', 800, '800 ₽', 'screenshot_import, до 10 мин, без ретуши', true, NOW()),
        (v_tri_id, 'Красивое фото на документы', 'photo_documents', 1500, '1 500 ₽', 'screenshot_import, с ретушью', true, NOW()),
        (v_tri_id, 'Абсолютный сервис фото на документы', 'photo_documents', 2000, '2 000 ₽', 'screenshot_import, премиум', true, NOW()),
        (v_tri_id, 'Бизнес-портрет', 'portrait', 2000, '2 000 ₽', 'screenshot_import', true, NOW())
    ON CONFLICT (competitor_id, service_name) DO UPDATE SET
        price_min = EXCLUDED.price_min, price_text = EXCLUDED.price_text,
        service_category = EXCLUDED.service_category, notes = EXCLUDED.notes,
        verified = true, scraped_at = NOW();

END $$;

-- ============================================================
-- 5. Final cleanup: remove any remaining garbage with obviously wrong names
-- ============================================================

-- Delete any remaining entries where service_name is just a number
DELETE FROM kb_competitor_prices WHERE service_name ~ '^[\d\s₽\.руб]+$';

-- Delete entries starting with | (table fragments from markdown)
DELETE FROM kb_competitor_prices WHERE service_name LIKE '| %' OR service_name LIKE '|%';

COMMIT;
