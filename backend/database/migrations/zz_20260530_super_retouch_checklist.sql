-- Конфигуратор «Супер обработки» (POS): каталог под-опций ретуши + поддержка уровня 'super'.
--
-- Транзакция 1: таблица каталога super_retouch_checklist_items + индексы + сид
--   (15 групп / 110 вариантов + 1 notes-sentinel = 111 строк) из research-content.
-- Транзакция 2: расширение CHECK work_tasks.retouch_level на 'super'
--   (разнесено отдельно — ACCESS EXCLUSIVE на work_tasks не ждёт длинный сид).
--
-- Всё идемпотентно: CREATE TABLE/INDEX IF NOT EXISTS, INSERT ... ON CONFLICT (slug) DO UPDATE,
-- DO-блок пересоздаёт CHECK только если 'super' ещё не разрешён.
-- gender: f→female, m→male, иначе any. addon_price=0 — закладка под платные под-опции (НЕ в расчёте).

-- ============================ Транзакция 1: каталог ============================
BEGIN;

CREATE TABLE IF NOT EXISTS super_retouch_checklist_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_slug           varchar(80)   NOT NULL,
  group_name           varchar(120)  NOT NULL,
  group_selection_type varchar(20)   NOT NULL DEFAULT 'multi'
                         CHECK (group_selection_type IN ('single','multi','notes')),
  group_sort_order     int           NOT NULL DEFAULT 0,
  slug                 varchar(100)  NOT NULL,
  name                 varchar(255)  NOT NULL,
  hint                 text,
  gender               varchar(10)   NOT NULL DEFAULT 'any'
                         CHECK (gender IN ('male','female','any')),
  icon                 varchar(50),
  sort_order           int           NOT NULL DEFAULT 0,
  is_default           boolean       NOT NULL DEFAULT false,
  is_active            boolean       NOT NULL DEFAULT true,
  addon_price          numeric(10,2) NOT NULL DEFAULT 0.00 CHECK (addon_price >= 0),
  created_at           timestamptz   DEFAULT now(),
  updated_at           timestamptz   DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS srci_slug_uniq
  ON super_retouch_checklist_items (slug);
CREATE INDEX IF NOT EXISTS idx_srci_active_group
  ON super_retouch_checklist_items (is_active, group_sort_order, sort_order);

COMMENT ON TABLE super_retouch_checklist_items IS
  'Каталог под-опций конфигуратора «Супер обработки» (POS). DB-driven, редактируется без деплоя. addon_price=0 — закладка под платные под-опции.';

INSERT INTO super_retouch_checklist_items
  (group_slug, group_name, group_selection_type, group_sort_order, slug, name, hint, gender, sort_order, is_default)
