-- Seed employee instruction for education/student verification into Knowledge Base.
-- Idempotent: categories are upserted, the instruction entity is refreshed by slug.

DO $$
BEGIN
  IF to_regclass('public.kb_categories') IS NULL OR to_regclass('public.kb_entities') IS NULL THEN
    RAISE NOTICE 'KB tables are absent; skipping education verification instruction seed';
    RETURN;
  END IF;

  INSERT INTO kb_categories (slug, name, description, icon, sort_order, depth, path)
  VALUES (
    'instructions',
    'Инструкции',
    'Рабочие инструкции, регламенты и ответы для сотрудников',
    'menu_book',
    15,
    0,
    'instructions'
  )
  ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      icon = EXCLUDED.icon,
      sort_order = EXCLUDED.sort_order,
      depth = EXCLUDED.depth,
      path = EXCLUDED.path,
      is_active = TRUE,
      updated_at = NOW();

  INSERT INTO kb_categories (parent_id, slug, name, description, icon, sort_order, depth, path)
  SELECT
    parent.id,
    'instructions-education',
    'Образование',
    'Инструкции по студенческой программе, документам и образовательным скидкам',
    'school',
    1,
    1,
    'instructions/education'
  FROM kb_categories parent
  WHERE parent.slug = 'instructions'
  ON CONFLICT (slug) DO UPDATE
  SET parent_id = EXCLUDED.parent_id,
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      icon = EXCLUDED.icon,
      sort_order = EXCLUDED.sort_order,
      depth = EXCLUDED.depth,
      path = EXCLUDED.path,
      is_active = TRUE,
      updated_at = NOW();

  INSERT INTO kb_entities (
    category_id,
    entity_type,
    slug,
    status,
    visibility,
    name,
    summary,
    content,
    metadata,
    tags,
    source_type,
    source_ref,
    confidence,
    is_verified
  )
  SELECT
    category.id,
    'process',
    'instruction-education-student-verification',
    'active',
    'internal',
    'Инструкция: проверка студентов в пульте',
    'Как сотруднику проверять студентов: фото-верификация, очная заявка на точке, поля формы и правила подтверждения.',
    $content$# Как проверять студентов в пульте

Инструкция описывает два рабочих сценария: проверка заявок, которые студент отправил сам через фото документа, и очное заверение документа сотрудником на точке.

## Короткий чек-лист перед подтверждением

1. Найдите клиента.
   Для очной заявки ищите только по полному номеру телефона. Для фото-заявок используйте очередь и фильтр статуса.

2. Сверьте документ.
   Проверьте, что документ относится к студенту, учебное заведение указано верно, а срок действия не истек.

3. Завершите проверку.
   Подтверждайте только после сверки. Студент должен увидеть данные у себя в телефоне и подтвердить их.

## Сценарий 1. Фото-верификация

Этот режим нужен для заявок, где студент сам отправил фото документа на проверку.

1. Откройте очередь.
   В разделе «Фото-верификация студентов» выберите вкладку «Фото». Слева отображается список заявок в выбранном статусе, справа открывается карточка выбранной заявки.

2. Проверьте фильтр.
   Статус «На проверке» показывает заявки, которые ждут решения сотрудника. Если список пустой, значит в выбранном статусе сейчас нет заявок.

3. Откройте заявку.
   Нажмите на заявку в левом списке. Проверьте данные студента и документ в правой части экрана. Если фото не читается или данные не совпадают, не подтверждайте заявку.

Кнопка «Обновить» перечитывает очередь. Используйте ее, если студент только что отправил документ или вы вернулись к пульту после паузы.

## Сценарий 2. Очная заявка на точке

Этот режим нужен, когда студент пришел лично и показывает оригинал документа сотруднику.

1. Переключитесь на «На точке».
   В верхней правой части экрана выберите вкладку «На точке». В этом режиме создается очная заявка без загрузки фото документа.

