# Надёжная Telegram-рассылка через @FmagnusBot — архитектура (research + adversarial review)

> 2026-05-31. Многоагентный research (4 угла, 47 практик, источники 2024–2026) + грунтовка по боевому коду (`broadcast.routes.ts`, `outbound-worker.ts`, `telegram.adapter.ts`, live-БД) + adversarial-ревью. Все решения **переиспользуют** существующую инфраструктуру (BullMQ + PG-outbox + retry-scanner), а не строят параллельную.
>
> **Статус: дизайн, НЕ реализовано.** Отправка остаётся ТОЛЬКО на flavrinov, пока владелец не скажет «катаем на всех».

---

## 0. Главный принцип

`@FmagnusBot` — это **И живой клиентский чат (поддержка), И рассыльщик**, на **одном токене**. Один токен = один rate-домен Telegram. При `429` Telegram блокирует **весь бот для всех** на `retry_after` (до 35с). Поэтому центральная цель архитектуры: **рекламный всплеск физически не может заморозить живую поддержку.** Всё остальное вторично.

---

## 1. Краткий вывод

- **Что строим:** движок «шапка → пер-получательский реестр», где `marketing_campaigns` — шапка, новая `campaign_recipients` — durable-реестр «кому что отправили» (outbox), отправка — через **отдельную** очередь `omni-broadcast` 5/сек.
- **Что переиспользуем:** паттерн «PG-строка = источник правды, BullMQ = триггер» из `outbound-worker.ts` (dual-write + retry-scanner 30с + circuit-breaker); сам `telegram.adapter.ts` (`sendText`/`sendMedia`/`sendWithInlineButton`); `marketing_campaigns` как шапку; **существующий `privacy_consents`** как ledger согласий (НЕ плодить новый); `ad_clicks` (БД `multiplatform_publication`) для кликов по `utm_content=contact_id`.
- **Что добавляем (критично):** (1) разбор `parameters.retry_after` в адаптере — **сейчас его нет**; (2) **общий на токен** Redis-governor `tg:bot:<token>:paused_until`, который проверяют **ОБА** воркера ПЕРЕД каждой отправкой; (3) идемпотентность `UNIQUE(campaign_id,contact_id)` + CAS-флип статуса; (4) отписка/suppression (152-ФЗ + 38-ФЗ); (5) тест-гейт «только flavrinov» как поле в БД, не флаг в коде.
- **Чего НЕ делаем:** не дублируем `outbound_delivery_log` (он по `external_chat_id`, без `campaign_id`/`contact_id`, и архивируется); не партиционируем (преждевременно на 959); не включаем платный broadcast (нужно 100k Stars + 100k MAU); не считаем `sent` за `delivered` (у Bot API нет receipt); **для v1 НЕ заводим `campaign_events`** (история уместится в `campaign_recipients` + `ad_clicks`/`conversations`).

---

## 2. ⚠️ ОБЯЗАТЕЛЬНЫЕ ПОПРАВКИ (нашёл adversarial-ревью по боевому коду/БД)

Эти пункты ломали «сырую» схему — здесь они уже учтены ниже, но фиксирую явно, чтобы не потерять при реализации:

