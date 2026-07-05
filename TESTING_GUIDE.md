# Инструкция по тестированию миграции Firebase → REST API

## Статус миграции

### ✅ Завершено (Фаза 1 и часть Фазы 2)

1. **AuthService** - Полностью мигрирован на Яндекс OAuth + JWT
2. **auth-token.interceptor** - Обновлен для работы с JWT токенами
3. **environment.ts** - Обновлен (добавлены Яндекс OAuth настройки)
4. **app.config.ts** - Firebase providers удалены
5. **AuthCallbackComponent** - Создан для обработки OAuth callback
6. **RatingService** - Мигрирован на REST API
7. **PhotographerApiService** - Полностью мигрирован на REST API
8. **auth.guard.ts** - Обновлен для работы с JWT токенами
9. **LoginFormComponent** - Обновлен для Яндекс OAuth
10. **RegisterComponent** - Обновлен для Яндекс OAuth

## Что нужно проверить перед тестированием

### 1. Backend API должен быть запущен

```bash
cd /var/www/apimain/angular-app/backend
npm install
npm run dev
```

Backend должен быть доступен на `http://localhost:3000`

### 2. Проверить конфигурацию backend

Убедитесь что в `.env` файле backend указаны:
- `YANDEX_CLIENT_ID` - Client ID приложения Яндекс OAuth
- `YANDEX_CLIENT_SECRET` - Client Secret
- `YANDEX_REDIRECT_URI` - должен совпадать с `environment.ts` (`http://localhost:4200/auth/callback`)

### 3. Обновить environment.ts для Angular

В `angular-app/src/environments/environment.ts` нужно указать реальный `yandex.clientId`:

```typescript
yandex: {
  clientId: 'YOUR_YANDEX_CLIENT_ID', // Заполнить реальным значением
  redirectUri: 'http://localhost:4200/auth/callback'
}
```

## Тестирование

### Тест 1: Проверка компиляции

```bash
cd /var/www/apimain/angular-app
npm run build
```

Должно пройти без ошибок.

### Тест 2: Проверка работы AuthService

**Что проверить:**
1. `AuthService` должен быть доступен без ошибок
2. `AuthService.isAuthenticated()` должен возвращать `false` для неавторизованного пользователя
3. `AuthService.getAuthToken()` должен возвращать `null` если нет токена

**Как проверить:**
- Откройте консоль браузера
- Проверьте что нет ошибок при загрузке приложения
- Вызовите в консоли: `ng.probe(document.body).injector.get(AuthService).isAuthenticated()`

### Тест 3: Проверка авторизации через Яндекс OAuth

**Шаги:**
1. Откройте `/auth/login`
2. Нажмите любую кнопку входа (Google, Apple, VK или кнопку "Войти")
3. Должен произойти редирект на Яндекс OAuth
4. После авторизации должен произойти редирект на `/auth/callback` с токенами
5. AuthCallbackComponent должен обработать токены и перенаправить на главную

**Ожидаемый результат:**
- Редирект на Яндекс OAuth работает
- После авторизации пользователь перенаправляется на главную
- Токены сохраняются в localStorage
- `AuthService.isAuthenticated()` возвращает `true`

### Тест 4: Проверка JWT токена в запросах

**Что проверить:**
1. После авторизации токен должен автоматически добавляться в заголовки запросов
2. Запросы к `/api/*` должны содержать заголовок `Authorization: Bearer <token>`

**Как проверить:**
- Откройте DevTools → Network
- Выполните любой запрос к API (например, загрузка списка фотографов)
- Проверьте заголовки запроса - должен быть `Authorization: Bearer ...`

### Тест 5: Проверка RatingService

**Шаги:**
1. Откройте главную страницу `/`
2. Hero секция должна загрузить рейтинг через REST API

**Ожидаемый результат:**
- Данные загружаются без ошибок
- Если backend недоступен, используется fallback значение (5.0, 349+ оценок)

**Проверка в консоли:**
```javascript
// В консоли браузера проверьте запросы
// Должен быть запрос к GET /api/photographers/stats
```

### Тест 6: Проверка PhotographerApiService

**Шаги:**
1. Откройте `/photographers`
2. Должен загрузиться список фотографов через REST API

**Ожидаемый результат:**
- Список фотографов загружается
- Запрос идет на `GET /api/photographers`

**Проверка в консоли:**
```javascript
// Проверьте Network tab
// Должен быть запрос к GET /api/photographers
```

### Тест 7: Проверка защищенных маршрутов

**Шаги:**
1. Не авторизуясь, попробуйте открыть `/user-profile`
2. Должен произойти редирект на `/auth/login`

**Ожидаемый результат:**
- authGuard работает корректно
- Редирект на страницу логина с сохранением `returnUrl`

### Тест 8: Проверка guards

**Что проверить:**
1. `authGuard` - блокирует неавторизованных пользователей
2. `photographerGuard` - блокирует пользователей без роли photographer
3. `adminGuard` - блокирует пользователей без роли admin

**Шаги:**
- Попробуйте открыть защищенные маршруты без авторизации
- Попробуйте открыть `/photographer-dashboard` с ролью `client`
- Попробуйте открыть `/admin` без роли `admin`

## Известные проблемы и ограничения

### 1. Email/Password авторизация

**Текущее состояние:** Email/password форма в LoginFormComponent теперь редиректит на Яндекс OAuth. Это временное решение - форма оставлена для обратной совместимости, но функциональность не работает.

**Решение:** В будущем можно полностью убрать форму или добавить отдельный endpoint для email/password авторизации.

### 2. Firebase Storage

**Текущее состояние:** Firebase Storage еще используется в FileStorageService (не мигрирован).

**Решение:** Миграция FileStorageService запланирована на Фазу 5.

### 3. Отсутствующие backend endpoints

Некоторые методы в сервисах могут вернуть ошибку, если endpoint еще не реализован:

- `GET /api/photographers/stats` - для RatingService
- `GET /api/ratings/stats` - для RatingService
- `POST /api/ratings` - для RatingService
- `GET /api/photographers/:id/schedule` - для ScheduleService
- И другие из списка TODO в плане

**Решение:** Эти endpoints нужно добавить в backend или использовать fallback значения.

## Чек-лист для тестирования

- [ ] Backend запущен и доступен на `http://localhost:3000`
- [ ] Yandex OAuth Client ID настроен в `environment.ts`
- [ ] Yandex OAuth настройки совпадают в backend и frontend
- [ ] Приложение компилируется без ошибок
- [ ] Страница `/auth/login` открывается без ошибок
- [ ] Нажатие кнопки входа редиректит на Яндекс OAuth
- [ ] После авторизации происходит редирект на `/auth/callback`
- [ ] Токены сохраняются в localStorage
- [ ] После авторизации можно открыть защищенные страницы
- [ ] Главная страница загружает рейтинг через REST API
- [ ] Страница `/photographers` загружает список через REST API
- [ ] Запросы к API содержат заголовок `Authorization: Bearer ...`
- [ ] Guards корректно блокируют неавторизованных пользователей

## Следующие шаги после тестирования

Если все тесты пройдены успешно, можно продолжить миграцию:

1. Мигрировать PhotoLocationsApiService
2. Мигрировать BookingApiService
3. Мигрировать остальные сервисы из Фазы 5

## Откат изменений (если нужно)

Если что-то не работает, можно вернуться к Firebase версии используя git:

```bash
git checkout HEAD -- angular-app/src/app/core/services/auth.service.ts
# и другие файлы
```

Но рекомендуется сначала исправить проблемы, так как миграция критична для дальнейшей разработки.

