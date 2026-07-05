# CRM Perimeter — сетевой периметр доступа к CRM

**Статус:** артефакты в репозитории, на prod **НЕ установлены**. Установка
вручную владельцем после подтверждения `ADMIN_PUBLIC_IPS`.

---

## TL;DR

CRM (`/employee/`, `/api/crm/`, `/api/admin/`, `/api/employee/`, `/grafana/`,
`/api/metrics`) закрывается IP-allowlist на уровне nginx:

- **Разрешено:** подсеть WireGuard `10.200.0.0/24` + публичные IP
  администраторов (список в `/etc/nginx/conf.d/admin-ips.inc`).
- **Всё остальное:** `HTTP 403 "Access restricted to office network"`.

Публичные части сайта (лендинг, корзина, онлайн-заказы, webhook'и
Telegram/VK/MAX/Модульбанка, socket.io для анонимных чат-визитёров,
`/uploads/*` до P1) остаются **открытыми отовсюду**.

---

## Карта маршрутизации

```
                 ┌──────────────────────────────────────────┐
 Интернет ──▶   │  nginx (443)  @ 84.38.189.58              │
                │  ┌─────────────────────────────────────┐  │
                │  │ conf.d/00-crm-allowlist.conf        │  │
                │  │   geo $crm_trusted_ip { ... }       │  │
                │  └─────────────────────────────────────┘  │
                │                                            │
                │  location / ─────────▶ :4000 (SSR)    public
                │  location /cart ─────▶ :4000          public
                │  location /api/auth/ ▶ :3001          public
                │  location /api/*/webhook ▶ :3001      public
                │  location /socket.io/ ▶ :3001         public
                │  location /uploads/ ─▶ filesystem     public (P1→signed)
                │                                            │
                │  ┌── crm-gate.snippet.conf ────┐           │
                │  │ if ($crm_trusted_ip = 0)    │   GATE    │
                │  │   return 403;               │           │
                │  └─────────────────────────────┘           │
                │  location /employee/ ───▶ :4000 (SSR)      │
                │  location /api/crm/ ────▶ :3001 (API)      │
                │  location /api/admin/ ──▶ :3001            │
                │  location /api/employee/ ▶ :3001           │
                │  location /grafana/ ────▶ :3000 (Grafana)  │
                │  location /api/metrics ─▶ :3001            │
                └────────────────────────────────────────────┘
                                │
                                ▼
                    ┌──────────────────────┐
                    │ PostgreSQL (5432)    │  локально, не exposed
                    │ Redis (6379)         │  локально, не exposed
                    └──────────────────────┘

WireGuard wg0 (10.200.0.0/24, UDP 51820) ─── операторы из дома/мобильных
```

---

## Состав артефактов

```
ops/crm-perimeter/
├── README.md                                   ← этот файл
├── testing-checklist.md                        ← 20-пунктовая проверка после активации
├── nginx/
│   ├── 00-crm-allowlist.conf                   → /etc/nginx/conf.d/00-crm-allowlist.conf
│   ├── admin-ips.inc.example                    (шаблон, реальный файл генерится скриптом)
│   ├── crm-gate.snippet.conf                   → /etc/nginx/snippets/crm-gate.conf
│   └── svoefoto-locations.diff.md              инструкция по правке sites-enabled
└── scripts/
    ├── wg-add-peer.sh                          onboard WG-пира (keys + QR)
    ├── wg-remove-peer.sh                       offboard WG-пира
    ├── apply-admin-ips.sh                      публикация admin-ips.inc из env
    └── rollback.sh                             экстренное отключение gate
```

---

## Checklist перед активацией

Владелец выполняет **по порядку**. Не пропускать пункты.

### 1. Собрать ADMIN_PUBLIC_IPS

На каждой рабочей машине администраторов (дом, офис, reception-ПК):

```bash
curl -s https://api.ipify.org
# или
curl -s ifconfig.me
```

Записать в формат CSV (CIDR обязателен — `/32` для одиночного IP):

```
203.0.113.42/32,198.51.100.7/32,192.0.2.0/24
```

**Гайдлайны:**
- Домашний провайдер с динамическим IP → взять `/24` окрестность (риск: +254 соседа).
- Мобильный интернет → **не белый**, работать через WG.
- Офис Соборный 21 / 2-ая Баррикадная 4 → статический IP провайдера, `/32`.

### 2. Подтвердить webhook-источники

| Сервис | Действие | Результат |
|---|---|---|
| Telegram | диапазон `149.154.160.0/20` + `91.108.4.0/22` уже в `00-crm-allowlist.conf` | OK |
| VK Callback API | HMAC-проверка в бэкенде, IP не фильтруем | OK |
| MAX | HMAC-проверка в бэкенде, IP не фильтруем | OK |
| Модульбанк | написать в support, запросить список исходящих IP | **TBD** |

Пока Модульбанк не прислал список — webhook `/api/payments/modulbank/webhook`
**остаётся публичным** (без gate), полагаемся на проверку подписи платёжного
webhook'а в `backend/src/payments/modulbank-webhook.ts`.

### 3. Onboard первого WG-пира (сам владелец)

На сервере:
```bash
cd /var/www/apimain/angular-dev/ops/crm-perimeter
sudo ./scripts/wg-add-peer.sh rostov-laptop rostov@svoefoto.ru
# сохранить вывод client.conf, отсканировать QR в WireGuard (Android/iOS/macOS/Windows)
```

**Проверка:** подключиться к WG → зайти на http://10.200.0.1 или ping 10.200.0.1.