| # | Что не так (проверено на live) | Фикс |
|---|---|---|
| **P0-1** | Материализационный `INSERT…SELECT` ссылался на алиас `mc`, которого нет во `FROM` → `missing FROM-clause entry for "mc"`. А это **сам safety-гейт** (flavrinov-only). | Явно `JOIN marketing_campaigns mc ON mc.id = $1`; вся материализация + запись шапки — в ОДНОЙ транзакции. |
| **P0-2** | `marketing_campaigns_campaign_type_check` = `flyer\|email\|sms\|social\|paid_ads\|partner`; `marketing_campaigns_channel_check` = `print\|digital\|mixed`. **Нет telegram/messenger** → шапку TG-рассылки нельзя вставить. | В миграции (Слайс 0) `ALTER` обоих CHECK: добавить `campaign_type='messenger'` и `channel='telegram'` (идемпотентно drop+add). |
| **P0-3** | Прод = **6-процессный split**; воркеры живут в `worker-outbound`, который **никогда не держит** `scheduler-leader`-лок (он только в monolith-режиме). «Диспетчер под scheduler-leader» → в проде **0 отправок**. | Воркер+диспетчер завести в ОБА entry-point как `startOutboundWorker` (в `workers/outbound.ts` для split И в `onBecomeLeaderMonolith`). Синглтон-безопасность — НЕ из лидер-лока, а из `FOR UPDATE SKIP LOCKED` + детерминированного `jobId=idempotency_key`. |
| **P0-4** | Governor — стержень дизайна, но read-path на транзакционном воркере не был задан. `withCircuitBreaker` **намеренно игнорит 429** (`isRateLimit` → не считает фейлом) → сегодня 429 просто `throw` → backoff одной строки, БЕЗ глобальной паузы. | Сделать pre-send гейт в **общем хелпере**, который зовут оба воркера: перед любым `adapter.send*` читать `paused_until`; если активна — `worker.rateLimit()` + `RateLimitError`. Применить **внутри `processOutbound`** тоже, не только в рассылке. Ключ — по **токену**, не accountId. Покрыть тестом: 429 в рассылке → транзакционный воркер видит паузу и уступает. |
| **P1** | `marketing_campaigns.status` уже есть (`draft\|active\|paused\|completed\|cancelled`). Новый `dispatch_status` с почти теми же значениями → два источника правды, пауза из CRM-UI не остановит рассылку. | НЕ плодить второй enum: переиспользовать `status` как kill-switch (`active`→dispatchable), либо синхронизировать существующий pause-UI с `dispatch_status`. |
| **P1** | Уже есть append-only ledger **`privacy_consents`** (privacy-consent.service.ts) — это и есть 152-ФЗ-модель, которую дублировал `contact_consents`. | Переиспользовать `privacy_consents` (добавить `document_type='marketing_telegram'`/scope). Net-new оставить только `marketing_suppressions` (аналога нет, «переживает erasure» — легитимно). |
| **P1** | `campaign_events` имел синтаксис-ошибку (`BIGGENERATED`) и на 959 контактах — лишний слой. | Для **v1 убрать** `campaign_events`; delivery-история = `campaign_recipients` (status + milestone-таймстампы + error-поля), engagement = `ad_clicks`/`conversations`. |

P2 (учесть при коде): 429 не должен одновременно `worker.rateLimit` И `next_attempt_at` (двойной re-enqueue) — выбрать ОДНОГО владельца ретрая (рекомендуется PG-reconciler, как `scanRetryableItems`); `external_chat_id` денормализовать детерминированно (`LATERAL … ORDER BY last_message_at DESC LIMIT 1`, фильтр `status<>'closed'`), NULL → `skipped/no_chat`; все `INSERT marketing_suppressions` — `ON CONFLICT DO NOTHING`; `my_chat_member kicked/left` резолвить chatId→contact_id.

---

## 3. Архитектура БД (выверенная)

### 3.1. Двухслойная модель (v1)
```
marketing_campaigns   — ШАПКА (1 строка/кампания): что, когда, UTM, kill-switch, тест-гейт
        │  1:N
campaign_recipients   — РЕЕСТР (1 строка/(кампания,контакт)): delivery-состояние + outbox
```
Клики/ответы (many-per-recipient) — НЕ в этой модели: клики в `ad_clicks` (другая БД), ответы в `conversations`/`messages`. `campaign_events` отложен до реальной потребности в полном аудит-трейле.