VALUES
  -- Группа 1 — Стиль макияжа (single, female)
  ('makeup-style','Стиль макияжа','single',10,'makeup-style-none','Без макияжа','Ретушь только кожи, без добавления макияжа','female',1,false),
  ('makeup-style','Стиль макияжа','single',10,'makeup-style-nude','Нюд / натуральный','Максимально естественный вид, усиливает природные черты','female',2,true),
  ('makeup-style','Стиль макияжа','single',10,'makeup-style-day','Дневной / деловой','Нейтральная палитра, аккуратные линии, минимум блеска','female',3,false),
  ('makeup-style','Стиль макияжа','single',10,'makeup-style-evening','Вечерний / праздничный','Насыщенные тона, яркий акцент на одну зону','female',4,false),
  ('makeup-style','Стиль макияжа','single',10,'makeup-style-smoky','Смоки / драматичный','Тёмные дымчатые тени, акцент на глаза, нейтральные губы','female',5,false),
  ('makeup-style','Стиль макияжа','single',10,'makeup-style-romantic','Романтичный / нежный','Мягкие розовые и персиковые тона, лёгкое сияние','female',6,false),
  ('makeup-style','Стиль макияжа','single',10,'makeup-style-editorial','Редакционный / модный','Чёткие линии, авангардные акценты, фэшн-подход','female',7,false),
  -- Группа 2 — Акценты макияжа (multi, any)
  ('makeup-accent','Акценты макияжа','multi',20,'accent-eyes','Акцент на глаза','Усилить выразительность глаз (тени, подводка, тушь)','any',1,false),
  ('makeup-accent','Акценты макияжа','multi',20,'accent-lips','Акцент на губы','Более яркая/насыщенная помада или глосс','any',2,false),
  ('makeup-accent','Акценты макияжа','multi',20,'accent-brows','Акцент на брови','Более чёткие, насыщенные брови','any',3,false),
  ('makeup-accent','Акценты макияжа','multi',20,'accent-cheeks','Акцент на скулы','Лёгкий румянец или контуринг по скулам','any',4,false),
  ('makeup-accent','Акценты макияжа','multi',20,'accent-nose','Коррекция носа','Визуально скорректировать нос светом/тенью','any',5,false),
  ('makeup-accent','Акценты макияжа','multi',20,'accent-jawline','Чёткость овала','Подчеркнуть или скорректировать линию нижней челюсти','any',6,false),
  -- Группа 3 — Тени / техника глаз (single, female)
  ('eye-shadow','Тени / техника глаз','single',30,'eye-shadow-none','Без теней','Только тушь и/или подводка, тени не добавляются','female',1,false),
  ('eye-shadow','Тени / техника глаз','single',30,'eye-shadow-soft','Мягкие нейтральные','Пастельные тона (бежевый, розовый, тауп), лёгкая растушёвка','female',2,true),
  ('eye-shadow','Тени / техника глаз','single',30,'eye-shadow-dark','Тёмные / глубокие','Тёмно-коричневый, серый, синий — выразительность и глубина','female',3,false),
  ('eye-shadow','Тени / техника глаз','single',30,'eye-shadow-light','Светлые / сияющие','Жемчужный, шампань, золотой — распахивают взгляд','female',4,false),
  ('eye-shadow','Тени / техника глаз','single',30,'eye-shadow-ombre','Омбре (градиент)','Переход от тёмного у ресниц к светлому к брови','female',5,false),
  ('eye-shadow','Тени / техника глаз','single',30,'eye-shadow-cut-crease','Cut Crease','Чёткая линия складки века с контрастным акцентом','female',6,false),
  ('eye-shadow','Тени / техника глаз','single',30,'eye-shadow-cat-eye','Кошачий взгляд','Тени и стрелка вытянуты к внешнему углу','female',7,false),
  ('eye-shadow','Тени / техника глаз','single',30,'eye-shadow-smoky','Смоки-айз','Дымчатая растушёвка, эффект «дыма»','female',8,false),
  -- Группа 4 — Стрелки / подводка (single, any)
  ('eye-liner','Стрелки / подводка','single',40,'eye-liner-none','Без стрелок','Подводка не добавляется','any',1,false),
  ('eye-liner','Стрелки / подводка','single',40,'eye-liner-thin','Тонкая классическая','Тонкая линия по ресничному краю','any',2,true),
  ('eye-liner','Стрелки / подводка','single',40,'eye-liner-arrow','Стрелки (флик)','Чёткая стрелка с кончиком','any',3,false),
  ('eye-liner','Стрелки / подводка','single',40,'eye-liner-bold','Широкая / выразительная','Плотная линия, визуально увеличивает глаз','any',4,false),
  ('eye-liner','Стрелки / подводка','single',40,'eye-liner-lower','Нижнее веко','Тонкая растушёвка по нижнему веку','any',5,false),
  ('eye-liner','Стрелки / подводка','single',40,'eye-liner-both','Обвод вокруг','Подводка верхнего и нижнего века','any',6,false),
  -- Группа 5 — Губы (single, female)
  ('lips','Губы','single',50,'lips-none','Без изменений','Не корректировать цвет губ','female',1,false),
  ('lips','Губы','single',50,'lips-nude','Нюд / натуральный','Телесный, розово-бежевый — «как кожа»','female',2,true),
  ('lips','Губы','single',50,'lips-pink','Розовый / нежный','Светло-розовый оттенок','female',3,false),
  ('lips','Губы','single',50,'lips-coral','Коралловый / персиковый','Тёплый коралл или персик','female',4,false),
  ('lips','Губы','single',50,'lips-berry','Ягодный / бордо','Насыщенный вишнёво-бордовый','female',5,false),
  ('lips','Губы','single',50,'lips-red','Красный классический','Чёткий красный с контуром','female',6,false),
  ('lips','Губы','single',50,'lips-plum','Сливовый / тёмный','Глубокие тёмные тона','female',7,false),
  ('lips','Губы','single',50,'lips-gloss','С блеском','Добавить глянцевое сияние к оттенку','female',8,false),
  -- Группа 6 — Тон кожи / основа (multi, any)
  ('skin-tone','Тон кожи / основа','multi',60,'skin-tone-even','Выровнять тон','Убрать красноту, желтизну, неравномерность','any',1,true),
  ('skin-tone','Тон кожи / основа','multi',60,'skin-tone-glare','Убрать блики','Устранить жирный блеск на лбу/носу/щеках','any',2,true),
  ('skin-tone','Тон кожи / основа','multi',60,'skin-tone-matte','Матовый эффект','Кожа без сияния — для официальных документов','any',3,false),
  ('skin-tone','Тон кожи / основа','multi',60,'skin-tone-glow','Сияющий эффект','Здоровое лёгкое свечение, стробинг','any',4,false),
  ('skin-tone','Тон кожи / основа','multi',60,'skin-tone-warm','Тёплый оттенок','Добавить тёплый подтон (золотистый/персиковый)','any',5,false),
  ('skin-tone','Тон кожи / основа','multi',60,'skin-tone-cool','Холодный оттенок','Добавить холодный подтон (розовый/нейтральный)','any',6,false),
  ('skin-tone','Тон кожи / основа','multi',60,'skin-tone-dark-circles','Убрать круги под глазами','Осветлить синеву под глазами','any',7,false),
  ('skin-tone','Тон кожи / основа','multi',60,'skin-tone-redness','Убрать покраснения','Розацеа, купероз, локальные покраснения','any',8,false),
  -- Группа 7 — Кожа: коррекция (multi, any)
  ('skin-correction','Кожа — коррекция','multi',70,'skin-acne','Прыщи / высыпания','Убрать воспаления и прыщики','any',1,true),
  ('skin-correction','Кожа — коррекция','multi',70,'skin-blemish','Пятна / пигментация','Убрать пятна, пигмент, неровности цвета','any',2,true),
  ('skin-correction','Кожа — коррекция','multi',70,'skin-wrinkles-soft','Морщины (смягчить)','Сгладить морщины с сохранением текстуры кожи','any',3,false),
  ('skin-correction','Кожа — коррекция','multi',70,'skin-wrinkles-full','Морщины (убрать)','Убрать морщины максимально','any',4,false),
  ('skin-correction','Кожа — коррекция','multi',70,'skin-moles-keep','Родинки оставить','Не трогать родинки и пигментные пятна','any',5,false),
  ('skin-correction','Кожа — коррекция','multi',70,'skin-moles-remove','Родинки убрать','Убрать все видимые родинки и пятнышки','any',6,false),
  ('skin-correction','Кожа — коррекция','multi',70,'skin-pores','Поры / текстура','Смягчить поры без пластикового эффекта','any',7,false),
  ('skin-correction','Кожа — коррекция','multi',70,'skin-scars','Шрамы / следы','Убрать постакне, шрамы, следы от операций','any',8,false),
  ('skin-correction','Кожа — коррекция','multi',70,'skin-under-eye-bags','Мешки под глазами','Убрать припухлость под нижним веком','any',9,false),
  -- Группа 8 — Брови (multi, any)
  ('brows','Брови','multi',80,'brows-fill-gaps','Заполнить пробелы','Закрасить просветы, сделать брови сплошными','any',1,true),
  ('brows','Брови','multi',80,'brows-thicker','Гуще / пышнее','Добавить объём, нарисовать волоски','any',2,false),
  ('brows','Брови','multi',80,'brows-thinner','Тоньше / аккуратнее','Убрать лишние волоски, изящная форма','any',3,false),
  ('brows','Брови','multi',80,'brows-arch','Подчеркнуть изгиб','Усилить дугу, выразительная форма','any',4,false),
  ('brows','Брови','multi',80,'brows-straight','Прямые брови','Сделать брови прямее — молодёжный образ','any',5,false),
  ('brows','Брови','multi',80,'brows-darken','Темнее / насыщеннее','Усилить цвет и чёткость линии','any',6,false),
  ('brows','Брови','multi',80,'brows-lighten','Светлее / мягче','Осветлить для нежного образа','any',7,false),
  ('brows','Брови','multi',80,'brows-symmetry','Симметрия','Выровнять асимметрию между бровями','any',8,false),
  -- Группа 9 — Ресницы (multi, any)
  ('lashes','Ресницы','multi',90,'lashes-upper-volume','Верхние — объём','Сделать верхние ресницы гуще и длиннее','any',1,true),
  ('lashes','Ресницы','multi',90,'lashes-lower-add','Нижние — добавить','Нарисовать/усилить нижние ресницы','any',2,false),
  ('lashes','Ресницы','multi',90,'lashes-curl','Изгиб / подкрутка','Усилить изгиб ресниц вверх','any',3,false),
  ('lashes','Ресницы','multi',90,'lashes-clean','Почистить тушь','Убрать потёки и осыпь туши','any',4,false),
  ('lashes','Ресницы','multi',90,'lashes-separate','Разлепить','Разделить слипшиеся ресницы','any',5,false),
  -- Группа 10 — Волосы (multi, any)
  ('hair','Волосы','multi',100,'hair-flyaways','Убрать пряди','Убрать выбивающиеся и торчащие волоски','any',1,true),
  ('hair','Волосы','multi',100,'hair-smooth','Гладкость / блеск','Добавить гладкость, убрать пушистость','any',2,true),
  ('hair','Волосы','multi',100,'hair-volume','Объём','Добавить объём у корней, пышность','any',3,false),
  ('hair','Волосы','multi',100,'hair-waves','Волны / форма','Подчеркнуть или добавить волнистую текстуру','any',4,false),
  ('hair','Волосы','multi',100,'hair-gray-hide','Скрыть седину','Затемнить и закрасить проседь','any',5,false),
  ('hair','Волосы','multi',100,'hair-gray-keep','Сохранить седину','Не корректировать седину','any',6,false),
  ('hair','Волосы','multi',100,'hair-color-warm','Тёплый оттенок','Золотистый, каштановый или тёплый тон','any',7,false),
  ('hair','Волосы','multi',100,'hair-color-cool','Холодный оттенок','Убрать желтизну, пепельный отлив','any',8,false),
  ('hair','Волосы','multi',100,'hair-roots','Спрятать корни','Закрасить отросшие корни','any',9,false),
  ('hair','Волосы','multi',100,'hair-shine','Зеркальный блеск','Максимальный блеск — для модных фото','any',10,false),
  -- Группа 11 — Мужская одежда (single, male)
  ('mens-clothing','Мужская одежда','single',110,'mens-none','Без замены','Оставить как есть, чистка одежды при необходимости','male',1,false),
  ('mens-clothing','Мужская одежда','single',110,'mens-shirt-white','Белая рубашка','Классическая белая рубашка с воротником','male',2,true),
  ('mens-clothing','Мужская одежда','single',110,'mens-shirt-blue','Голубая рубашка','Голубая деловая рубашка','male',3,false),
  ('mens-clothing','Мужская одежда','single',110,'mens-shirt-business','Деловая рубашка','Сдержанные тона без галстука','male',4,false),
  ('mens-clothing','Мужская одежда','single',110,'mens-suit-jacket','Пиджак (без галстука)','Тёмный пиджак + рубашка, Smart Casual','male',5,false),
  ('mens-clothing','Мужская одежда','single',110,'mens-suit-tie','Костюм с галстуком','Тёмный костюм + рубашка + галстук, Business Formal','male',6,false),
  ('mens-clothing','Мужская одежда','single',110,'mens-suit-three','Костюм-тройка','Пиджак + жилет + брюки','male',7,false),
  ('mens-clothing','Мужская одежда','single',110,'mens-turtleneck','Водолазка','Облегающая водолазка — современный образ','male',8,false),
  ('mens-clothing','Мужская одежда','single',110,'mens-tuxedo','Смокинг','Чёрный смокинг + атласный галстук, Black Tie','male',9,false),
  ('mens-clothing','Мужская одежда','single',110,'mens-tuxedo-bowtie','Смокинг с бабочкой','Чёрный смокинг + галстук-бабочка','male',10,false),
  -- Группа 12 — Женская одежда (single, female)
  ('womens-clothing','Женская одежда','single',120,'womens-none','Без замены','Оставить как есть','female',1,false),
  ('womens-clothing','Женская одежда','single',120,'womens-blouse-white','Белая блузка','Классическая белая блузка','female',2,true),
  ('womens-clothing','Женская одежда','single',120,'womens-blouse-pastel','Пастельная блузка','Голубой, лиловый, светло-розовый','female',3,false),
  ('womens-clothing','Женская одежда','single',120,'womens-jacket-dark','Тёмный деловой жакет','Чёрный/тёмно-серый/синий жакет','female',4,false),
  ('womens-clothing','Женская одежда','single',120,'womens-jacket-color','Цветной жакет','Бордо, изумруд, терракота','female',5,false),
  ('womens-clothing','Женская одежда','single',120,'womens-dress-sheath','Платье-футляр','Прямое приталенное платье','female',6,false),
  ('womens-clothing','Женская одежда','single',120,'womens-suit','Брючный / юбочный костюм','Пиджак + брюки или юбка-карандаш','female',7,false),
  ('womens-clothing','Женская одежда','single',120,'womens-turtleneck','Водолазка','Приталенная водолазка','female',8,false),
  ('womens-clothing','Женская одежда','single',120,'womens-collarless','Без воротника (бизнес-casual)','Однотонный топ или жакет без воротника','female',9,false),
  -- Группа 13 — Фон (single, any)
  ('background','Фон','single',130,'bg-none','Оставить как есть','Не трогать фон','any',1,false),
  ('background','Фон','single',130,'bg-white','Белый','Чистый белый фон — стандарт для документов','any',2,true),
  ('background','Фон','single',130,'bg-gray-light','Светло-серый','Нейтральный серый — для деловых фото','any',3,false),
  ('background','Фон','single',130,'bg-gray-dark','Тёмно-серый','Более представительный серый фон','any',4,false),
  ('background','Фон','single',130,'bg-blue-passport','Голубой (паспорт/виза)','Стандартный голубой для паспортных фото','any',5,false),
  ('background','Фон','single',130,'bg-red-passport','Красный (США/UK)','Красный фон для американских/британских документов','any',6,false),
  ('background','Фон','single',130,'bg-beige','Бежевый / кремовый','Тёплый нейтральный фон','any',7,false),
  ('background','Фон','single',130,'bg-blur','Размытие (боке)','Размытый естественный фон — для портретов','any',8,false),
  ('background','Фон','single',130,'bg-custom','По образцу','Заменить на цвет по указанию (уточнить в комментарии)','any',9,false),
  -- Группа 14 — Цветокоррекция (single, any)
  ('color-grade','Цветокоррекция','single',140,'color-natural','Натуральный','Без цветового сдвига, близко к съёмке','any',1,true),
  ('color-grade','Цветокоррекция','single',140,'color-warm','Тёплый (золотистый)','Плёночный тёплый тон','any',2,false),
  ('color-grade','Цветокоррекция','single',140,'color-cool','Холодный (мягкий)','Слегка холодный нейтральный тон','any',3,false),
  ('color-grade','Цветокоррекция','single',140,'color-bright-contrast','Яркий / контрастный','Повышение насыщенности и контраста','any',4,false),
  ('color-grade','Цветокоррекция','single',140,'color-muted','Приглушённый (матовый)','Матовая тонировка, снижение насыщенности','any',5,false),
  ('color-grade','Цветокоррекция','single',140,'color-bw','Чёрно-белое','Перевод в ч/б + оптимизация тонов','any',6,false),
  ('color-grade','Цветокоррекция','single',140,'color-bw-warm','Тёплое ч/б (сепия)','Мягкое сепийное чёрно-белое','any',7,false),
  -- Группа 15 — Доп. пожелания (notes, any) — sentinel, текст хранится в выборе
  ('retoucher-notes','Дополнительные пожелания','notes',150,'retoucher-notes','Свободное поле','Нестандартные пожелания ретушёру (напр.: «убрать лямку», «сохранить родинку»)','any',1,false)
ON CONFLICT (slug) DO UPDATE SET
  group_slug           = EXCLUDED.group_slug,
  group_name           = EXCLUDED.group_name,
  group_selection_type = EXCLUDED.group_selection_type,
  group_sort_order     = EXCLUDED.group_sort_order,
  name                 = EXCLUDED.name,
  hint                 = EXCLUDED.hint,
  gender               = EXCLUDED.gender,
  sort_order           = EXCLUDED.sort_order,
  is_default           = EXCLUDED.is_default,
  updated_at           = now();

COMMIT;

-- ===================== Транзакция 2: CHECK work_tasks.retouch_level =====================
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'work_tasks_retouch_level_check'
      AND pg_get_constraintdef(oid) NOT LIKE '%super%'
  ) THEN
    ALTER TABLE work_tasks DROP CONSTRAINT work_tasks_retouch_level_check;
    ALTER TABLE work_tasks ADD CONSTRAINT work_tasks_retouch_level_check
      CHECK (retouch_level IS NULL OR retouch_level IN ('basic','extended','maximum','super'));
  END IF;
END $$;

COMMIT;
