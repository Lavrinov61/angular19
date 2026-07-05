# svoefoto.ru — diff location-блоков для активации CRM-gate

Этот файл показывает, **какие location'ы в `/etc/nginx/sites-enabled/svoefoto.ru`
должны получить `include /etc/nginx/snippets/crm-gate.conf;`** после активации.

**НЕ применять автоматически** — владелец вручную правит nginx конфиг после
подтверждения ADMIN_PUBLIC_IPS (см. `README.md` → Checklist перед активацией).

---

## Карта location'ов

| Location | Gate? | Обоснование |
|---|---|---|
| `/` | ❌ public | Лендинг svoefoto.ru, публичный сайт |
| `/cart` | ❌ public | Корзина клиентов (Angular SSR) |
| `/order/*` | ❌ public | Онлайн-заказ клиентов |
| `/socket.io/` | ❌ public | WebSocket для чата-виджета (анонимные визитёры) |
| `/api/auth/*` | ❌ public | Логин/refresh/logout — доступ отовсюду |
| `/api/payments/modulbank/webhook` | ❌ public | Webhook банка, приходит с их IP |
| `/api/webhooks/telegram` | ❌ public | Webhook Telegram Bot API |
| `/api/vk/webhook` | ❌ public | Webhook VK Callback API |
| `/api/max/webhook` | ❌ public | Webhook MAX |
| `/uploads/` | ❌ public (P1) | Фото клиентов — пока публично, в P1 перенести за signed URL |
| **`/employee/`** | ✅ **gate** | CRM UI (Angular routes) |
| **`/api/crm/`** | ✅ **gate** | CRM API (inbox, clients, orders, payments) |
| **`/api/admin/`** | ✅ **gate** | Admin API (settings, users, migrations) |
| **`/api/employee/`** | ✅ **gate** | Employee API (shifts, stats) |
| **`/grafana/`** | ✅ **gate** | Grafana dashboards |
| **`/api/metrics`** | ✅ **gate** | Prometheus /metrics endpoint |

---

## Diff: до и после

### Пример 1 — `/employee/` (Angular CRM UI через SSR)

**ДО:**
```nginx
location /employee/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

**ПОСЛЕ:**
```nginx
location /employee/ {
    include /etc/nginx/snippets/crm-gate.conf;   # ← NEW

    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### Пример 2 — `/api/crm/` (REST API CRM)

**ДО:**
```nginx
location /api/crm/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

**ПОСЛЕ:**
```nginx
location /api/crm/ {
    include /etc/nginx/snippets/crm-gate.conf;   # ← NEW

    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

### Пример 3 — `/grafana/`

**ДО:**
```nginx
location /grafana/ {
    proxy_pass http://127.0.0.1:3000/;
    proxy_set_header Host $host;
}
```

**ПОСЛЕ:**
```nginx
location /grafana/ {
    include /etc/nginx/snippets/crm-gate.conf;   # ← NEW

    proxy_pass http://127.0.0.1:3000/;
    proxy_set_header Host $host;
}
```

---

## Важные оговорки

1. **Порядок в nginx:** `include` с `if` должен идти **первым** в location, до
   любых `proxy_set_header`/`proxy_pass`. Иначе gate не срабатывает.

2. **Вложенные location'ы:** если есть `location /api/crm/inbox/ { ... }`
   **внутри** `/api/crm/`, gate уже унаследован через outer location. Не дублировать.

3. **real_ip_from / X-Forwarded-For:** если nginx стоит за CloudFlare/ALB,
   добавить перед gate:
   ```nginx
   real_ip_header X-Forwarded-For;
   set_real_ip_from <upstream-cidr>;
   ```
   Сейчас svoefoto.ru → 84.38.189.58 напрямую, real_ip не нужен.

4. **`error_page 403`:** если хочется HTML-страницу вместо текста,
   вынести в отдельный location `@crm_blocked { return 403 ...; }` и
   использовать `error_page 403 /403-crm.html;`. Пока — plain text 403.

5. **WebSocket внутри `/api/crm/`:** если есть `/api/crm/ws` — он также будет
   заблокирован gate'ом. Это корректно: внутренний WS только для операторов.
   Публичный socket.io отдельный location — `/socket.io/` без gate.
