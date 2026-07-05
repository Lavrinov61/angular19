# Firebase to Node.js Migration Guide

## Overview

Этот документ описывает процесс миграции Magnus Photo с Firebase на собственный Node.js backend с PostgreSQL.

## Текущий статус миграции

### ✅ Что уже реализовано

#### Backend API (60+ endpoints)
- ✅ **Auth API** - JWT аутентификация, Yandex OAuth
- ✅ **Users API** - управление пользователями
- ✅ **Photographers API** - CRUD фотографов, отзывы
- ✅ **Studios API** - управление студиями
- ✅ **Bookings API** - бронирование фотосессий
- ✅ **Orders API** - управление заказами
- ✅ **Photos API** - фотосессии, выбор фото
- ✅ **Files API** - загрузка/скачивание файлов
- ✅ **Notifications API** - уведомления пользователей (NEW)
- ✅ **Schedule API** - расписание фотографов (NEW)
- ✅ **Photo Approvals API** - одобрение фотографий (NEW)
- ✅ **Dashboard API** - статистика (NEW)

#### Database
- ✅ PostgreSQL schema (20+ таблиц)
- ✅ Миграция Firestore → PostgreSQL скрипт

#### Frontend
- ✅ Полностью работает через REST API
- ✅ JWT токены в localStorage
- ✅ Interceptors для автоматического refresh

### ❌ Что еще нужно сделать

#### Критично (2-4 недели)
- ✅ Realtime функции (WebSocket для chat, presence) - **РЕАЛИЗОВАНО**
  - WebSocket сервер: `backend/src/websocket/socket-server.ts`
  - Фронтенд сервисы: `src/app/core/services/websocket.service.ts`, `chat.service.ts`
  - Реализованы: chat rooms, presence, typing indicators, JWT аутентификация
- ⚠️ Push Notifications backend - **ЧАСТИЧНО РЕАЛИЗОВАНО**
  - ✅ Подписка/отписка: `backend/src/routes/notifications.routes.ts` (endpoints `/push/subscribe`, `/push/unsubscribe`)
  - ✅ Таблица `push_subscriptions` в БД
  - ❌ Отсутствует: библиотека `web-push`, функция отправки push-уведомлений, VAPID ключи
  - ❌ Отсутствует: нативный `notifier-agent` для студийных ПК, чтобы звук/тосты/heartbeat уведомлений не зависели от браузера
- ✅ SSR Migration на Node.js - **РЕАЛИЗОВАНО**
  - Express сервер: `src/server.ts` (использует `@angular/ssr/node`)
  - Документация: `SSR_GUIDE.md`
  - Скрипт запуска: `scripts/start-dev-ssr.sh`
- ❌ Testing (Unit + Integration + E2E) - **НЕ РЕАЛИЗОВАНО**
  - ✅ Есть базовые unit тесты компонентов (10 `.spec.ts` файлов)
  - ❌ Нет unit тестов для API endpoints в `backend/`
  - ❌ Нет integration тестов
  - ❌ Нет E2E тестов (нет Playwright/Cypress)

#### Опционально (2-3 недели)
- ❌ S3/MinIO интеграция для файлов - **НЕ РЕАЛИЗОВАНО**
  - ✅ В БД есть поле `storage_type` с поддержкой 's3', 'minio'
  - ❌ Используется только локальное хранилище (`storage_type = 'local'`)
  - ❌ Нет библиотек для работы с S3/MinIO
  - ❌ Нет реализации загрузки в S3/MinIO
- ✅ Admin API (заглушки заменить на реальные) - **РЕАЛИЗОВАНО**
  - Admin endpoints: `backend/src/routes/dashboard.routes.ts` (`/api/dashboard/admin/stats`)
  - Полная статистика по пользователям, бронированиям, студиям, сессиям, заказам
  - Фронтенд админ панель: `src/app/features/admin/`
  - Admin может видеть всех пользователей и все бронирования
- ❌ Monitoring & Logging - **НЕ РЕАЛИЗОВАНО**
  - ✅ Есть Web Vitals на фронтенде: `src/app/core/services/web-vitals.service.ts`
  - ✅ Есть аналитика на фронтенде: `src/app/core/services/goal-tracking.service.ts`
  - ❌ Нет библиотек для логирования на backend (winston, pino, etc.)
  - ❌ Нет системного мониторинга (Prometheus, Grafana)
  - ❌ Только `console.log` и `console.error` в backend коде

---

## Фаза 1: Data Migration

### Шаг 1: Установка зависимостей

```bash
cd backend
npm install
```

### Шаг 2: Настройка Firebase credentials

