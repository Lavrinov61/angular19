# Архитектура студенческого аккаунта

Дата: 2026-05-02

## Решение

Студенческий статус должен быть свойством аккаунта пользователя, а не свойством конкретной страницы, ссылки или регистрации. Канонический пользовательский flow: человек входит в личный кабинет, открывает раздел студенческого статуса, подтверждает телефон при необходимости, загружает фото студенческого документа, ожидает проверку сотрудником, после одобрения получает account-level льготу.

`/students` остается публичной маркетинговой страницей про условия. Она может вести пользователя в нужный раздел личного кабинета, но не должна передавать бизнес-токен и не должна быть единственным способом подключения студенческого аккаунта.

## Что проверено в БД

Проверены миграции `139_student_discount_entitlements.sql` и `140_student_verification_monthly_allowance.sql`, generated-типы Kanel и фактическая схема локальной БД `magnus_photo_db` через `information_schema`, `pg_indexes` и `pg_constraint`.

В фактической БД присутствуют таблицы:

- `student_accounts`
- `student_verifications`
- `student_discount_entitlements`
- `student_allowance_periods`
- `student_discount_redemptions`
- `pos_receipt_items.print_fill_percent`

Ключевые ограничения уже правильные для account-level модели:

- `student_accounts.user_id` уникален: один студенческий аккаунт на пользователя.
- `student_verifications` хранит историю заявок и имеет partial unique index на одну pending-заявку на пользователя.
- `student_discount_entitlements.user_id` уникален: одна активируемая льгота на пользователя.
- `student_discount_entitlements.student_account_id` связывает льготу с проверенным студенческим аккаунтом.
- `student_allowance_periods` уникален по `(entitlement_id, period_start)`: месячный лимит не дублируется.
- `student_allowance_periods.sheets_used <= sheet_limit` защищен constraint-ом.
- `student_discount_redemptions` хранит аудит примененных льгот в POS и online print.

Проверенные агрегаты живой БД не показали нарушений инвариантов:

- pending-дубликатов заявок: 0.
- allowance-period строк с `sheets_used > sheet_limit`: 0.
- active entitlement без verified account: 0.
- verified account без active entitlement: 0.
- approved verification с неверифицированным account: 0.

На момент проверки таблицы студенческого статуса пустые, поэтому архитектура должна учитывать миграцию UX без необходимости мигрировать существующих студентов.

## Текущая проблема

В коде уже есть правильное ядро:

- заявка создается через `POST /api/student-verifications/uploads/complete`;
- проверка сотрудником идет через `/api/student-verifications/admin`;
- approve переводит `student_accounts.status` в `verified`;
- approve создает или обновляет `student_discount_entitlements` с `source_token = 'photo_verification'`;
- pricing engine и POS применяют льготу только если entitlement связан с verified `student_accounts`;
- scheduler истекает аккаунты, provision-ит месячные лимиты и чистит фотографии документов.

Неправильная часть находится в UX/auth-обвязке:

- `/students` передает `student_offer=student-2026`;
- auth UI показывает текст, будто скидка включится после регистрации по этой ссылке;
- email/phone auth принимают `student_offer_token`;
- `activateStudentDiscountForUser()` сейчас фактически не создает entitlement без verified account, но сам контракт сохраняет старую идею "активации по ссылке".

Это создает ложную архитектурную зависимость: пользователь думает, что должен зарегистрироваться через конкретную страницу, хотя реальная бизнес-логика уже требует фото-подтверждение.

## Целевая модель

### Доменные объекты

`student_accounts` - canonical статус студента на аккаунте.

- Владелец: backend student-account/student-verification domain.
- Ключ: `user_id`.
- Не зависит от source page.
- Используется для принятия решения: может ли пользователь получать студенческие льготы.

`student_verifications` - заявки и аудит документов.

- Владелец: backend verification workflow.
- Каждая запись - одна попытка подтверждения.
- Хранит S3 key, mime type, размер, учебное заведение, срок документа, reviewer, reject reason, retention.
- Может быть много исторических заявок, но только одна pending на пользователя.

`student_discount_entitlements` - право на конкретные льготы и counters.

- Владелец: pricing/POS benefits domain.
- Создается только после успешной проверки документа или ручного админ-действия.
- Не является источником истины о том, студент ли пользователь. Источник истины - `student_accounts`.
- Для применения обязана ссылаться на verified `student_account_id`.

