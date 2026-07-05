# Миграция данных из Firestore в PostgreSQL

## Обзор

Этот документ описывает процесс миграции данных из Firebase Firestore в PostgreSQL для приложения Magnus Photo.

## Структура данных

### Коллекции Firestore для миграции:

1. **users** → таблица `users`
2. **photographers** → таблица `photographers`
3. **photographers/{userId}/reviews** → таблица `reviews`
4. **studios** → таблица `studios`
5. **studios/{docId}/reviews** → таблица `studio_reviews`
6. **shooting_locations** → таблица `shooting_locations`
7. **bookings** → таблица `bookings`
8. **orders** → таблица `orders`
9. **orders/{orderId}/comments** → таблица `order_comments`
10. **photo_sessions** → таблица `photo_sessions`
11. **photo_sessions/{sessionId}/photos** → таблица `photos`
12. **photo_selections** → таблица `photo_selections`
13. **permissions** → таблица `permissions`
14. **schedules** → таблица `schedules`

## Шаги миграции

### 1. Экспорт данных из Firestore

```bash
# Установить Firebase CLI
npm install -g firebase-tools

# Войти в Firebase
firebase login

# Экспортировать все коллекции
firebase firestore:export gs://your-bucket/firestore-export --project magnusphotoproject
```

### 2. Скачать экспортированные данные

```bash
# Скачать из Google Cloud Storage
gsutil -m cp -r gs://your-bucket/firestore-export ./migrations/firestore-export/
```

### 3. Преобразование данных

Создать скрипт для преобразования JSON экспорта Firestore в SQL INSERT statements:

```typescript
// migrations/transform-firestore-data.ts
import fs from 'fs';
import path from 'path';

// Читать экспортированные данные и преобразовать в SQL
```

### 4. Импорт в PostgreSQL

```bash
# Применить схему БД
psql -U magnus_user -d magnus_photo_db -f backend/database/schema.sql

# Импортировать данные
psql -U magnus_user -d magnus_photo_db -f migrations/imported-data.sql
```

## Особенности миграции

### Преобразование типов данных:

- **Firestore Timestamp** → PostgreSQL `TIMESTAMP WITH TIME ZONE`
- **Firestore GeoPoint** → PostgreSQL `JSONB` с полями `lat` и `lng`
- **Firestore Arrays** → PostgreSQL `TEXT[]` или `JSONB[]`
- **Firestore Maps** → PostgreSQL `JSONB`

### Вложенные коллекции:

Firestore использует подколлекции (например, `photographers/{id}/reviews`), которые в PostgreSQL становятся отдельными таблицами с внешними ключами.

### Обновление рейтингов:

После миграции отзывов, триггеры PostgreSQL автоматически обновят рейтинги фотографов и студий.

## Проверка после миграции

```sql
-- Проверить количество записей
SELECT 
  'users' as table_name, COUNT(*) as count FROM users
UNION ALL
SELECT 'photographers', COUNT(*) FROM photographers
UNION ALL
SELECT 'reviews', COUNT(*) FROM reviews
UNION ALL
SELECT 'studios', COUNT(*) FROM studios
UNION ALL
SELECT 'bookings', COUNT(*) FROM bookings;

-- Проверить рейтинги
SELECT id, name, rating FROM photographers LIMIT 10;
SELECT id, name, rating FROM studios LIMIT 10;
```

## Скрипт автоматической миграции

См. `migrations/migrate-firestore-to-postgresql.ts` для полной автоматизации процесса.

## Важные замечания

1. **Резервное копирование**: Создайте резервную копию Firestore перед миграцией
2. **Тестирование**: Протестируйте миграцию на тестовой БД перед продакшн
3. **Валидация**: Проверьте целостность данных после миграции
4. **Двойная запись**: Рассмотрите период двойной записи для безопасного перехода

