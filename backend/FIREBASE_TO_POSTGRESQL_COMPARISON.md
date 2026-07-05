# Сравнение структуры Firebase Firestore и PostgreSQL

## Коллекции Firebase → Таблицы PostgreSQL

### ✅ Основные коллекции (соответствуют)

| Firebase Collection | PostgreSQL Table | Статус |
|---------------------|------------------|--------|
| `users` | `users` | ✅ Соответствует |
| `photographers` | `photographers` | ✅ Соответствует |
| `photographers/{id}/reviews` | `reviews` | ✅ Мигрировано в отдельную таблицу |
| `studios` | `studios` | ✅ Соответствует |
| `studios/{id}/reviews` | `studio_reviews` | ✅ Мигрировано в отдельную таблицу |
| `bookings` | `bookings` | ✅ Соответствует |
| `orders` | `orders` | ✅ Соответствует |
| `orders/{id}/comments` | `order_comments` | ✅ Мигрировано в отдельную таблицу |
| `photo_sessions` | `photo_sessions` | ✅ Соответствует |
| `photo_sessions/{id}/photos` | `photos` | ✅ Мигрировано в отдельную таблицу |
| `photo_selections` | `photo_selections` | ✅ Соответствует |
| `permissions` | `permissions` | ✅ Соответствует |
| `schedules` | `schedules` | ✅ Соответствует |

### ✅ Добавленные недостающие таблицы

| Firebase Collection | PostgreSQL Table | Статус |
|---------------------|------------------|--------|
| `notifications` | `notifications` | ✅ Добавлено |
| `push_subscriptions` | `push_subscriptions` | ✅ Добавлено |
| `photo_approvals` | `photo_approvals` | ✅ Добавлено |
| `photo_approvals/{id}/annotations` | `photo_approval_annotations` | ✅ Добавлено |
| `users/{uid}/settings` | `user_settings` | ✅ Мигрировано в отдельную таблицу |
| `users/{uid}/photographer_services` | `photographer_services` | ✅ Мигрировано в отдельную таблицу |

### ❓ Коллекции, которых нет в Firebase коде

| Collection | Статус |
|------------|--------|
| `shooting_locations` | ❓ Не найдено в Firebase Functions, но есть в схеме PostgreSQL |

### ✅ Дополнительные таблицы для новой архитектуры

| Table | Назначение |
|-------|-----------|
| `files` | Хранение метаданных загруженных файлов |
| `refresh_tokens` | Хранение refresh токенов для JWT аутентификации |

## Структура данных

### Преобразование типов данных

| Firestore | PostgreSQL |
|-----------|------------|
| `Timestamp` | `TIMESTAMP WITH TIME ZONE` |
| `GeoPoint` | `JSONB` с полями `lat`, `lng` |
| `Array` | `TEXT[]` или `JSONB[]` |
| `Map/Object` | `JSONB` |
| `Subcollection` | Отдельная таблица с `FK` |

### Вложенные коллекции → Отдельные таблицы

Firestore использует подколлекции, которые в PostgreSQL становятся отдельными таблицами:

- `photographers/{id}/reviews` → `reviews` (с `photographer_id FK`)
- `studios/{id}/reviews` → `studio_reviews` (с `studio_id FK`)
- `orders/{id}/comments` → `order_comments` (с `order_id FK`)
- `photo_sessions/{id}/photos` → `photos` (с `session_id FK`)
- `photo_approvals/{id}/annotations` → `photo_approval_annotations` (с `approval_id FK`)
- `users/{uid}/settings` → `user_settings` (с `user_id FK` и `setting_type`)
- `users/{uid}/photographer_services` → `photographer_services` (с `photographer_id FK`)

## Особенности миграции

### Автоматические обновления

- **Рейтинги фотографов**: Триггеры автоматически обновляют `photographers.rating` при изменении `reviews`
- **Рейтинги студий**: Триггеры автоматически обновляют `studios.rating` при изменении `studio_reviews`

### Индексы

Все таблицы имеют соответствующие индексы для оптимизации запросов:
- По `user_id`, `photographer_id`, `client_id` для быстрого поиска
- По `status`, `type` для фильтрации
- По `created_at`, `timestamp` для сортировки
- GIN индексы для JSONB полей и массивов

## Итоговая сводка

✅ **Все основные коллекции Firebase покрыты в PostgreSQL схеме**
✅ **Добавлены недостающие таблицы** (notifications, push_subscriptions, photo_approvals)
✅ **Вложенные коллекции мигрированы в отдельные таблицы**
✅ **Автоматические триггеры для обновления рейтингов**
✅ **Индексы для оптимизации запросов**

## Следующие шаги

1. Проверить наличие данных в Firebase (`shooting_locations` - возможно используется в другом месте)
2. Создать скрипты миграции данных из Firestore в PostgreSQL
3. Протестировать миграцию на тестовых данных

