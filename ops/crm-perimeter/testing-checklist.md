# Testing Checklist — CRM Perimeter

Проверочный лист после активации `crm-gate.conf`. Выполняется владельцем
или администратором на двух машинах:

- **EXT** — любой компьютер ВНЕ офиса, ВНЕ WG (мобильный хотспот, домашний провайдер).
- **WG** — машина, подключённая к WireGuard (после `wg-add-peer.sh` + импорт).

Формат записи результата: `[X] OK` / `[-] FAIL (details)`.

---

## Публичные endpoints — должны работать с EXT

| # | Тест | Команда / действие | Ожидание | Результат |
|---|---|---|---|---|
| 1 | Главная svoefoto.ru | `curl -sI https://svoefoto.ru/` | `200 OK` | [ ] |
| 2 | Корзина `/cart` | `curl -sI https://svoefoto.ru/cart` | `200 OK` | [ ] |
| 3 | Auth endpoint | `curl -sI -X POST https://svoefoto.ru/api/auth/login -H 'Content-Type: application/json' -d '{}'` | `400` / `422` (не `403`) | [ ] |
| 4 | Socket.IO публичный чат | открыть svoefoto.ru в браузере, кликнуть чат-виджет | WebSocket hello, сообщения идут | [ ] |
| 5 | Webhook Telegram | `curl -sI -X POST https://svoefoto.ru/api/webhooks/telegram` | `401`/`400` (не `403`) | [ ] |
| 6 | `/uploads/*` (P1 — пока публично) | `curl -sI https://svoefoto.ru/uploads/<любой_валидный_path>` | `200 OK` | [ ] |

---

## CRM endpoints — должны БЛОКИРОВАТЬСЯ с EXT

| # | Тест | Команда | Ожидание | Результат |
|---|---|---|---|---|
| 7 | `/employee/` UI | `curl -sI https://svoefoto.ru/employee/` | `403` + текст "Access restricted…" | [ ] |
| 8 | `/api/crm/clients` | `curl -sI https://svoefoto.ru/api/crm/clients` | `403` | [ ] |
| 9 | `/grafana/` | `curl -sI https://svoefoto.ru/grafana/` | `403` | [ ] |
| 10 | `/api/metrics` | `curl -sI https://svoefoto.ru/api/metrics` | `403` | [ ] |

---

## CRM endpoints — должны работать через WG

| # | Тест | Команда (через WG-машину) | Ожидание | Результат |
|---|---|---|---|---|
| 11 | Логин оператора | открыть `https://svoefoto.ru/employee/login`, залогиниться | `200` + редирект в CRM | [ ] |
| 12 | API — inbox | `curl -sI -H 'Cookie: <token>' https://svoefoto.ru/api/crm/inbox` | `200 OK` | [ ] |
| 13 | Grafana | открыть `https://svoefoto.ru/grafana/` | Grafana UI загружается | [ ] |
| 14 | WebSocket /socket.io через CRM-auth | операторский чат работает | realtime события | [ ] |

---

## Операционные проверки

| # | Проверка | Ожидание | Результат |
|---|---|---|---|
| 15 | `sudo wg show wg0` | peer текущей машины в списке, handshake < 3 мин | [ ] |
| 16 | `nginx -t` | `syntax is ok` | [ ] |
| 17 | `cat /etc/nginx/conf.d/admin-ips.inc` | файл присутствует, строки валидны | [ ] |
| 18 | Prometheus metrics `nginx_ingress_*` (если есть exporter) | счётчик 403 растёт только от EXT-запросов | [ ] |
| 19 | Rollback-drill: `sudo ./scripts/rollback.sh` → `/employee/` открывается с EXT | `200` | [ ] |
| 20 | После drill: восстановить gate, снова `403` с EXT | ок | [ ] |

---

## Что делать при провале

- **Ты сам заблокирован (не можешь попасть через WG):**
  SSH на сервер → `sudo /var/www/apimain/angular-dev/ops/crm-perimeter/scripts/rollback.sh`
- **Nginx reload fail:** `sudo nginx -t` покажет ошибку.
  `admin-ips.inc.bak-*` содержит предыдущую версию.
- **Модульбанк webhook падает с 403:** проверить что `/api/payments/modulbank/webhook`
  НЕ включает `crm-gate.conf`. Если включает — убрать из `sites-enabled/`.
