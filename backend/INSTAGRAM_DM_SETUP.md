# Instagram DM → CRM: задание для AI

## Задача
Подключить Instagram DM к CRM так, чтобы операторы получали сообщения клиентов foto.magnus и могли отвечать прямо из интерфейса.

---

## Ключи и данные

```
Instagram App ID:        25761294630176722
Business Account ID:     17841402360139386
Instagram username:      foto.magnus
Access Token:            в /var/www/apimain/multiplatformpublic/.env → INSTAGRAM_ACCESS_TOKEN
Webhook Verify Token:    instagram_webhook_token_svoefoto_2024
Webhook URL (текущий):   https://api.fmagnus.org/instagram/callback/  (Python, порт 5054)
```

**ВАЖНО:** `graph.instagram.com` заблокирован в РФ. Все исходящие запросы к Graph API — через SOCKS5 proxy `127.0.0.1:1080` (SSH-туннель, всегда активен).

```typescript
// Пример для node-fetch / axios:
import { SocksProxyAgent } from 'socks-proxy-agent';
const agent = new SocksProxyAgent('socks5://127.0.0.1:1080');
fetch(url, { agent });
```

---

## Стек и файлы проекта

**Backend:** Node.js + TypeScript + Express, порт 3001
**Директория:** `/var/www/apimain/angular-app/backend/src/`

Ключевые файлы:
```
src/
├── routes/chat/
│   ├── chat-external.routes.ts   ← СТАРТ: POST /channel-message (уже есть endpoint для мессенджеров)
│   ├── chat-messages.routes.ts   ← чтение/запись сообщений
│   ├── chat-session.routes.ts    ← управление сессиями
│   └── index.ts                  ← регистрация маршрутов
├── services/
│   └── whatsapp-cloud.service.ts ← образец для Instagram service
└── app.ts                        ← регистрация роутеров
```

**БД:** PostgreSQL `magnus_photo_db`
```sql
visitor_chat_sessions  -- сессии (channel = 'instagram', visitor_id = 'instagram:{ig_user_id}')
visitor_chat_messages  -- сообщения сессии
```

---

## Что уже готово (не трогать)

1. **`chat-external.routes.ts`** — `POST /api/chat/channel-message` принимает входящие сообщения от мессенджеров (telegram, max, whatsapp, vk). **Нужно добавить `'instagram'` в массив `validChannels`** (строка 18).

2. **Angular CRM** — уже отображает `instagram` как канал:
   ```typescript
   // order-mini-chat.component.ts:401
   { whatsapp: 'WhatsApp', instagram: 'Instagram', ... }
   ```

3. **Facebook App** — настроен, foto.magnus добавлен как тестер, токен получен.

---

## Что нужно реализовать

### 1. Webhook endpoint (входящие DM от Instagram)

Создать `src/routes/instagram.routes.ts`:

```typescript
// GET /api/instagram/webhook — верификация Facebook
// POST /api/instagram/webhook — входящие DM
```

**Формат входящего webhook от Instagram:**
```json
{
  "object": "instagram",
  "entry": [{
    "id": "17841402360139386",
    "messaging": [{
      "sender":    { "id": "INSTAGRAM_USER_ID" },
      "recipient": { "id": "17841402360139386" },
      "timestamp": 1234567890,
      "message": {
        "mid": "MESSAGE_ID",
        "text": "Привет, хочу записаться"
      }
    }]
  }]
}
```

**При получении DM:**
- Вызвать `POST /api/chat/channel-message` (или сервис напрямую) с `channel: 'instagram'`
- `externalChatId` = `sender.id`
- `externalUserId` = `sender.id`
- `userName` = получить через `GET https://graph.instagram.com/v18.0/{sender_id}?fields=name` (через proxy)

### 2. Отправка ответа оператора

Создать `src/services/instagram-messaging.service.ts`:

```typescript
// POST https://graph.instagram.com/v18.0/me/messages
// { "recipient": {"id": "INSTAGRAM_USER_ID"}, "message": {"text": "..."} }
// Через SOCKS5 proxy: socks5://127.0.0.1:1080
// Access token из process.env.INSTAGRAM_ACCESS_TOKEN
```

Подключить к endpoint `POST /api/instagram/send` или к существующему механизму ответа оператора в CRM.

### 3. Добавить endpoint отправки в CRM

В `chat-external.routes.ts` или новом файле:
```
POST /api/instagram/send
Body: { igUserId: string, text: string }
```

### 4. Webhook subscription

После деплоя — подписаться на `messages` в Facebook Developer Console:
- URL: `https://svoefoto.ru/api/instagram/webhook` (или через nginx на api.fmagnus.org)
- Или через API:
```bash
curl -x socks5h://127.0.0.1:1080 -X POST \
  "https://graph.instagram.com/v18.0/17841402360139386/subscribed_fields" \
  -d "subscribed_fields=messages&access_token=TOKEN"
```

---

## npm пакеты

```bash
npm install facebook-nodejs-business-sdk socks-proxy-agent
# или без SDK:
npm install socks-proxy-agent  # только для proxy
```

---

## Ограничения Instagram Messaging API

- Отвечать можно только в течение **24 часов** после последнего сообщения клиента
- Первым написать **нельзя**
- Token истекает через **60 дней** → нужно обновлять через `refresh_access_token`
- В режиме Development: только тестовые аккаунты могут слать DM боту

---

## Деплой

```bash
cd /var/www/apimain/angular-app
npm run deploy         # пересобирает Angular SSR + перезапускает API
# или только backend:
cd backend && npm run build && pm2 restart magnus-photo-api
```

Проверить логи: `pm2 logs magnus-photo-api`