`student_allowance_periods` - месячный лимит печати.

- Владелец: pricing/POS benefits domain.
- Создается при approve и scheduler-ом на новый месяц.
- Хранит лимит 100 листов и цену 3 рубля для A4 ч/б.

`student_discount_redemptions` - ledger применения льгот.

- Владелец: POS/online print domain.
- Хранит receipt/order, тип льготы, units, discount amount, fill percent, metadata.
- Нужен для аудита и корректного refund-а.

### State machine аккаунта

`none` - у пользователя еще нет `student_accounts`.

- UI показывает возможность подключить студенческий аккаунт.
- Submit создает `student_accounts(status='pending')` и `student_verifications(status='pending')`.

`pending` - документ отправлен и ждет проверки.

- UI показывает статус ожидания.
- Новую pending-заявку отправить нельзя.
- Сотрудник может approve или reject.

`verified` - студент подтвержден.

- UI показывает дату окончания и лимиты.
- Pricing/POS может применять льготу.
- Повторная заявка допустима только как продление, если мы явно добавим такой flow. В текущем коде verified account при submit остается verified, но создается новая pending verification. Это нужно оставить осознанно или закрыть отдельным правилом "продлить статус".

`rejected` - заявка отклонена.

- UI показывает причину.
- Пользователь может отправить новую заявку после исправления.

`expired` - срок документа или подтверждения истек.

- UI предлагает повторно подтвердить статус.
- Scheduler переводит active entitlement в expired.

`revoked` - статус отозван сотрудником.

- UI не дает обычную повторную отправку.
- Дальнейшее восстановление только через сотрудника.

### State machine заявки

`pending` -> `approved`.

- Сотрудник указал дату окончания.
- Account становится `verified`.
- Entitlement становится `active`.
- Создается текущий allowance period.

`pending` -> `rejected`.

- Сотрудник указал причину.
- Account становится `rejected`, если он не был `verified`.
- Фото хранится до retention date.

`pending` -> `cancelled`.

- Нужен для будущей возможности отменить заявку пользователем или системой.
- Сейчас в API публичного cancel нет, статус уже заложен в БД.

## Целевой пользовательский flow

### 1. Вход в личный кабинет

Пользователь может прийти из любого места:

- профиль;
- раздел аккаунта;
- `/students`;
- POS/ссылка от сотрудника;
- будущий баннер в заказах;
- прямой URL.

Единственный canonical return URL: `/user-profile/student`.

Если пользователь не авторизован, frontend делает обычный auth redirect:

`/auth/login?returnUrl=/user-profile/student`

Никаких `student_offer`, `student_offer_token` и логики "зарегистрировался по спецссылке".

### 2. Проверка prerequisites

Перед отправкой заявки нужны:

- авторизованный пользователь;
- заполненное отображаемое имя, если текущий auth flow этого требует;
- подтвержденный телефон.

Телефон нужен не как "регистрация по телефону", а как надежная связка аккаунта с POS lookup: касса ищет студенческую льготу по номеру клиента. Для email/OAuth пользователей раздел должен предложить подтвердить телефон внутри личного кабинета и вернуться на `/user-profile/student`.

### 3. Подключение студенческого аккаунта

Форма в личном кабинете:

- учебное заведение;
- срок действия документа, если указан на документе;
- фото студенческого документа.

После submit:

1. frontend запрашивает presigned upload;
2. файл загружается в S3;
3. frontend вызывает complete endpoint;
4. backend создает или обновляет `student_accounts`;
5. backend создает `student_verifications(status='pending')`;
6. UI показывает pending-состояние.

### 4. Проверка сотрудником

Сотрудник работает в `/employee/student-verifications`.

Approve:

- переводит verification в `approved`;
- переводит account в `verified`;
- выставляет `verified_at`, `expires_at`, `reviewer_id`;
- upsert-ит entitlement с `source_token='photo_verification'`;
- создает allowance period.

Reject:

- переводит verification в `rejected`;
- ставит reject reason;
- account становится `rejected`, если до этого не был verified.

Revoke:

- переводит account в `revoked`;
- active entitlement становится `revoked`.

### 5. Применение льгот

Pricing/POS не должны знать, с какой страницы пришел пользователь.

Условие применения:

- найден active entitlement;
- entitlement связан с `student_accounts`;
- account `verified`;
- `expires_at` не истек;
- для A4 ч/б указан fill percent <= 15%;
- в текущем allowance period остались листы;
- для переплета остался лимит.

## API-архитектура

Существующий backend route `/api/student-verifications` можно оставить как технический upload/review API, но frontend лучше мыслить через domain service `StudentAccountService`.

Рекомендуемый публичный контракт:

- `GET /api/student-account/me`
- `POST /api/student-account/uploads/presign`
- `POST /api/student-account/uploads/complete`
- `POST /api/student-account/renew` - только если отдельно вводим продление

На первом этапе можно не менять backend route и сделать frontend service facade:

- `StudentAccountService.loadMine()` вызывает `StudentVerificationService.loadMine()`;
- `StudentAccountService.submitVerification()` вызывает текущий presign/upload/complete;
- UI не импортирует `StudentVerificationService` напрямую.

Так мы отделим продуктовую архитектуру от текущего имени API и избежим массового backend churn.

Admin API может остаться:

- `GET /api/student-verifications/admin`
- `POST /api/student-verifications/admin/:id/approve`
- `POST /api/student-verifications/admin/:id/reject`
- `POST /api/student-verifications/admin/accounts/:accountId/revoke`

## Frontend-архитектура

### Канонический route

Добавить route:

`/user-profile/student`

Он должен жить внутри `ProfileShellComponent`, рядом с `/user-profile/account`, `/user-profile/subscription`, `/user-profile/loyalty`.

Раздел в навигации:

- label: `Студент`
- icon: `school`
- место: в `moreTabs` или в `primaryTabs`, если хотим сделать льготу видимой.

### Компоненты

Рекомендуемые компоненты:

- `StudentAccountComponent` - route component и orchestrator.
- `StudentAccountStatusPanelComponent` - статус account + discount summary.
- `StudentVerificationFormComponent` - форма заявки и upload.
- `StudentPrerequisitesPanelComponent` - телефон/профиль prerequisites.

На первом этапе можно начать с одного route component, но форму и статус лучше быстро вынести, чтобы `/students` не копировал кабинетную бизнес-логику.

### `/students`

`StudentsComponent` должен стать маркетинговым экраном:

- показывает условия;
- если пользователь не вошел, CTA ведет в `/auth/login?returnUrl=/user-profile/student`;
- если пользователь вошел, CTA ведет в `/user-profile/student`;
- не содержит форму загрузки документа как основной источник flow;
- не передает `student_offer`.

Можно временно оставить краткий виджет статуса, но он должен ссылаться на `/user-profile/student`, а не выполнять весь submit flow на публичной странице.

### Auth UI

Удалить из auth UI:

- чтение query param `student_offer`;
- `hasStudentOffer()`;
- текст "скидка включится после регистрации по этой ссылке";
- передачу `student_offer_token` из `AuthService.register()` и `verifyPhoneCode()`.

Auth должен отвечать только за сессию, профиль и returnUrl.

## Backend-архитектура

### Что оставить

`student-verification.service.ts` уже близок к нужной архитектуре:

- `getMyStudentVerificationStatus()`;
- `submitStudentVerification()`;
- `approveStudentVerification()`;
- `rejectStudentVerification()`;
- `revokeStudentAccount()`;
- `expireStudentAccounts()`;
- `provisionStudentAllowancePeriods()`;
- `cleanupExpiredStudentVerificationPhotos()`.

`student-discount.service.ts` уже правильно проверяет verified account перед выдачей скидки.

### Что убрать или переосмыслить

`activateStudentDiscountForUser()` должен исчезнуть из auth flow. В текущем виде он ничего не активирует без verified account, но его наличие поддерживает неправильный mental model.

Варианты:

1. Удалить функцию и все вызовы из auth routes.
2. Оставить как deprecated wrapper только для обратной совместимости тестов, но не вызывать из регистрации/login.

`STUDENT_DISCOUNT_LINK_TOKEN` и `STUDENT_DISCOUNT_TOKENS` не должны участвовать в новом flow. Если нужны кампании, это аналитика источника перехода, а не бизнес-ключ активации.

### Проверка телефона

Backend submit должен проверять, что к аккаунту привязан телефон. Повторная проверка `phone_verified` для студенческой заявки не нужна: вход по телефону уже доказывает владение номером, а у legacy-профилей может быть `users.phone` при старом `phone_verified = false`.