Скачайте Service Account Key из Firebase Console:
1. Откройте [Firebase Console](https://console.firebase.google.com/)
2. Выберите проект `magnusphotoproject`
3. Settings → Service Accounts → Generate New Private Key
4. Сохраните файл как `backend/firebase-service-account.json`

### Шаг 3: Настройка переменных окружения

Создайте `backend/.env`:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=magnus_photo_db
DB_USER=magnus_user
DB_PASSWORD=your_password

# Firebase
FIREBASE_PROJECT_ID=magnusphotoproject
GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account.json

# JWT
JWT_SECRET=your_jwt_secret_here
JWT_REFRESH_SECRET=your_jwt_refresh_secret_here

# Yandex OAuth
YANDEX_CLIENT_ID=your_yandex_client_id
YANDEX_CLIENT_SECRET=your_yandex_client_secret
YANDEX_REDIRECT_URI=http://localhost:3000/api/auth/yandex/callback

# Server
PORT=3000
NODE_ENV=development
```

### Шаг 4: Создание PostgreSQL базы данных

```bash
# Войти в PostgreSQL
sudo -u postgres psql

# Создать базу и пользователя
CREATE DATABASE magnus_photo_db;
CREATE USER magnus_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE magnus_photo_db TO magnus_user;
\q

# Применить схему
psql -U magnus_user -d magnus_photo_db -f backend/database/schema.sql
```

### Шаг 5: Запуск миграции

```bash
cd backend
npm run migrate:firestore
```

Скрипт выполнит:
1. Подключение к Firestore
2. Экспорт всех коллекций (users, photographers, bookings, etc.)
3. Трансформация данных (Timestamp → TIMESTAMPTZ, GeoPoint → JSONB)
4. Импорт в PostgreSQL
5. Вывод статистики миграции

**Ожидаемый вывод:**
```
🚀 Starting Firestore to PostgreSQL migration...

📦 Migrating users...
✅ users:
   Total: 150
   Success: 148
   Failed: 2

📦 Migrating photographers...
✅ photographers:
   Total: 25
   Success: 25
   Failed: 0

...

📊 MIGRATION SUMMARY
============================================================
Total records: 500
Successfully migrated: 495
Failed: 5
Success rate: 99.00%
============================================================
```

---

## Фаза 2: Запуск Backend

### Development режим

```bash
cd backend
npm run dev
```

Сервер запустится на `http://localhost:3000`

### Production режим

```bash
cd backend
npm run build
npm start
```

### Проверка работоспособности

```bash
# Health check
curl http://localhost:3000/health

# Test auth endpoint
curl http://localhost:3000/api/auth/yandex
```

---

## Фаза 3: Обновление Frontend

### Шаг 1: Проверка environment

Frontend уже настроен на использование REST API. Проверьте файлы:

**`src/environments/environment.ts`:**
```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api', // ✅ Уже настроено
};
```

**`src/environments/environment.prod.ts`:**
```typescript
export const environment = {
  production: true,
  apiUrl: 'https://test.svoephoto.ru/api', // ✅ Уже настроено
};
```

### Шаг 2: Запуск Angular приложения

```bash
npm start
```

Приложение запустится на `http://localhost:4200`

### Шаг 3: Проверка интеграции

1. Откройте приложение в браузере
2. Попробуйте войти через Yandex OAuth
3. Проверьте работу бронирования
4. Проверьте загрузку фотографий

---

## API Endpoints Reference

### Authentication
```
POST   /api/auth/yandex              - Инициация Yandex OAuth
GET    /api/auth/yandex/callback     - OAuth callback
POST   /api/auth/refresh             - Обновление токена
GET    /api/auth/me                  - Текущий пользователь
POST   /api/auth/logout              - Выход
```

### Notifications (NEW)
```
GET    /api/notifications            - Список уведомлений
GET    /api/notifications/settings   - Настройки уведомлений
PUT    /api/notifications/settings   - Обновить настройки
PUT    /api/notifications/:id/read   - Отметить прочитанным
PUT    /api/notifications/read-all   - Отметить все
DELETE /api/notifications/:id        - Удалить
POST   /api/notifications            - Создать (admin)
GET    /api/notifications/stats      - Статистика
POST   /api/notifications/push/subscribe   - Подписка на push
DELETE /api/notifications/push/unsubscribe - Отписка от push
```

### Schedule (NEW)
```
GET    /api/schedule/photographer/:id       - Расписание фотографа
POST   /api/schedule                        - Создать слот
PUT    /api/schedule/:id                    - Обновить слот
DELETE /api/schedule/:id                    - Удалить слот
GET    /api/schedule/preferences/:id        - Настройки расписания
PUT    /api/schedule/preferences/:id        - Обновить настройки
GET    /api/schedule/stats/:id              - Статистика
POST   /api/schedule/generate               - Автогенерация расписания
POST   /api/schedule/conflicts              - Проверка конфликтов
```

### Photo Approvals (NEW)
```
GET    /api/photo-approvals                 - Список для одобрения (client)
GET    /api/photo-approvals/photographer    - Список (photographer)
GET    /api/photo-approvals/:id             - Детали одобрения
POST   /api/photo-approvals/:id/approve     - Одобрить фото
POST   /api/photo-approvals/:id/reject      - Отклонить фото
POST   /api/photo-approvals/:id/request-changes  - Запросить изменения
POST   /api/photo-approvals/:id/annotations      - Добавить комментарий
GET    /api/photo-approvals/:id/annotations      - Список комментариев
DELETE /api/photo-approvals/annotations/:id      - Удалить комментарий
GET    /api/photo-approvals/:id/history          - История изменений
POST   /api/photo-approvals/bulk/approve         - Массовое одобрение
GET    /api/photo-approvals/stats/summary        - Статистика
PUT    /api/photo-approvals/:id/status           - Обновить статус
```

### Dashboard (NEW)
```
GET    /api/dashboard/photographer/stats         - Статистика фотографа
GET    /api/dashboard/admin/stats                - Статистика админа
GET    /api/dashboard/photographer/services      - Услуги фотографа
PUT    /api/dashboard/photographer/services      - Обновить услуги
GET    /api/dashboard/photographer/revenue-chart - График доходов
```

---

## Troubleshooting

### Проблема: Migration script не может подключиться к Firestore

**Решение:**
```bash
# Проверьте путь к service account key
export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/to/firebase-service-account.json"

# Проверьте права доступа
chmod 600 firebase-service-account.json
```

### Проблема: PostgreSQL connection refused

**Решение:**
```bash
# Проверьте, запущен ли PostgreSQL
sudo systemctl status postgresql

# Запустите PostgreSQL
sudo systemctl start postgresql

# Проверьте настройки подключения в .env
```

### Проблема: JWT token invalid

**Решение:**
```bash
# Сгенерируйте новые секреты
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Обновите JWT_SECRET и JWT_REFRESH_SECRET в .env
```

### Проблема: CORS errors в браузере

**Решение:**

В `backend/src/config/index.ts` проверьте:
```typescript
cors: {
  origin: ['http://localhost:4200', 'http://localhost:3000'], // Добавьте ваши домены
},
```

---

## Итоговая статистика реализации

**Общий прогресс:** 3 из 7 полностью реализовано (43%), 1 частично (14%), 3 не реализовано (43%)

### ✅ Полностью реализовано (3 из 7)
1. **Realtime функции (WebSocket для chat, presence)** - WebSocket сервер и фронтенд сервисы
2. **SSR Migration на Node.js** - Express сервер с Angular SSR
3. **Admin API** - Полная реализация admin endpoints и фронтенд панель

### ⚠️ Частично реализовано (1 из 7)
1. **Push Notifications backend** - Подписка/отписка реализована, отправка push-уведомлений отсутствует

### ❌ Не реализовано (3 из 7)
1. **Testing (Unit + Integration + E2E)** - Только базовые unit тесты компонентов
2. **S3/MinIO интеграция для файлов** - Только локальное хранилище
3. **Monitoring & Logging** - Только базовое логирование через console.log

## Следующие шаги

### Приоритет 1: Push Notifications (завершить реализацию)
- ✅ Подписка/отписка реализована
- ❌ P0: `notifier-agent` для студийных ПК: отдельный WebSocket/MQTT-канал, machine token, heartbeat/online, принудительный звук, системный toast и тест уведомления из админки. Цель: пульт доставляет сообщения сотруднику даже если браузер свернут, вкладка спит или браузерный звук заблокирован. Целевые платформы v1: Windows + macOS.
- ❌ Backend routing для `notifier-agent`: отправлять события staff chat / direct chat / urgent tasks в комнату студии и конкретного сотрудника, с fallback на браузерные push/in-app уведомления
- ❌ Установить библиотеку `web-push`
- ❌ Реализовать функцию отправки push-уведомлений
- ❌ Настроить VAPID keys в конфигурации backend
- ❌ Интегрировать отправку push при создании уведомлений

### Приоритет 2: Testing
- ✅ Базовые unit тесты компонентов есть
- ❌ Настроить Jest/Mocha для backend
- ❌ Добавить unit тесты для API endpoints
- ❌ Добавить integration тесты
- ❌ Настроить E2E тесты с Playwright/Cypress

### Приоритет 3: S3/MinIO интеграция
- ✅ В БД есть поддержка `storage_type` ('s3', 'minio')
- ❌ Установить библиотеки для работы с S3/MinIO
- ❌ Настроить конфигурацию для S3/MinIO
- ❌ Реализовать загрузку файлов в S3/MinIO
- ❌ Обновить `files.routes.ts` для поддержки S3/MinIO

### Приоритет 4: Monitoring & Logging
- ✅ Web Vitals на фронтенде
- ✅ Аналитика на фронтенде
- ❌ Установить winston/pino для логирования на backend
- ❌ Настроить централизованное логирование
- ❌ Настроить системный мониторинг (Prometheus, Grafana)

---

## Полезные команды

```bash
# Backend
cd backend
npm run dev              # Development server
npm run build            # Build production
npm start               # Run production
npm run migrate:firestore # Migrate from Firestore

# Frontend
npm start               # Development server
npm run build           # Build production
npm run build:ssr       # Build with SSR

# Database
psql -U magnus_user -d magnus_photo_db  # Connect to DB
npm run migrate                          # Run migrations
```

---

## Контакты и поддержка

Если возникнут вопросы по миграции:
1. Проверьте логи backend: `tail -f backend/logs/error.log`
2. Проверьте browser console для frontend ошибок
3. Проверьте PostgreSQL logs: `sudo tail -f /var/log/postgresql/postgresql-*.log`

## Лицензия

Magnus Photo © 2025
