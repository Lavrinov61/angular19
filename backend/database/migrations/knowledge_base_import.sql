-- =============================================================
-- Knowledge Base — Initial Data Import
-- Source: services.data.ts, address.data.ts, photographers.data.ts,
--         about.data.ts, hero.data.ts, reviews.data.ts,
--         конкуренты/*.md
-- =============================================================

-- All inserts use ON CONFLICT (slug) DO NOTHING for idempotency

-- =============================================================
-- 1. COMPANY & BRAND
-- =============================================================

INSERT INTO kb_entities (category_id, entity_type, slug, status, visibility, name, summary, content, metadata, tags, source_type, confidence, is_verified)
VALUES
-- Миссия
((SELECT id FROM kb_categories WHERE slug = 'company-mission'), 'usp', 'company-mission',
 'active', 'public', 'Миссия и ценности Своё Фото',
 'Превращаем моменты в искусство. Оплата только за понравившиеся снимки.',
 E'# Миссия\n\nПревращаем моменты в искусство. Специализируемся на студийной и репортажной фотосъёмках с уникальным подходом: оплата только за понравившиеся снимки.\n\nНаша команда опытных фотографов с передовым оборудованием создаст для вас идеальные кадры и комфортную атмосферу.\n\n## Ключевые слова\nПрофессионально • Креативно • Доступно • С душой',
 '{"keywords": ["Профессионально", "Креативно", "Доступно", "С душой"], "headline": "От фото на паспорт до офсетного тиража — решаем любую задачу", "subtitle": "Две студии в центре Ростова, онлайн-сервис по всей России"}'::jsonb,
 ARRAY['миссия', 'ценности', 'бренд'], 'import', 1.0, TRUE),

-- История
((SELECT id FROM kb_categories WHERE slug = 'company-history'), 'content', 'company-history',
 'active', 'public', 'История компании',
 'Фотостудия «Своё Фото» (МагнусФото) работает с 1999 года. 27 лет опыта, 30 000+ клиентов.',
 E'# История\n\n- **1999** — Основание фотостудии МагнусФото в Ростове-на-Дону\n- **2024** — Ребрендинг в «Своё Фото», запуск онлайн-сервисов\n- **2025** — Открытие второй студии на 2-ой Баррикадной\n- **2026** — Запуск омниканальной CRM, нейрофотосессий, услуг для маркетплейсов\n\n## Достижения\n- 30 000+ клиентов\n- 482+ отзывов\n- Рейтинг 5.0',
 '{"founded_year": 1999, "rebranded_year": 2024, "years_in_business": 27, "total_customers": 30000, "total_reviews": 482, "rating": 5.0}'::jsonb,
 ARRAY['история', 'основание', 'достижения'], 'import', 1.0, TRUE),

-- Контакты
((SELECT id FROM kb_categories WHERE slug = 'company-contacts'), 'content', 'company-contacts',
 'active', 'public', 'Контактная информация',
 'Телефон: 8 (901) 417-86-68. Telegram, WhatsApp, VK, Max.',
 E'# Контакты\n\n- **Телефон:** 8 (901) 417-86-68\n- **Telegram:** @magnus_photo, @magnusphotorostov\n- **Email:** magnusphoto@list.ru\n- **Сайт:** svoefoto.ru\n- **VK:** группа svoefoto\n- **WhatsApp:** +7 901 417-86-68\n- **Max:** @magnus_photo',
 '{"phone": "+79014178668", "phone_display": "8 (901) 417-86-68", "email": "magnusphoto@list.ru", "website": "svoefoto.ru", "telegram": ["@magnus_photo", "@magnusphotorostov"], "messengers": ["telegram", "whatsapp", "vk", "max"]}'::jsonb,
 ARRAY['контакты', 'телефон', 'мессенджеры'], 'import', 1.0, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================
-- 2. USP (Уникальные преимущества)
-- =============================================================

INSERT INTO kb_entities (category_id, entity_type, slug, status, visibility, name, summary, content, metadata, tags, source_type, confidence, is_verified)
VALUES
((SELECT id FROM kb_categories WHERE slug = 'usp-pay-per-result'), 'usp', 'usp-pay-per-result',
 'active', 'public', 'Оплата по результату',
 'Платите только за те снимки, которые вам понравились. Уникальный подход на рынке Ростова.',
 E'Главное конкурентное преимущество: клиент не платит за неудачные кадры. Фотограф делает несколько дублей, клиент выбирает лучшие и оплачивает только их.',
 '{"claim": "Платите только за понравившиеся снимки", "evidence": ["27 лет практики", "30000+ довольных клиентов", "5.0 рейтинг"], "competitors_have": false}'::jsonb,
 ARRAY['утп', 'оплата', 'результат'], 'import', 1.0, TRUE),

((SELECT id FROM kb_categories WHERE slug = 'usp-speed'), 'usp', 'usp-speed',
 'active', 'public', 'Печать за 10 минут',
 'Моментальная печать фотографий без долгого ожидания. Готово за 10-15 минут.',
 E'Профессиональный фотопринтер позволяет выдать готовые напечатанные фотографии за 10-15 минут после съёмки. Клиент уходит с готовым результатом.',
 '{"claim": "Печать за 10 минут", "print_time_minutes": 10, "evidence": ["Профессиональный фотопринтер", "Документы готовы за 15 минут"]}'::jsonb,
 ARRAY['утп', 'скорость', 'печать'], 'import', 1.0, TRUE),

((SELECT id FROM kb_categories WHERE slug = 'usp-quality'), 'usp', 'usp-quality',
 'active', 'public', 'Идеальная ретушь',
 'Профессиональная обработка с учётом пожеланий клиента. Ручная работа, без AI-эффекта.',
 E'Каждое фото обрабатывается вручную профессиональным ретушёром. Естественная ретушь без «пластикового» эффекта. Клиент может указать пожелания по обработке.',
 '{"claim": "Ручная профессиональная ретушь", "method": "manual", "ai_used": false, "evidence": ["Индивидуальный подход", "Согласование перед печатью"]}'::jsonb,
 ARRAY['утп', 'качество', 'ретушь'], 'import', 1.0, TRUE),

((SELECT id FROM kb_categories WHERE slug = 'usp-experience'), 'usp', 'usp-experience',
 'active', 'public', 'С 1999 года',
 '27 лет опыта. 30 000+ клиентов. Рейтинг 5.0 на всех площадках.',
 E'Фотостудия работает с 1999 года — одна из старейших в Ростове-на-Дону. За это время обслужено более 30 000 клиентов. Рейтинг 5.0 на Google Maps, Яндекс Картах и 2ГИС.',
 '{"claim": "27 лет опыта, 30000+ клиентов", "founded_year": 1999, "customers": 30000, "rating": 5.0, "reviews": 482, "platforms": ["Google Maps", "Яндекс Карты", "2ГИС"]}'::jsonb,
 ARRAY['утп', 'опыт', 'рейтинг', 'отзывы'], 'import', 1.0, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================
-- 3. LOCATIONS (Студии)
-- =============================================================

INSERT INTO kb_entities (category_id, entity_type, slug, status, visibility, name, summary, content, metadata, tags, source_type, confidence, is_verified)
VALUES
((SELECT id FROM kb_categories WHERE slug = 'locations-studios'), 'location', 'studio-soborny',
 'active', 'public', 'Студия на Соборном',
 'г. Ростов-на-Дону, переулок Соборный 21. Центр, рядом с Большой Садовой. Пн-Вс 09:00-19:30.',
 E'Основная студия в центре Ростова-на-Дону. Работает с 1999 года.\n\n## Расположение\nПереулок Соборный 21, рядом с Большой Садовой (центр города).\n\n## Режим работы\nПонедельник — Воскресенье: 09:00 — 19:30',
 '{"address": "г. Ростов-на-Дону, переулок Соборный 21", "city": "Ростов-на-Дону", "district": "Центр", "landmark": "рядом с Большой Садовой", "coordinates": {"lat": 47.219706, "lng": 39.7107641}, "capacity": 2, "working_hours": {"mon-sun": "09:00-19:30"}, "opened_at": "1999-01-01", "map_links": {"yandex": "https://yandex.ru/maps/-/CHaIjZP9", "google": "https://www.google.com/maps/place/47.219706,39.7107641", "2gis": "https://2gis.ru/rostov-on-don/firm/70000001006548410"}}'::jsonb,
 ARRAY['студия', 'соборный', 'центр', 'ростов'], 'import', 1.0, TRUE),

((SELECT id FROM kb_categories WHERE slug = 'locations-studios'), 'location', 'studio-barrikadnaya',
 'active', 'public', 'Студия на 2-ой Баррикадной',
 'г. Ростов-на-Дону, ул. 2-ая Баррикадная 4. Рядом с ТЦ Сокол. Пн-Вс 09:00-19:30.',
 E'Вторая студия, открыта в январе 2026 года.\n\n## Расположение\nУл. 2-ая Баррикадная 4, рядом с ТЦ Сокол.\n\n## Режим работы\nПонедельник — Воскресенье: 09:00 — 19:30',
 '{"address": "г. Ростов-на-Дону, ул. 2-ая Баррикадная 4", "city": "Ростов-на-Дону", "district": "Стачки", "landmark": "рядом с ТЦ Сокол", "coordinates": {"lat": 47.21446, "lng": 39.66610}, "capacity": 7, "working_hours": {"mon-sun": "09:00-19:30"}, "opened_at": "2026-01-15", "map_links": {"yandex": "https://yandex.ru/maps/org/svoyo_foto/77417538661/", "google": "https://www.google.com/maps/place/47.21446,39.66610", "2gis": "https://2gis.ru/rostov-on-don/inside/3378335375709784/firm/70000001109846700"}}'::jsonb,
 ARRAY['студия', 'баррикадная', 'сокол', 'ростов'], 'import', 1.0, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================
-- 4. TEAM (Команда)
-- =============================================================

INSERT INTO kb_entities (category_id, entity_type, slug, status, visibility, name, summary, content, metadata, tags, source_type, confidence, is_verified)
VALUES
((SELECT id FROM kb_categories WHERE slug = 'team-photographers'), 'person', 'person-vladimir-migal',
 'active', 'internal', 'Владимир Мигаль',
 'Репортажный фотограф, 25+ лет опыта, 3000+ мероприятий.',
 E'Владимир Мигаль — ведущий репортажный фотограф студии. Незаметное присутствие и абсолютное внимание к деталям. Каждый репортаж — живая история через эмоции людей.',
 '{"role": "photographer", "title": "Репортажный фотограф", "experience_years": 25, "sessions_completed": 3000, "hourly_rate": 5000, "rating": 5.0, "reviews_count": 150, "specializations": ["Репортаж", "Корпоративы", "Мероприятия"], "languages": ["Русский"], "location_available": true, "studio_available": false, "tagline": "Ловлю моменты, которые становятся воспоминаниями", "personal_fact": "20 лет за камерой. Знает город как свои пять пальцев."}'::jsonb,
 ARRAY['фотограф', 'репортаж', 'мероприятия'], 'import', 1.0, TRUE),

((SELECT id FROM kb_categories WHERE slug = 'team-photographers'), 'person', 'person-margarita',
 'active', 'internal', 'Маргарита',
 'Студийный фотограф, 5+ лет опыта, 300+ фотосессий.',
 E'Маргарита — студийный фотограф. Индивидуальный подход к каждому клиенту. Умеет раскрепощать даже самых застенчивых — результат всегда превосходит ожидания.',
 '{"role": "photographer", "title": "Студийный фотограф", "experience_years": 5, "sessions_completed": 300, "hourly_rate": 4000, "rating": 5.0, "reviews_count": 120, "specializations": ["Студийный портрет", "Деловое фото", "Семейная съёмка"], "languages": ["Русский"], "location_available": false, "studio_available": true, "tagline": "Создаю портреты, в которых узнают себя", "personal_fact": "Считает, что идеальный свет — это когда человек светится изнутри."}'::jsonb,
 ARRAY['фотограф', 'студия', 'портрет'], 'import', 1.0, TRUE),

((SELECT id FROM kb_categories WHERE slug = 'team-photographers'), 'person', 'person-anna',
 'active', 'internal', 'Анна',
 'Студийный фотограф, 6+ лет опыта, 400+ фотосессий.',
 E'Анна — студийный фотограф. Творческий подход и современная техника работы со светом. Специализируется на портретах для документов, деловых и творческих фотосессиях.',
 '{"role": "photographer", "title": "Студийный фотограф", "experience_years": 6, "sessions_completed": 400, "hourly_rate": 4000, "rating": 5.0, "reviews_count": 180, "specializations": ["Портрет", "Документальное фото", "Детская съёмка"], "languages": ["Русский"], "location_available": false, "studio_available": true, "tagline": "Каждый кадр — маленький шедевр", "personal_fact": "Верит, что хорошая фотография меняет то, как человек видит себя."}'::jsonb,
 ARRAY['фотограф', 'студия', 'портрет', 'документы'], 'import', 1.0, TRUE),

((SELECT id FROM kb_categories WHERE slug = 'team-photographers'), 'person', 'person-olga',
 'active', 'internal', 'Ольга',
 'Студийный фотограф, 3+ года опыта, 200+ фотосессий.',
 E'Ольга — студийный фотограф. Создаёт тёплую атмосферу на съёмке — клиенты забывают о камере и просто живут. Именно так получаются лучшие портреты.',
 '{"role": "photographer", "title": "Студийный фотограф", "experience_years": 3, "sessions_completed": 200, "hourly_rate": 4000, "rating": 5.0, "reviews_count": 80, "specializations": ["Студийный портрет", "Фото на документы", "Семейные портреты"], "languages": ["Русский"], "location_available": false, "studio_available": true, "tagline": "Тепло, естественность и настоящие эмоции", "personal_fact": "Убеждена: каждый человек фотогеничен — нужно только найти правильный момент."}'::jsonb,
 ARRAY['фотограф', 'студия', 'портрет'], 'import', 1.0, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================
-- 5. SERVICES (27 услуг)
-- =============================================================

INSERT INTO kb_entities (category_id, entity_type, slug, status, visibility, name, summary, content, metadata, tags, source_type, confidence, is_verified)
VALUES
-- Фото на документы
((SELECT id FROM kb_categories WHERE slug = 'services-documents'), 'service', 'service-foto-na-document',
 'active', 'public', 'Фото на документы',
 'Фото на документы онлайн от 350₽ или в студии от 700₽. Ручная ретушь, несколько дублей на выбор.',
 E'Фото на документы онлайн от 350₽ или в студии от 700₽. Ручная ретушь художником, несколько дублей на выбор и согласование перед печатью. Фото в паспорт, за которое не стыдно 25 лет.',
 '{"base_price": 700, "original_price": 900, "discount_percent": 22, "currency": "RUB", "duration_minutes": 15, "category": "studio", "display_category": "documents", "popular": true, "features": ["Паспорт РФ • Загранпаспорт • Виза", "Грин-Карта • Студенческий билет", "Готово за 15 минут"], "availability": ["studio", "online"], "locations": ["soborny", "barrikadnaya"]}'::jsonb,
 ARRAY['документы', 'паспорт', 'виза', 'загранпаспорт'], 'import', 1.0, TRUE),

-- Портретная съёмка
((SELECT id FROM kb_categories WHERE slug = 'services-studio-photo'), 'service', 'service-portretnaya-sjomka',
 'active', 'public', 'Портретная фотосъёмка',
 'Профессиональная портретная съёмка: деловые портреты, бизнес-фото, фото для резюме. От 900₽.',
 E'Профессиональная портретная съёмка в студии: деловые портреты, бизнес-фото, фото для резюме и карьерных сайтов. Индивидуальный подход и профессиональная ретушь.',
 '{"base_price": 900, "currency": "RUB", "duration_minutes": 30, "category": "studio", "display_category": "portraits", "popular": true, "features": ["Бизнес-портрет • Фото для резюме", "Деловой стиль • Карьерные сайты", "Готово за 30 минут"], "availability": ["studio"], "locations": ["soborny", "barrikadnaya"]}'::jsonb,
 ARRAY['портрет', 'бизнес', 'резюме', 'деловой'], 'import', 1.0, TRUE),

-- Печать фотографий
((SELECT id FROM kb_categories WHERE slug = 'services-print'), 'service', 'service-pechat-foto',
 'active', 'public', 'Печать фотографий',
 'Качественная печать на профессиональной фотобумаге. Премиум от 20₽, Супер от 36₽. Готово за 15 минут.',
 NULL,
 '{"base_price": 20, "currency": "RUB", "duration_minutes": 15, "category": "service", "display_category": "print", "features": ["Премиум бумага", "Готово за 15 минут", "От 20₽"], "availability": ["studio"], "locations": ["soborny", "barrikadnaya"]}'::jsonb,
 ARRAY['печать', 'фотопечать', 'бумага'], 'import', 1.0, TRUE),

-- Печать на холсте
((SELECT id FROM kb_categories WHERE slug = 'services-print'), 'service', 'service-pechat-na-holste',
 'active', 'public', 'Печать на холсте',
 'Печать на художественном холсте с натяжкой на подрамник. От 2200₽.',
 NULL,
 '{"base_price": 2200, "currency": "RUB", "category": "service", "display_category": "print", "features": ["Художественный холст", "На подрамнике", "Отличный подарок"], "availability": ["studio"], "locations": ["soborny", "barrikadnaya"]}'::jsonb,
 ARRAY['печать', 'холст', 'подарок'], 'import', 1.0, TRUE),

-- Фото на памятник
((SELECT id FROM kb_categories WHERE slug = 'services-print'), 'service', 'service-foto-na-pamyatnik',
 'active', 'public', 'Фото на памятник',
 'Керамические фотографии для памятников. Устойчивость к погоде на десятилетия. От 1000₽.',
 NULL,
 '{"base_price": 1000, "currency": "RUB", "category": "service", "display_category": "print", "features": ["Устойчиво к погоде", "Служит десятилетия", "Ретушь включена"], "availability": ["studio"], "locations": ["soborny", "barrikadnaya"]}'::jsonb,
 ARRAY['памятник', 'керамика', 'печать'], 'import', 1.0, TRUE),

-- Визитки
((SELECT id FROM kb_categories WHERE slug = 'services-office'), 'service', 'service-vizitki',
 'active', 'public', 'Визитки',
 'Дизайн и печать визитных карточек. Готово за 1-2 дня. От 600₽.',
 NULL,
 '{"base_price": 600, "currency": "RUB", "category": "service", "display_category": "technical", "features": ["Профессиональный дизайн", "Быстрая печать", "Разные форматы"], "availability": ["studio"], "locations": ["soborny", "barrikadnaya"]}'::jsonb,
 ARRAY['визитки', 'полиграфия', 'дизайн'], 'import', 1.0, TRUE),

-- Печать документов
((SELECT id FROM kb_categories WHERE slug = 'services-office'), 'service', 'service-pechat-dokumentov',
 'active', 'public', 'Печать документов',
 'Быстрая печать документов. ЧБ и цветная. От 10₽.',
 NULL,
 '{"base_price": 10, "currency": "RUB", "category": "service", "display_category": "technical", "features": ["Черно-белая печать", "Цветная печать", "Различные форматы"], "availability": ["studio"], "locations": ["soborny", "barrikadnaya"]}'::jsonb,
 ARRAY['печать', 'документы', 'офис'], 'import', 1.0, TRUE),

-- Ксерокопия
((SELECT id FROM kb_categories WHERE slug = 'services-office'), 'service', 'service-kserokopiya',
 'active', 'public', 'Ксерокопия',
 'Качественное копирование документов. От 10₽.',
 NULL,
 '{"base_price": 10, "currency": "RUB", "category": "service", "display_category": "technical", "features": ["Быстрое копирование", "Четкость и контраст", "Разные форматы"], "availability": ["studio"], "locations": ["soborny", "barrikadnaya"]}'::jsonb,
 ARRAY['ксерокопия', 'копирование', 'офис'], 'import', 1.0, TRUE),

-- Ламинирование
((SELECT id FROM kb_categories WHERE slug = 'services-office'), 'service', 'service-laminirovanie',
 'active', 'public', 'Ламинирование',
 'Защитное ламинирование документов и фотографий. От 100₽.',
 NULL,
 '{"base_price": 100, "currency": "RUB", "category": "service", "display_category": "technical", "features": ["Защита от влаги", "Долговечность", "Разные размеры"], "availability": ["studio"], "locations": ["soborny", "barrikadnaya"]}'::jsonb,
 ARRAY['ламинирование', 'защита', 'офис'], 'import', 1.0, TRUE),

-- Сканирование
((SELECT id FROM kb_categories WHERE slug = 'services-office'), 'service', 'service-skanirovanie',
 'active', 'public', 'Сканирование',
 'Профессиональное сканирование с высоким разрешением. От 50₽.',
 NULL,
 '{"base_price": 50, "currency": "RUB", "category": "service", "display_category": "technical", "features": ["Высокое разрешение", "Оцифровка документов", "Архивирование"], "availability": ["studio"], "locations": ["soborny", "barrikadnaya"]}'::jsonb,
 ARRAY['сканирование', 'оцифровка', 'офис'], 'import', 1.0, TRUE),

-- Печать на кружках
((SELECT id FROM kb_categories WHERE slug = 'services-souvenirs'), 'service', 'service-pechat-na-kruzhkah',
 'active', 'public', 'Печать на кружках',
 'Печать фотографий на кружках. Отличный подарок. Готово за 1 день. От 390₽.',
 NULL,
 '{"base_price": 390, "currency": "RUB", "category": "service", "display_category": "print", "features": ["Качественная печать", "Устойчивый рисунок", "Отличный подарок"], "availability": ["studio"], "locations": ["soborny", "barrikadnaya"]}'::jsonb,
 ARRAY['кружки', 'сувениры', 'подарок'], 'import', 1.0, TRUE),

-- Печать на футболках
((SELECT id FROM kb_categories WHERE slug = 'services-souvenirs'), 'service', 'service-pechat-na-futbolkah',
 'active', 'public', 'Печать на футболках',
 'Печать фотографий на футболках. Термоперенос высокого качества. От 590₽.',
 NULL,
 '{"base_price": 590, "currency": "RUB", "category": "service", "display_category": "print", "features": ["Термоперенос", "Качественная печать", "Разные размеры"], "availability": ["studio"], "locations": ["soborny", "barrikadnaya"]}'::jsonb,
 ARRAY['футболки', 'сувениры', 'термоперенос'], 'import', 1.0, TRUE),

-- Печать на подарках
((SELECT id FROM kb_categories WHERE slug = 'services-souvenirs'), 'service', 'service-pechat-na-podarki',
 'active', 'public', 'Печать на подарках',
 'Печать на пазлах, магнитах, календарях и другом. От 300₽.',
 NULL,
 '{"base_price": 300, "currency": "RUB", "category": "service", "display_category": "print", "features": ["Разные форматы", "Качественная печать", "Уникальные подарки"], "availability": ["studio"], "locations": ["soborny", "barrikadnaya"]}'::jsonb,
 ARRAY['подарки', 'сувениры', 'пазлы', 'магниты'], 'import', 1.0, TRUE),

-- Ретушь
((SELECT id FROM kb_categories WHERE slug = 'services-retouch'), 'service', 'service-retush',
 'active', 'public', 'Ретушь фотографий',
 'Профессиональная ретушь портретов с сохранением естественности. От 600₽.',
 NULL,
 '{"base_price": 600, "currency": "RUB", "category": "service", "display_category": "retouch", "popular": true, "features": ["Естественная ретушь", "Коррекция кожи", "Цветокоррекция"], "availability": ["studio", "online"], "locations": ["soborny", "barrikadnaya"]}'::jsonb,
 ARRAY['ретушь', 'обработка', 'портрет'], 'import', 1.0, TRUE),

-- Реставрация
((SELECT id FROM kb_categories WHERE slug = 'services-restoration'), 'service', 'service-restavratsiya',
 'active', 'public', 'Реставрация фотографий',
 'Восстановление старых и повреждённых фотографий. Устранение царапин, восстановление цвета. От 900₽.',
 NULL,
 '{"base_price": 900, "currency": "RUB", "category": "service", "display_category": "restoration", "popular": true, "features": ["Устранение царапин", "Восстановление цвета", "Цифровая архивация"], "availability": ["studio", "online"], "locations": ["soborny", "barrikadnaya"]}'::jsonb,
 ARRAY['реставрация', 'восстановление', 'старые фото'], 'import', 1.0, TRUE),

-- Нейрофотосессия
((SELECT id FROM kb_categories WHERE slug = 'services-neuro'), 'service', 'service-neyrofotosessiya',
 'active', 'public', 'Нейрофотосессия',
 'AI создаёт профессиональные фото из селфи. Бизнес, fashion, арт. По всей России. От 450₽.',
 NULL,
 '{"base_price": 450, "currency": "RUB", "category": "service", "display_category": "online", "new": true, "features": ["AI-генерация", "По всей России", "Результат за 1-2 часа"], "availability": ["online"]}'::jsonb,
 ARRAY['нейро', 'ai', 'онлайн', 'селфи'], 'import', 1.0, TRUE),

-- Реставрация онлайн
((SELECT id FROM kb_categories WHERE slug = 'services-online'), 'service', 'service-restavratsiya-online',
 'active', 'public', 'Реставрация фото онлайн',
 'Восстановление старых фото удалённо. По всей России. От 450₽.',
 NULL,
 '{"base_price": 450, "currency": "RUB", "category": "service", "display_category": "online", "features": ["Восстановление", "По всей России", "Гарантия качества"], "availability": ["online"]}'::jsonb,
 ARRAY['реставрация', 'онлайн', 'удалённо'], 'import', 1.0, TRUE),

-- Ретушь онлайн
((SELECT id FROM kb_categories WHERE slug = 'services-online'), 'service', 'service-retush-online',
 'active', 'public', 'Ретушь фото онлайн',
 'Профессиональная обработка портретов онлайн. Без «пластикового» эффекта. От 350₽.',
 NULL,
 '{"base_price": 350, "currency": "RUB", "category": "service", "display_category": "online", "features": ["Естественная ретушь", "По всей России", "От 350₽"], "availability": ["online"]}'::jsonb,
 ARRAY['ретушь', 'онлайн', 'портрет'], 'import', 1.0, TRUE),

-- Фото на документы онлайн
((SELECT id FROM kb_categories WHERE slug = 'services-online'), 'service', 'service-foto-na-documenty-online',
 'active', 'public', 'Фото на документы онлайн',
 'Отправьте селфи — получите фото на документы с ручной ретушью. По всей России. От 350₽.',
 NULL,
 '{"base_price": 350, "currency": "RUB", "category": "service", "display_category": "online", "popular": true, "features": ["По всей России", "Ручная ретушь", "От 350₽"], "availability": ["online"]}'::jsonb,
 ARRAY['документы', 'онлайн', 'селфи'], 'import', 1.0, TRUE),

-- Парадный Герой
((SELECT id FROM kb_categories WHERE slug = 'services-military'), 'service', 'service-voennaya-retush',
 'active', 'public', 'Парадный Герой',
 'Из селфи — в полный парад: уберём бороду, добавим форму и медали. Ручная работа за 1-2 дня. От 990₽.',
 E'Уникальная услуга военной ретуши. Из обычного фото создаём портрет в парадной форме с точными наградами. Ручная работа художника, без AI. Гарантия натуральности — неотличимо от реального фото.',
 '{"base_price": 990, "currency": "RUB", "category": "service", "display_category": "online", "features": ["Ручная работа", "Парадная форма", "За 1–2 дня"], "availability": ["studio", "online"], "unique_selling_point": true, "competitors_cant_match": true}'::jsonb,
 ARRAY['военная', 'ретушь', 'форма', 'медали', 'парадный герой'], 'import', 1.0, TRUE),

-- Товарная съёмка
((SELECT id FROM kb_categories WHERE slug = 'services-marketplace'), 'service', 'service-tovarnaya-sjomka',
 'active', 'public', 'Товарная съёмка',
 'Профессиональная товарная съёмка для WB/Ozon. Белый фон, стандарты маркетплейсов. От 400₽.',
 NULL,
 '{"base_price": 400, "currency": "RUB", "category": "service", "display_category": "business", "new": true, "features": ["Стандарты WB и Ozon", "Результат в тот же день", "От 400₽ за товар"], "availability": ["studio"], "locations": ["barrikadnaya"]}'::jsonb,
 ARRAY['товарная', 'маркетплейс', 'wildberries', 'ozon'], 'import', 1.0, TRUE),

-- Инфографика карточек
((SELECT id FROM kb_categories WHERE slug = 'services-marketplace'), 'service', 'service-infografika',
 'active', 'public', 'Инфографика карточек',
 'Дизайн инфографики для карточек WB/Ozon. Конвертирующие слайды. От 600₽/слайд.',
 NULL,
 '{"base_price": 600, "currency": "RUB", "category": "service", "display_category": "business", "features": ["Стандарты WB и Ozon", "2 раунда правок", "От 600₽ за слайд"], "availability": ["online"]}'::jsonb,
 ARRAY['инфографика', 'маркетплейс', 'дизайн', 'карточки'], 'import', 1.0, TRUE),

-- SMM-контент
((SELECT id FROM kb_categories WHERE slug = 'services-marketplace'), 'service', 'service-smm-content',
 'active', 'public', 'SMM-контент',
 'Reels, сторис и карусели для Instagram, VK, Telegram. Студийный свет. От 2500₽.',
 NULL,
 '{"base_price": 2500, "currency": "RUB", "category": "service", "display_category": "business", "features": ["Reels + сторис + карусели", "Студийный свет", "От 2 500₽"], "availability": ["studio"], "locations": ["barrikadnaya"]}'::jsonb,
 ARRAY['smm', 'reels', 'контент', 'instagram', 'vk'], 'import', 1.0, TRUE),

-- Супер-пакет
((SELECT id FROM kb_categories WHERE slug = 'services-marketplace'), 'service', 'service-super-paket',
 'active', 'public', 'Супер-пакет «Продающий»',
 'Полный комплект: товарные фото + инфографика + SMM. Один день. Экономия 30%. От 18000₽.',
 NULL,
 '{"base_price": 18000, "currency": "RUB", "category": "service", "display_category": "business", "popular": true, "features": ["Фото + инфографика + видео", "Экономия 30%", "От 18 000₽"], "availability": ["studio"], "locations": ["barrikadnaya"]}'::jsonb,
 ARRAY['пакет', 'маркетплейс', 'бизнес', 'комплекс'], 'import', 1.0, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================
-- 6. COMPETITORS (4 конкурента)
-- =============================================================

INSERT INTO kb_entities (category_id, entity_type, slug, status, visibility, name, summary, content, metadata, tags, source_type, confidence, is_verified)
VALUES
-- ТриНаЧетыре
((SELECT id FROM kb_categories WHERE slug = 'competitors-direct'), 'competitor', 'competitor-trinachetyre',
 'active', 'confidential', 'ТриНаЧетыре (3x4photo.ru)',
 'Сеть с 2013 года, 396k+ клиентов. Фокус: документы + бизнес-портрет. Премиум-цены.',
 E'Прямой конкурент. Сеть с 2013 года, >396 000 клиентов по России. Фокус строго на документы + бизнес-портрет.\n\nНет товарной съёмки, инфографики, Reels, SMM, реставрации, замены формы/медалей.\n\n## Выводы\nОни премиум в документах (1500–2000₽ за комплект с ретушью), но узко. Мы шире, дешевле в классике, сильнее в маркетплейсах и ветеранской ретуши.',
 '{"website": "https://3x4photo.ru/rnd", "city": "Ростов-на-Дону", "address": "пер. Семашко, 48е, 3 этаж", "founded_year": 2013, "total_customers": 396000, "focus": "документы + бизнес-портрет", "online_booking": true, "ai_retouch": false, "pricing": {"document_basic": 800, "document_retouch": 1500, "document_premium": 2000, "business_portrait": 2000}, "services": ["Фото на документы", "Бизнес-портрет"], "strengths": ["396k+ клиентов", "Профессиональный свет", "Журнальная ретушь", "Онлайн-запись"], "weaknesses": ["Узкий спектр услуг", "Нет товарной съёмки", "Нет реставрации", "Нет военной ретуши", "Нет SMM/Reels"], "last_checked_at": "2026-03-01"}'::jsonb,
 ARRAY['конкурент', 'документы', 'ростов'], 'import', 1.0, TRUE),

-- SkyPrint
((SELECT id FROM kb_categories WHERE slug = 'competitors-indirect'), 'competitor', 'competitor-skyprint',
 'active', 'confidential', 'Sky Print (копицентр)',
 'Копицентр широкого профиля. Печать, чертежи, сувениры, визитки, переплёт, багет.',
 E'Косвенный конкурент — копицентр широкого профиля. Пересечение в печати, сувенирах и офисных услугах.\n\nЧёткий тиражный прайс на сувениры. Не специализируются на фотосъёмке.',
 '{"website": "https://skyprint161.ru", "city": "Ростов-на-Дону", "address": "пр-т Ворошиловский, 89, ТЦ Проспект", "focus": "полиграфия и копирование", "pricing": {"print_a4_color": 30, "lamination_a4": 100, "scan_a4": 20, "mug_white": 400, "mug_chameleon": 750, "business_cards_100": 600, "restoration": 300}, "services": ["Печать", "Ксерокопия", "Визитки", "Ламинирование", "Сувениры", "Багет", "Переплёт"], "strengths": ["Тиражные цены", "Широкий ассортимент полиграфии", "WhatsApp для заказов"], "weaknesses": ["Не фотостудия", "Нет профессиональной съёмки", "Нет ретуши портретов"], "last_checked_at": "2026-03-01"}'::jsonb,
 ARRAY['конкурент', 'копицентр', 'полиграфия'], 'import', 1.0, TRUE),

-- Яркий Фотомаркет
((SELECT id FROM kb_categories WHERE slug = 'competitors-direct'), 'competitor', 'competitor-yarkiy',
 'active', 'confidential', 'Яркий Фотомаркет',
 '30 лет на рынке. Фотопечать, фотокниги, сувениры, проявка плёнки. Фото на документы 590-790₽.',
 E'Крупный фотосервис с 30-летней историей. Огромный ассортимент фотопечати, фотокниг, сувениров, календарей. Проявка плёнки — уникальная услуга.\n\n## Сильные стороны\n- 30 лет опыта\n- Широчайший ассортимент фотосувениров и полиграфии\n- Проявка плёнки (С41, E-6, ECN-II)\n- Фотокниги от 1010₽\n\n## Слабые стороны\n- Не специализируются на портретной съёмке\n- Нет ретуши/реставрации как отдельной услуги\n- Нет товарной съёмки для маркетплейсов',
 '{"website": "https://photo.yarkiy.ru/rostov", "city": "Ростов-на-Дону", "founded_year": 1996, "slogan": "Цените каждые мгновения вашей жизни", "pricing": {"photo_10x15": 36, "photo_20x30": 140, "canvas_20x30": 1392, "document_photo": 590, "document_photo_premium": 790, "mug_white": 850, "tshirt": 1300, "photobook_basic": 1010, "photobook_premium": 9700, "film_c41": 250, "film_e6": 650}, "services": ["Фотопечать", "Интерьерная печать", "Фотокниги", "Фотосувениры", "Фото на документы", "Фотокалендари", "Полиграфия", "Проявка плёнки"], "strengths": ["30 лет опыта", "Огромный ассортимент сувениров", "Проявка плёнки", "Фотокниги"], "weaknesses": ["Нет профессиональной портретной съёмки", "Нет ретуши/реставрации", "Нет товарной съёмки", "Нет военной ретуши"], "last_checked_at": "2026-03-01"}'::jsonb,
 ARRAY['конкурент', 'фотопечать', 'сувениры', 'фотокниги'], 'import', 1.0, TRUE),

-- О!Фото
((SELECT id FROM kb_categories WHERE slug = 'competitors-direct'), 'competitor', 'competitor-ofoto',
 'active', 'confidential', 'О! Фото',
 'Две точки в Ростове. Фокус: документы + портреты + реставрация. Цены от 700₽.',
 E'Прямой конкурент с двумя точками в Ростове. Специализация: документы, портреты, реставрация.\n\n## Ценовое позиционирование\n- Документы стандарт: 700₽ (паритет с нами)\n- С ретушью: 1200₽\n- Бизнес-портрет: 1500₽\n- Замена формы: +500₽ (простая, без медалей)\n\n## Выводы\nВ классике мы паритет или чуть ниже. В нише ветеранской ретуши и маркетплейс-контента — лидеры.',
 '{"website": "https://ophotosalon.tilda.ws/", "city": "Ростов-на-Дону", "locations_count": 2, "addresses": ["пр. Будённовский 49/97 (Галерея Астор)", "ул. Зорге 19/162"], "working_hours": "10:00-19:00", "focus": "документы + портреты + реставрация", "pricing": {"document_basic": 700, "document_retouch": 1200, "document_extra_set": 300, "electronic_copy": 300, "child_photo": 700, "child_baby": 1000, "business_portrait": 1500, "portrait_extra": 500, "restoration_basic": 500, "restoration_complex": 1000, "uniform_change": 500, "photo_10x15": 50, "photo_15x20": 100, "photo_20x30": 200, "copy_bw": 15, "scan": 50}, "services": ["Фото на документы", "Детское фото", "Портрет", "Реставрация", "Ретушь", "Печать фото", "Ксерокопия", "Сканирование"], "strengths": ["2 точки", "Ручная ретушь", "Скидка 10% за подписку", "Электронка бесплатно за отзыв"], "weaknesses": ["Нет товарной съёмки", "Нет инфографики", "Нет Reels/SMM", "Нет подписок", "Простая замена формы (без медалей)"], "last_checked_at": "2026-03-01"}'::jsonb,
 ARRAY['конкурент', 'документы', 'портреты', 'ростов'], 'import', 1.0, TRUE)
ON CONFLICT (slug) DO NOTHING;


-- =============================================================
-- 7. RELATIONS (Knowledge Graph)
-- =============================================================

-- Фотографы → Студии (located_at)
INSERT INTO kb_relations (from_entity_id, to_entity_id, relation_type, label, source_type)
SELECT p.id, s.id, 'located_at', p.name || ' работает в ' || s.name, 'import'
FROM kb_entities p, kb_entities s
WHERE p.slug IN ('person-margarita', 'person-anna', 'person-olga')
  AND s.slug = 'studio-soborny'
ON CONFLICT (from_entity_id, to_entity_id, relation_type) DO NOTHING;

INSERT INTO kb_relations (from_entity_id, to_entity_id, relation_type, label, source_type)
SELECT p.id, s.id, 'located_at', p.name || ' работает в ' || s.name, 'import'
FROM kb_entities p, kb_entities s
WHERE p.slug IN ('person-margarita', 'person-anna', 'person-olga')
  AND s.slug = 'studio-barrikadnaya'
ON CONFLICT (from_entity_id, to_entity_id, relation_type) DO NOTHING;

-- Услуги → Студии (located_at)
INSERT INTO kb_relations (from_entity_id, to_entity_id, relation_type, label, source_type)
SELECT svc.id, loc.id, 'located_at', svc.name || ' доступна в ' || loc.name, 'import'
FROM kb_entities svc, kb_entities loc
WHERE svc.entity_type = 'service'
  AND svc.metadata->'availability' ? 'studio'
  AND loc.slug IN ('studio-soborny', 'studio-barrikadnaya')
ON CONFLICT (from_entity_id, to_entity_id, relation_type) DO NOTHING;

-- Фотографы → Услуги (performs)
INSERT INTO kb_relations (from_entity_id, to_entity_id, relation_type, label, source_type)
SELECT p.id, s.id, 'performs', p.name || ' выполняет ' || s.name, 'import'
FROM kb_entities p, kb_entities s
WHERE p.slug IN ('person-margarita', 'person-anna', 'person-olga')
  AND s.slug IN ('service-foto-na-document', 'service-portretnaya-sjomka')
ON CONFLICT (from_entity_id, to_entity_id, relation_type) DO NOTHING;

INSERT INTO kb_relations (from_entity_id, to_entity_id, relation_type, label, source_type)
SELECT p.id, s.id, 'performs', p.name || ' выполняет ' || s.name, 'import'
FROM kb_entities p, kb_entities s
WHERE p.slug = 'person-vladimir-migal'
  AND s.slug IN ('service-portretnaya-sjomka', 'service-smm-content')
ON CONFLICT (from_entity_id, to_entity_id, relation_type) DO NOTHING;

-- Конкуренты → Услуги (competes_with)
INSERT INTO kb_relations (from_entity_id, to_entity_id, relation_type, label, weight, source_type)
SELECT c.id, s.id, 'competes_with', c.name || ' конкурирует по ' || s.name,
  CASE WHEN c.slug = 'competitor-trinachetyre' THEN 9.0
       WHEN c.slug = 'competitor-ofoto' THEN 8.0
       ELSE 5.0 END,
  'import'
FROM kb_entities c, kb_entities s
WHERE c.slug IN ('competitor-trinachetyre', 'competitor-ofoto')
  AND s.slug = 'service-foto-na-document'
ON CONFLICT (from_entity_id, to_entity_id, relation_type) DO NOTHING;

INSERT INTO kb_relations (from_entity_id, to_entity_id, relation_type, label, weight, source_type)
SELECT c.id, s.id, 'competes_with', c.name || ' конкурирует по ' || s.name, 7.0, 'import'
FROM kb_entities c, kb_entities s
WHERE c.slug = 'competitor-yarkiy'
  AND s.slug IN ('service-pechat-foto', 'service-pechat-na-holste', 'service-pechat-na-kruzhkah')
ON CONFLICT (from_entity_id, to_entity_id, relation_type) DO NOTHING;

-- Онлайн-услуги — альтернативы студийных
INSERT INTO kb_relations (from_entity_id, to_entity_id, relation_type, label, bidirectional, source_type)
SELECT a.id, b.id, 'alternative_to', 'Онлайн-версия: ' || a.name, TRUE, 'import'
FROM kb_entities a, kb_entities b
WHERE (a.slug, b.slug) IN (
  ('service-retush-online', 'service-retush'),
  ('service-restavratsiya-online', 'service-restavratsiya'),
  ('service-foto-na-documenty-online', 'service-foto-na-document')
)
ON CONFLICT (from_entity_id, to_entity_id, relation_type) DO NOTHING;

-- УТП → Услуги (enables)
INSERT INTO kb_relations (from_entity_id, to_entity_id, relation_type, label, source_type)
SELECT u.id, s.id, 'enables', u.name || ' → ' || s.name, 'import'
FROM kb_entities u, kb_entities s
WHERE u.slug = 'usp-pay-per-result'
  AND s.slug IN ('service-foto-na-document', 'service-portretnaya-sjomka')
ON CONFLICT (from_entity_id, to_entity_id, relation_type) DO NOTHING;

INSERT INTO kb_relations (from_entity_id, to_entity_id, relation_type, label, source_type)
SELECT u.id, s.id, 'enables', u.name || ' → ' || s.name, 'import'
FROM kb_entities u, kb_entities s
WHERE u.slug = 'usp-speed'
  AND s.slug IN ('service-pechat-foto', 'service-foto-na-document')
ON CONFLICT (from_entity_id, to_entity_id, relation_type) DO NOTHING;


-- =============================================================
-- DONE
-- =============================================================
-- Entities: ~30 (3 company + 4 USP + 2 locations + 4 team + 24 services + 4 competitors)
-- Relations: ~80+ (located_at, performs, competes_with, alternative_to, enables)
-- =============================================================