Текущее правило:

- если `users.phone IS NULL` или пустой, `submitStudentVerification()` возвращает `409` с frontend prerequisite;
- если `users.phone` заполнен, заявку можно отправлять независимо от `users.phone_verified`;
- frontend показывает action "Добавить телефон" только когда номер отсутствует.

## DB-решение

Текущая схема уже подходит для правильной архитектуры. Крупная перестройка БД не нужна.

Нужны точечные будущие изменения:

1. Семантически устарел `student_discount_entitlements.source_token`.
   - Сейчас default: `student-2026`.
   - Для новых verified льгот уже используется `photo_verification`.
   - Рекомендуется в отдельной миграции добавить `source_type VARCHAR(40) NOT NULL DEFAULT 'photo_verification'` или переименовать поле после аудита зависимостей.

2. Нужен source только для аналитики заявки, не для активации.
   - Добавить опционально `student_verifications.submission_source VARCHAR(40)`.
   - Добавить опционально `student_verifications.submission_context JSONB NOT NULL DEFAULT '{}'::jsonb`.
   - Примеры source: `profile`, `students_page`, `employee_link`, `pos_prompt`.

3. Для продления стоит явно моделировать intent.
   - Либо разрешить pending verification при verified account как renewal.
   - Либо добавить `verification_type VARCHAR(20) CHECK ('initial','renewal')`.
   - Это не blocker для первого этапа, но нужно решить до реализации renewal UI.

4. Можно добавить audit timestamp для revoke.
   - Сейчас есть `revoke_reason`, но нет `revoked_at`.
   - Если нужен отчет по отзывам, добавить `revoked_at TIMESTAMPTZ`.

Не нужно добавлять:

- отдельный `student_profile` без необходимости;
- связь с `/students`;
- promo-code таблицы;
- entitlement при регистрации без проверки документа.

## План реализации

### Этап 1. Канонический кабинетный flow

- Добавить `/user-profile/student`.
- Добавить пункт навигации в личном кабинете.
- Перенести upload/status UX из `StudentsComponent` в кабинетный component/service.
- Добавить prerequisites UI для подтверждения телефона.
- `/students` переключить на CTA в кабинет.

### Этап 2. Развязать auth

- Удалить `student_offer` из `/students`.
- Удалить student offer notice из `PhoneLoginComponent`.
- Удалить передачу `student_offer_token` из frontend auth service.
- Удалить вызовы `activateStudentDiscountForUser()` из `auth.routes.ts` и `phone-auth.routes.ts`.
- Обновить тесты, чтобы auth больше не отвечал за студенческий статус.

### Этап 3. Backend guardrails

- Добавить проверку verified phone перед submit.
- Оставить approve/provision логику как source of truth.
- Добавить тесты на submit без verified phone, approve, reject, revoke.
- Сохранить POS/pricing поведение без изменений.

### Этап 4. DB cleanup

- Добавить migration для source semantics, если решим фиксировать аналитику.
- Обновить Kanel generated types.
- Убедиться, что legacy default `student-2026` больше не появляется в новых entitlement.

### Этап 5. Проверка

- Frontend unit tests для student account service/component.
- Backend vitest для student verification service.
- Narrow e2e/manual сценарии:
  - новый пользователь с телефоном отправляет заявку из кабинета;
  - email/OAuth пользователь без телефона видит prerequisite;
  - rejected пользователь может отправить новую заявку;
  - revoked пользователь не может отправить новую заявку;
  - approved account применяет POS student discount;
  - `/students` не является обязательным входом.

## Acceptance criteria

- Пользователь может подключить студенческий аккаунт из личного кабинета без посещения `/students`.
- `/students` не передает бизнес-токены и не обещает автоматическую скидку после регистрации.
- Auth flow не знает о студенческой программе, кроме обычного `returnUrl`.
- Студенческий статус появляется только после проверки фото документа.
- POS/pricing применяет льготу только по verified `student_accounts`.
- В БД сохраняется история заявок и audit применения скидок.
- Новая архитектура не ломает существующие employee approval и POS flows.

## Аналогия с Google/Microsoft

Да, правильная модель похожа на крупные платформы: educational/student eligibility является account-level entitlement, который пользователь подключает в аккаунте после проверки документов или через провайдера верификации. Маркетинговая страница может объяснять программу и вести к подключению, но сама страница не является источником права на статус.