2. Проверьте оригинал.
   Сотрудник должен увидеть оригинал студенческого документа. Не заверяйте документ по фотографии в телефоне, скриншоту, копии или словам клиента.

3. Заполните форму.
   Внесите данные ровно так, как они указаны в документе. Если студент уже есть в системе, используйте полный номер телефона для поиска.

4. Нажмите «Заверить документ».
   После заверения студент увидит данные в своем телефоне. Скидка не включится, пока студент не подтвердит эти данные.

## Поля очной заявки

- Телефон клиента: полный номер, на который студент войдет по OTP и получит подтверждение.
- Учебное заведение: название организации из документа.
- Роль: обычно «Студент». Меняйте только если документ подтверждает другую доступную роль.
- Документ: тип предъявленного документа, например студенческий билет или справка об обучении.
- Действует до: дата окончания действия документа. Если срок истек, заявку подтверждать нельзя.
- Откуда узнал: источник обращения клиента. Если клиент пришел сам, оставьте соответствующий вариант.
- Телефон пригласившего: заполняется только для реферала. Если номер совпадает с клиентом, реферал не засчитывается.

## Можно подтверждать

- Документ читается, данные совпадают с клиентом.
- Учебное заведение и тип документа указаны корректно.
- Срок действия документа не истек.
- Для очной заявки сотрудник видел оригинал документа.

## Нельзя подтверждать

- Фото размытое, обрезанное или не позволяет прочитать данные.
- Клиент показывает только скриншот, копию или чужой документ.
- Телефон введен не полностью или принадлежит другому человеку.
- Документ просрочен или данные в форме не совпадают с документом.

Если сомневаетесь, не подтверждайте заявку сразу. Попросите клиента показать оригинал, отправить новое читаемое фото или обратитесь к старшему сотруднику.$content$,
    jsonb_build_object(
      'audience', 'employee',
      'module', 'student_verification',
      'ui_route', '/employee/student-verifications',
      'last_reviewed_at', '2026-06-26',
      'questions', jsonb_build_array(
        'Как проверить студента?',
        'Как заверить студенческий документ на точке?',
        'Что делать, если фото студенческого не читается?',
        'Когда нельзя подтверждать студента?',
        'Почему скидка не включилась после заверения?'
      ),
      'screenshots', jsonb_build_array(
        jsonb_build_object(
          'src', '/assets/static/kb/education-verification/photo-queue.png',
          'alt', 'Пульт с вкладкой Фото, поиском, фильтром На проверке и пустой очередью заявок',
          'caption', 'Фото-верификация: вкладка «Фото», поиск, фильтр статуса и список заявок слева.'
        ),
        jsonb_build_object(
          'src', '/assets/static/kb/education-verification/on-site-form.png',
          'alt', 'Форма Студенческая программа на точке с полями телефона, учебного заведения, роли, документа и срока действия',
          'caption', 'Очная заявка: документ заверяет сотрудник, фото документа не требуется.'
        )
      )
    ),
    ARRAY[
      'инструкция',
      'сотрудники',
      'образование',
      'студенты',
      'студенческий',
      'верификация',
      'фото-верификация',
      'на точке',
      'скидка',
      'документ'
    ],
    'manual',
    'src/app/features/employee/components/student-verifications',
    1.0,
    TRUE
  FROM kb_categories category
  WHERE category.slug = 'instructions-education'
  ON CONFLICT (slug) DO UPDATE
  SET category_id = EXCLUDED.category_id,
      entity_type = EXCLUDED.entity_type,
      status = EXCLUDED.status,
      visibility = EXCLUDED.visibility,
      name = EXCLUDED.name,
      summary = EXCLUDED.summary,
      content = EXCLUDED.content,
      metadata = EXCLUDED.metadata,
      tags = EXCLUDED.tags,
      source_type = EXCLUDED.source_type,
      source_ref = EXCLUDED.source_ref,
      confidence = EXCLUDED.confidence,
      is_verified = EXCLUDED.is_verified,
      updated_at = NOW();
END $$;