### 4. Dry-run: nginx -t БЕЗ активации gate

```bash
sudo cp ops/crm-perimeter/nginx/00-crm-allowlist.conf /etc/nginx/conf.d/
sudo touch /etc/nginx/conf.d/admin-ips.inc   # пустой, валидный
sudo cp ops/crm-perimeter/nginx/crm-gate.snippet.conf /etc/nginx/snippets/crm-gate.conf
sudo nginx -t
```

`nginx -t` должен быть **OK** (`syntax is ok`, `test is successful`). Если
fail — исправить синтаксис в одном из трёх файлов.

### 5. Применить admin-ips.inc

```bash
sudo ADMIN_PUBLIC_IPS='203.0.113.42/32,198.51.100.7/32' \
  /var/www/apimain/angular-dev/ops/crm-perimeter/scripts/apply-admin-ips.sh
```

Скрипт выполнит `nginx -t` и `nginx -s reload` автоматически; при ошибке
откатит к backup.

### 6. Вручную внести `include /etc/nginx/snippets/crm-gate.conf;` в location'ы

См. `nginx/svoefoto-locations.diff.md` — 6 location'ов получают include:
`/employee/`, `/api/crm/`, `/api/admin/`, `/api/employee/`, `/grafana/`, `/api/metrics`.

```bash
sudo vim /etc/nginx/sites-enabled/svoefoto.ru
# внести 6 правок по образцу diff'а
sudo nginx -t && sudo nginx -s reload
```

### 7. Прогнать testing-checklist.md

Все 20 тестов — EXT-машина (должна быть блокировка), WG-машина (должен быть доступ).

---

## Rollback (экстренная деактивация)

Одна команда на сервере:

```bash
sudo /var/www/apimain/angular-dev/ops/crm-perimeter/scripts/rollback.sh
```

Это перезаписывает `/etc/nginx/snippets/crm-gate.conf` на пустой snippet и
делает `nginx -s reload`. Правки `sites-enabled/` **не требуется откатывать**
— `include` остаётся на месте, но snippet пустой, gate не срабатывает.

Повторная активация:
```bash
sudo cp /var/www/apimain/angular-dev/ops/crm-perimeter/nginx/crm-gate.snippet.conf \
        /etc/nginx/snippets/crm-gate.conf
sudo nginx -t && sudo nginx -s reload
```

---

## Playbook — onboard/offboard WG peer

### Onboard (добавить оператора)

```bash
sudo /var/www/apimain/angular-dev/ops/crm-perimeter/scripts/wg-add-peer.sh \
     <peer_name> <email>

# Пример:
sudo ./wg-add-peer.sh kravchenko-home kravchenko@svoefoto.ru
```

Скрипт:
1. Генерирует приватный ключ + PSK.
2. Назначает свободный IP из `10.200.0.4-254`.
3. Добавляет `[Peer]` блок в `/etc/wireguard/wg0.conf` с маркером.
4. `wg syncconf wg0 <(wg-quick strip wg0)` — hot-reload без разрыва.
5. Печатает client.conf + **ANSI QR-код** (сканировать мобильным).

Клиенту отдать **только** client.conf (или QR). Приватный ключ не хранится на
сервере после вывода — повторно выдать нельзя, придётся удалить и создать заново.

### Offboard (удалить оператора)

```bash
sudo ./scripts/wg-remove-peer.sh <peer_name>
# Пример: sudo ./wg-remove-peer.sh kravchenko-home
```

Скрипт:
1. Ищет `# peer: <peer_name> …` маркер в `wg0.conf`.
2. Удаляет 5 строк блока (`[Peer]`, ключ, PSK, AllowedIPs).
3. `wg syncconf` — hot-reload.
4. Backup `wg0.conf.bak-<timestamp>`.

Если несколько peer'ов с одинаковым именем — скрипт отказывается (ambiguity).

### Listing peer'ов

```bash
sudo wg show wg0
# или маркеры:
grep -E "^# peer:" /etc/wireguard/wg0.conf
```

---

## Open questions (6 вопросов владельцу)

1. **Модульбанк IP:** когда получим диапазон от их support? Пока webhook
   открыт, полагаемся только на подпись.
2. **`/uploads/*`:** оставить публичным или переводим на signed URL в P1?
   (фото клиентов могут содержать PII/паспорта/селфи).
3. **Динамические IP дома:** резервируем `/24` или ставим всех дом-операторов
   только на WG? Второй вариант безопаснее, но требует qrencode + обучения.
4. **Grafana внутренний логин:** после gate'а Grafana доступна только через
   WG. Нужен ли Basic Auth перед Grafana login-page (defense in depth) или
   достаточно встроенной авторизации Grafana?
5. **`/api/metrics`:** Prometheus scraper сейчас ходит откуда? Если из того
   же хоста (localhost:9090) — gate не помешает (127.0.0.1/32 в allowlist).
   Если внешний — нужно whitelist'нуть отдельный IP/CIDR.
6. **Активация — когда?** Перед активацией владельцу нужно иметь WG-клиент
   на телефоне + на 2 рабочих ПК. Инцидент «я запер сам себя» решается
   `rollback.sh` через SSH — но если SSH тоже закрыт (не должен быть),
   recovery сложнее. Рекомендуется iproute2 rule на SSH-22 без gate.

---

## Ссылки

- WireGuard install: https://www.wireguard.com/install/
- nginx geo module: https://nginx.org/en/docs/http/ngx_http_geo_module.html
- Telegram webhook IPs: https://core.telegram.org/bots/webhooks#the-short-version
