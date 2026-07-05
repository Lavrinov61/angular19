# Изменения по аккаунтам и 152-ФЗ от 16.05.2026

Базовый коммит по удалению аккаунта и согласиям: `a8dbc39c Add account deletion and privacy consent tracking`.

В этом же файле ниже добавлены свежие изменения по phone fallback, OTP-событиям и учёту недошедших звонков.

## Что добавлено

### 1. Удаление аккаунта пользователем

Добавлен endpoint `DELETE /api/users/me`.

Что делает:

- проверяет авторизацию текущего пользователя;
- анонимизирует запись пользователя вместо физического удаления строки;
- очищает телефон, фото, имя/фамилию, OAuth ID и другие внешние привязки;
- очищает `personal_data`, `preferences`, `linked_accounts`;
- сбрасывает `email_verified`, `phone_verified`, `accept_calls`, 2FA;
- выставляет `is_active = false`;
- удаляет refresh-токены, pending OAuth links и password reset tokens;
- инвалидирует auth cache;
- добавляет access tokens пользователя в blacklist;
- очищает auth cookies;
- пишет audit-событие `account_deleted_self`.

Затронутые файлы:

- `backend/src/routes/users.routes.ts`
- `backend/src/types/views/users-views.ts`
- `backend/src/routes/users.routes.test.ts`
- `src/app/core/services/auth.service.ts`

### 2. Исправление frontend-удаления аккаунта

Метод `AuthService.deleteAccount()` больше не считает операцию успешной автоматически.

Теперь frontend:

- вызывает `DELETE /api/users/me`;
- проверяет `response.success`;
- очищает локальную auth-сессию и уводит на login только после успешного ответа;
- выбрасывает понятную ошибку, если backend вернул failure.

Файл:

- `src/app/core/services/auth.service.ts`

### 3. Хранение согласий на обработку данных

Добавлена таблица `privacy_consents`.

Что хранится:

- `user_id`, если пользователь авторизован;
- `visitor_id`, если есть fingerprint/visitor id;
- тип документа, например `privacy_policy`;
- версия документа;
- scope согласия;
- источник согласия;
- флаг `accepted`;
- IP;
- user-agent;
- JSONB `details`;
- дата создания.

Миграция:

- `backend/database/migrations/zz_20260516_privacy_consents.sql`

### 4. API для фиксации согласий

Добавлен endpoint `POST /api/privacy/consents`.

Что делает:

- принимает версию документа, scope, source, visitorId и details;
- поддерживает необязательную авторизацию;
- если пользователь авторизован, привязывает согласие к `user_id`;
- пишет audit-событие `privacy_consent_recorded` для авторизованных пользователей;
- ограничивает частоту запросов через rate limit.

Файлы:

- `backend/src/routes/privacy-consents.routes.ts`
- `backend/src/services/privacy-consent.service.ts`
- `backend/src/types/jsonb/privacy-consent-jsonb.ts`
- `backend/src/types/views/privacy-consent-views.ts`
- `backend/src/app.ts`

### 5. Согласие при email-регистрации

Email-регистрация теперь может принимать объект `privacyConsent`.

При регистрации:

- schema валидирует согласие;
- `accepted = false` отклоняется;
- пользователь и согласие создаются в одной транзакции;
- в details добавляются `registrationMethod: email` и `uiSurface: register_form`.

Файлы:

- `backend/src/schemas/auth.schema.ts`
- `backend/src/routes/auth.routes.ts`
- `src/app/core/services/auth.service.ts`

### 6. Обновление политики конфиденциальности

Обновлена страница политики конфиденциальности.

Добавлено описание обработки:

- OAuth/social ID: VK, Яндекс ID, Google, Apple, Telegram, МТС ID;
- телефона и статусов подтверждения;
- заказов, оплат, доставки, комментариев и чатов;
- загруженных фото и файлов;
- cookies, visitor id, технической аналитики и записей сессий;
- OTP-звонков и технических данных телефонии;
- прав пользователя на удаление аккаунта.

Также добавлено уточнение, что фото используются для оказания услуги и не применяются для биометрической идентификации без отдельного основания и согласия.

Файл:

- `src/app/features/legal/privacy.component.ts`

### 7. Тесты

Добавлены тесты для `DELETE /users/me`.

Проверяется:

- 401 без авторизации;
- успешная анонимизация;
- очистка refresh/pending/reset токенов;
- blacklist токенов;
- инвалидирование auth cache;
- audit log;
- очистка auth cookies;
- 404, если пользователь исчез до анонимизации.

Файл:

- `backend/src/routes/users.routes.test.ts`

### 8. Phone fallback для OAuth/email-пользователей

Кнопка `Мне не приходит звонок` больше не является только локальным обходом в браузере.

Добавлен endpoint `POST /api/users/me/phone-requirement-skip`.

Что делает:

- доступен только авторизованному пользователю;
- запрещает обход, если телефон уже привязан;
- сохраняет в `users.preferences` поля `phoneRequirementSkippedAt`, `phoneRequirementSkipReason`, `phoneRequirementSkipSource`;
- инвалидирует auth cache;
- пишет audit-событие `phone_requirement_skipped`;
- если frontend передал введенный номер, пишет OTP-событие `phone_requirement_skipped`.

Frontend теперь:

- вызывает backend перед переходом дальше;
- сохраняет локальный fallback только после успешного ответа сервера;
- учитывает серверный `phoneRequirementSkippedAt` при загрузке профиля;
- показывает состояние загрузки на кнопке `Мне не приходит звонок`.

Файлы:

- `backend/src/routes/users.routes.ts`
- `backend/src/types/jsonb/user-jsonb.ts`
- `backend/src/types/views/users-views.ts`
- `backend/src/routes/users.routes.test.ts`
- `src/app/core/services/auth.service.ts`
- `src/app/core/services/auth.service.spec.ts`
- `src/app/features/auth/components/profile-completion/profile-completion.component.ts`

### 9. Таблица и сервис OTP-событий

Добавлена таблица `phone_otp_events`.

Что хранится:

- `user_id`, если известен;
- `verification_code_id`, если событие связано с конкретным кодом;
- HMAC-хэш телефона и последние 4 цифры;
- тип события;
- provider/request/session/caller id;
- fingerprint visitor id;
- IP и user-agent;
- JSONB `details`;
- дата создания.

Код OTP не сохраняется.

Типы событий:

- `code_requested`;
- `delivery_started`;
- `delivery_failed`;
- `verify_failed`;
- `verify_max_attempts`;
- `verified`;
- `call_history_resolved`;
- `call_not_reached`;
- `code_expired_or_missing`;
- `code_abandoned`;
- `phone_requirement_skipped`.

Миграция:

- `backend/database/migrations/zz_20260516_phone_otp_events.sql`

Файлы:

- `backend/src/services/phone-otp-event.service.ts`
- `backend/src/types/jsonb/phone-otp-event-jsonb.ts`
- `backend/src/types/views/phone-otp-event-views.ts`

### 10. Логирование OTP-прохода

В телефонной авторизации теперь фиксируются события:

- запрос кода;
- отказ из-за phone-level лимита;
- ошибка запуска звонка;
- успешный старт доставки;
- попытка проверить истекший/отсутствующий код;
- неверный код;
- исчерпание попыток;
- успешная проверка кода.

Для Voximplant call history дополнительно пишутся:

- `call_history_resolved`;
- `call_not_reached`, если звонок не был успешным или длительность звонка равна 0.

Файлы:

- `backend/src/routes/phone-auth.routes.ts`
- `backend/src/services/voice-otp-dispatcher.service.ts`

### 11. Брошенные OTP-коды

Cleanup истекших `verification_codes` теперь перед удалением фиксирует `code_abandoned`.

Это покрывает кейс: человек запросил код, но не ввел его до истечения срока.

Файлы:

- `backend/src/services/phone-otp-event.service.ts`
- `backend/src/scheduler.ts`
- `backend/src/server.ts`

## Что проверено

Команды, которые проходили после изменений:

```bash
git diff --check
cd backend && npx tsc --noEmit
npm run build:check
npx vitest run src/app/core/services/auth.service.spec.ts
cd backend && npx vitest run src/routes/users.routes.test.ts
./.codex/local-marketplaces/angular-dev-hookify/plugins/angular-dev-hookify/scripts/angular-dev-hookify.sh --changed
```

Известные предупреждения, не относящиеся к этому изменению:

- duplicate `skipLibCheck` в `backend/tsconfig.json`;
- Angular template warnings в `conversation-info-panel.component.ts`;
- Angular template warning в `infra-agent-detail.component.ts`.

## Что не делалось

- `deploy.sh` не запускался.
- Миграция не применялась на production вручную.
- Не менялись unrelated файлы `print-api/*`, `.cursorignore`, архивы и старые markdown-заметки.

## Что осталось следующим шагом

1. Выложить backend/frontend и применить миграции `zz_20260516_privacy_consents.sql` и `zz_20260516_phone_otp_events.sql`.
2. Добавить фактический retention cleanup для фото, рабочих файлов заказов, временных документов и старых логов.
3. Сделать consent-gate для аналитики и session replay до запуска необязательных трекеров.
4. Проверить публичные URL фото/файлов и закрыть чувствительные материалы через TTL/проверку прав.
5. Сделать CRM/админский отчет по `phone_otp_events`, чтобы поддержка видела недошедшие звонки и брошенные коды без доступа к сырому номеру.
6. Оформить регламенты 152-ФЗ: сроки хранения, реестр обработок, список подрядчиков, доступы сотрудников, порядок удаления и выгрузки данных.