### 3.2. `marketing_campaigns` — что добавить (Слайс 0)
```sql
-- P0-2: расширить CHECK, иначе TG-кампанию не вставить
ALTER TABLE marketing_campaigns DROP CONSTRAINT IF EXISTS marketing_campaigns_campaign_type_check;
ALTER TABLE marketing_campaigns ADD  CONSTRAINT marketing_campaigns_campaign_type_check
  CHECK (campaign_type IN ('flyer','email','sms','social','paid_ads','partner','messenger'));
ALTER TABLE marketing_campaigns DROP CONSTRAINT IF EXISTS marketing_campaigns_channel_check;
ALTER TABLE marketing_campaigns ADD  CONSTRAINT marketing_campaigns_channel_check
  CHECK (channel IN ('print','digital','mixed','telegram'));

-- Тест-гейт «только flavrinov» в ДАННЫХ (аудируемо), kill-switch — переиспользуем существующий status (P1)
ALTER TABLE marketing_campaigns
  ADD COLUMN IF NOT EXISTS test_mode BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allowed_contact_ids UUID[] NULL;
-- «Катаем на всех» = владелец флипает test_mode=false (один явный шаг). Запуск/пауза = существующий status (active/paused/cancelled).
```

### 3.3. `campaign_recipients` (ядро)
```sql
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id        UUID NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  contact_id         UUID NOT NULL REFERENCES contacts(id),
  channel            TEXT NOT NULL,                       -- 'telegram'
  external_chat_id   TEXT NOT NULL,                       -- денормализуем детерминированно (см. 4.2)
  kind               TEXT NOT NULL DEFAULT 'marketing'
                       CHECK (kind IN ('marketing','transactional')),

  idempotency_key    TEXT NOT NULL,                       -- 'camp:'||campaign_id||':'||contact_id

  status             TEXT NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued','sent','failed','blocked','skipped','suppressed')),
  skip_reason        TEXT NULL,                           -- 'frequency_cap'|'no_consent'|'no_chat'|'quiet_hours'

  personalized_url   TEXT NULL,                           -- utm_source/medium/campaign + utm_content=contact_id + campaign_id
  payload_snapshot   JSONB NULL,                          -- {text, mediaUrl, button:{label,url}}

  attempts           INT NOT NULL DEFAULT 0,
  max_attempts       INT NOT NULL DEFAULT 3,
  next_attempt_at    TIMESTAMPTZ NULL,

  external_message_id TEXT NULL,                          -- 'tg:<message_id>'
  error_code          TEXT NULL,
  error_detail        TEXT NULL,

  queued_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at            TIMESTAMPTZ NULL,
  failed_at          TIMESTAMPTZ NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_recipient_per_campaign UNIQUE (campaign_id, contact_id),
  CONSTRAINT uq_recipient_idem        UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_recipients_dispatchable
  ON campaign_recipients (next_attempt_at) WHERE status IN ('queued','failed');
CREATE INDEX IF NOT EXISTS idx_recipients_freqcap
  ON campaign_recipients (contact_id, sent_at) WHERE kind='marketing' AND sent_at IS NOT NULL;
```
**Статус-машина (forward-only):** `queued → sent | failed | blocked | skipped | suppressed`. Терминалы: все, кроме `queued`. **429 — НИКОГДА не статус получателя**: это глобальный backpressure (пишет `next_attempt_at`, оставляет `queued`). `sent` = «accepted by Telegram» (receipt'а у бота нет → `delivered` не вводим).

### 3.4. `marketing_suppressions` (net-new — аналога нет)
```sql
CREATE TABLE IF NOT EXISTS marketing_suppressions (
  contact_id   UUID NULL REFERENCES contacts(id),
  external_chat_id TEXT NULL,                             -- если chatId не резолвится в contact
  reason       TEXT NOT NULL CHECK (reason IN ('unsubscribe','hard_bounce','complaint','manual')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_suppression_contact
  ON marketing_suppressions (contact_id) WHERE contact_id IS NOT NULL;
```
> 152-ФЗ: suppression **переживает** erasure ПД (храним минимальный идентификатор, чтобы продолжать чтить отписку). Erasure-job НЕ каскадит сюда.

**Согласие — в существующем `privacy_consents`** (НЕ новая таблица): `document_type='marketing_telegram'`, резолв contact→user_id/visitor_id. Аудитория рассылки = `granted` ∧ ¬suppressed ∧ ¬freq-cap.

---

## 4. Очередь / отправка

### 4.1. Отдельная очередь `omni-broadcast` (Слайс 1)
```ts
const broadcastQueue = new Queue('omni-broadcast', { connection: { ...redisOpts } });
worker = new Worker('omni-broadcast', processBroadcast, {
  connection: { ...redisOpts },
  concurrency: 5,                       // pipelining IO-bound HTTP
  limiter: { max: 5, duration: 1000 },  // рекламный потолок 5/сек
  lockDuration: 5*60*1000, stalledInterval: 2*60*1000, maxStalledCount: 1,
});
```
- **Почему отдельно:** рекламу можно притормозить, чек об оплате — нет. Изоляция приоритета + свой лимитер.
- **P0-4 ловушка:** лимитеры BullMQ — **пер-очередь, не пер-токен**. 5/сек(broadcast) + 30/сек(transactional) = до 35/сек на один токен → 429. Решение — общий governor (4.3).
- **P0-3:** завести воркер+диспетчер в ОБА entry-point (`workers/outbound.ts` split И `onBecomeLeaderMonolith`), как `startOutboundWorker`. НЕ гейтить на scheduler-leader.
- **Текущий баг:** `broadcast.routes.ts` сейчас зовёт `enqueueOutbound` → шлёт в `omni-outbound` (30/сек транзакционный лайн). Перевести на новый путь.

### 4.2. Outbox + идемпотентность
1. **Материализация в ОДНОЙ транзакции** (P0-1 — шапка явно в JOIN):
```sql
INSERT INTO campaign_recipients
  (campaign_id, contact_id, channel, external_chat_id, idempotency_key, payload_snapshot, personalized_url, status, max_attempts)
SELECT mc.id, c.id, 'telegram', conv.external_chat_id,
       'camp:'||mc.id||':'||c.id, $2::jsonb, $3, 'queued', 3
FROM marketing_campaigns mc                                  -- P0-1: шапка в FROM
JOIN contacts c ON true
JOIN LATERAL (                                               -- P2: детерминированный chat, не закрытый
  SELECT external_chat_id FROM conversations
  WHERE contact_id=c.id AND channel='telegram' AND external_chat_id IS NOT NULL AND status<>'closed'
  ORDER BY last_message_at DESC NULLS LAST LIMIT 1
) conv ON true
LEFT JOIN marketing_suppressions s ON s.contact_id=c.id
WHERE mc.id = $1
  AND s.contact_id IS NULL
  AND EXISTS (SELECT 1 FROM privacy_consents pc                -- P1: существующий ledger
              WHERE pc.contact_id=c.id AND pc.document_type='marketing_telegram' AND pc.accepted)
  AND (NOT mc.test_mode OR c.id = ANY(mc.allowed_contact_ids)) -- ТЕСТ-ГЕЙТ (flavrinov-only)
ON CONFLICT (campaign_id, contact_id) DO NOTHING;
```
Контакты без согласия / в suppression / вне freq-cap / без chat — пишем `status='suppressed'/'skipped'` отдельным проходом (видно в воронке, не молчаливый дроп).

2. **Диспетчер** (cadence 30с, как `scanRetryableItems`): `SELECT … WHERE status IN('queued','failed') AND (next_attempt_at IS NULL OR next_attempt_at<=now()) … FOR UPDATE SKIP LOCKED LIMIT 500` → BullMQ `add('send',{recipientId},{jobId:idempotency_key, attempts:1})`.

3. **CAS-флип в воркере** (единственная защита от двойной отправки — у Telegram нет idempotency-key):
```sql
UPDATE campaign_recipients SET status='sent', sent_at=now(), external_message_id=$2, updated_at=now()
WHERE id=$1 AND status IN ('queued','failed') RETURNING id;   -- 0 строк → уже обработано, skip без отправки
```

### 4.3. 429 — глобальная пауза, НЕ сон одной job
Адаптер (правка — сейчас `retry_after` теряется): при `!response.ok` распарсить `JSON.parse(body)?.parameters?.retry_after` → в `SendResult.retryAfter`.

**Общий pre-send гейт в хелпере, который зовут ОБА воркера (P0-4):**
```ts
const until = await redis.get(`tg:bot:${token}:paused_until`);
if (until && Date.now() < +until) { await worker.rateLimit(+until - Date.now()); throw new Worker.RateLimitError(); }
// ... send ...
// при errorCode==='429':
const ms = Math.min((retryAfter ?? 1)*1000, 30_000) + jitter(250,1000);
await redis.set(`tg:bot:${token}:paused_until`, Date.now()+ms, 'PX', ms);
// статус остаётся 'queued', next_attempt_at=now()+ms; ретрай отдаёт reconciler (НЕ дублировать с worker.rateLimit)
```
- `Worker.RateLimitError()` — job не тратит attempt, не уходит в dead-letter.
- Потолок 30с: больше → fail-fast (`failed`+`next_attempt_at`), reconciler подберёт.
- Транзакционный воркер тоже читает `paused_until` ⇒ 429 рассылки **не морозит поддержку**.

### 4.4. Классификация ошибок
| Сигнал | Корзина | Действие |
|---|---|---|
| **429** | retryable, глобально | governor-пауза, `queued`, attempt НЕ тратится |
| **5xx/network/timeout** | retryable, локально | exp-backoff `5000·2^(n-1)`, после `max_attempts` → `failed` |
| **403 blocked/deactivated/chat not found** | **terminal** | `blocked`/`skipped` + `INSERT marketing_suppressions ON CONFLICT DO NOTHING`, prune навсегда |

403 никогда не в dead-letter. `my_chat_member kicked/left` (уже детектится, только логируется) — апгрейд до записи suppression (резолвить chatId→contact_id).

### 4.5. Pause/resume/cancel + resumability
- Kill-switch = `marketing_campaigns.status` (переиспользуем, P1). Воркер проверяет **в начале каждой job** → no-op если не активна.
- Resumability бесплатна: состояние получателя — строка в PG. После краша reconciler (30с) ре-энкьюит `queued`/retryable-`failed`. Redis НЕ источник правды.
- Quiet hours 10:00–20:00 МСК (только рекламный лайн) через BullMQ delayed jobs; воркер всё равно перечитывает kill-switch при исполнении.

---

## 5. Метрики (воронка — не схлопывать)
| Стадия | Источник | Где |
|---|---|---|
| queued | материализация | `campaign_recipients` |
| **sent** (=accepted) | `SendResult.success`+message_id | `campaign_recipients.status='sent'` |
| delivered | **нет сигнала у Bot API** | не изобретать |
| failed/blocked | errorCode/403 | `campaign_recipients`+`error_*` |
| clicked | серверный 302-редирект | `ad_clicks` (БД `multiplatform_publication`), join по `contact_id` |
| replied | inbound после `sent_at` | `conversations`/`messages` |

Ключевые: delivery=`sent/queued`; **block-rate=`blocked/queued`** (canary здоровья отправителя); CTR=`clicked/sent`. Живая воронка — `GROUP BY status` по `campaign_recipients` (то, чего `broadcast_log` не умеет — он только агрегат). UTM per-recipient заморожен на `personalized_url`. Здоровье — BullMQ Prometheus + алерт на частоту 429 и рост `waiting` в `omni-outbound` (ранний сигнал, что рассылка душит поддержку).

---

## 6. Комплаенс РФ
- **Два РАЗДЕЛЬНЫХ согласия:** 152-ФЗ (обработка ПД) и **38-ФЗ ст.18** (реклама по сетям электросвязи, вкл. мессенджеры). Без пред-отмеченных чекбоксов. Бремя доказывания — на нас. Хранить в `privacy_consents`: кто/на что/когда/каким действием/версия текста.
- **Сбор в боте:** отдельная opt-in inline-кнопка «Хочу получать акции», отличная от использования поддержки. Аудитория = только `granted`.
- **Отписка (обязательно ДО запуска):** inline-кнопка «Отписаться» на КАЖДОМ рекламном сообщении + `/stop`,`/unsubscribe` → `withdrawn` + suppression, мгновенно и навсегда (поддержка работает). 403 = неявная отписка.
- **Частотный кап** (server-side, `kind='marketing'` only; транзакционные/OTP не входят): не чаще ~1 промо в несколько дней. Best-effort между одновременно запущенными кампаниями (документируем; жёстче — оценивать на send-time).
- **Штрафы (контекст):** 38-ФЗ (КоАП 14.3 ч.4.1) юрлица 300k–1 000 000 ₽; 152-ФЗ (КоАП 13.11 ч.2, поднят 30.05.2025) 300k–700k, повтор 1–1.5 млн ₽. Кратно больше профита кампании.

---

## 7. План внедрения (слайсы)
> Сквозное: отправка ТОЛЬКО на flavrinov через `test_mode=true`+`allowed_contact_ids=[flavrinov]`, пока владелец не флипнет `test_mode=false`.

- **Слайс 0 — миграция:** расширить CHECK `marketing_campaigns` (P0-2), `test_mode`/`allowed_contact_ids`, `campaign_recipients`, `marketing_suppressions`, `document_type='marketing_telegram'` в privacy-флоу. Идемпотентно. Деньги не трогаем.
- **Слайс 1 — очередь+воркер+governor:** `omni-broadcast` {5/сек}; разбор `retry_after` в адаптере; общий `paused_until` в ОБОИХ воркерах (+pre-send гейт в `processOutbound`); завести в оба entry-point (split+monolith, P0-3); перевести `broadcast.routes.ts` с `enqueueOutbound`; reconciler.
- **Слайс 2 — веер:** материализация (CAS, `payload_snapshot`, per-recipient UTM); `sendMedia`+`sendWithInlineButton`; классификация ошибок; prune 403.
- **Слайс 3 — консент/отписка:** opt-in + «Отписаться» + `/stop`; фильтр материализации по `granted`/suppressions/freq-cap/quiet-hours; апгрейд `my_chat_member`.
- **Слайс 4 — отчёт:** `GROUP BY status` эндпоинт; ETL кликов из `ad_clicks` (cross-DB по contact_id); reply-rate; Prometheus+алерты.
- **Перед «катаем на всех»:** staged rollout 20–50 реальных контактов → следим за частотой 429, block-rate и **что латентность поддержки на общем токене не просела** → потом ~959.

### Открытые вопросы из ревью (учесть)
- Что делать со старым `POST /api/admin/broadcast` (остаётся live, text-only, два писателя в `broadcast_log`) — мигрировать/депрекейтить.
- Идемпотентность САМОГО запуска кампании (двойной клик/ретрай HTTP) — CAS-переход запуска, отказ если уже running/completed.
- Валидность `mediaUrl` в окне рассылки (~3.2 мин+): `sendMedia` перезакачивает байты по URL; presigned/ротация S3 → 403 в середине. Держать URL живым или слать `file_id`.
- Load-тест изоляции: под форсированным 429 в рассылке латентность поддержки на том же токене НЕ страдает.
- Подтвердить: рассылка не задевает payment-link-ветку (`extractPaymentUrl`) в outbound (маркетинг-текст с `svoefoto.ru/pay/` не должен интерпретироваться как платёж).

---

**Опорные файлы:** `backend/src/routes/broadcast.routes.ts` · `backend/src/services/connectors/pipeline/outbound-worker.ts` · `backend/src/services/connectors/telegram/telegram.adapter.ts` · `backend/src/services/.../privacy-consent.service.ts` · `backend/src/workers/outbound.ts` · `ecosystem.config.cjs`.
