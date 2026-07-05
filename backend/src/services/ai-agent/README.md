# AI-чат-агент «Своё Фото»

Автономный AI-агент для операторского чата: отвечает клиентам в мессенджерах (Telegram/MAX/VK/WhatsApp/Instagram), консультирует, оформляет заказы и доводит до оплаты. Модель human-on-the-loop: бот ведёт диалог, оператор перехватывает в любой момент.

Реализовано командной разработкой (`/team`) за сессию 2026-06-02/03. Документ описывает итоговое состояние.

## Статус по этапам

| Этап | Что делает | Коммит(ы) | Прод |
|---|---|---|---|
| 0-1 | Инфраструктура (OpenRouter, tool-registry, orchestrator, аудит) + suggest-помощник оператору | `7118ce2f` | в составе Этапа 2 |
| **2** | Бот **отвечает** клиентам во всех каналах, human-on-the-loop | `5f9212e5` + `3ea9fc92` | 🟢 **ЗАДЕПЛОЕН, активен** |
| **3** | Бот **оформляет** заказы (печать/подписка) + ссылка на оплату | `679c979b` | ⚪ закоммичен, флаг оформления OFF, НЕ задеплоен |

Дополнительно: починена обрезка AI-подсказок в пульте (`5b3060e2`, v0.54.76).

## Главные принципы

1. **Бот = сервис, не прайс-автомат.** Не вываливает прайс простынёй, не инициирует ценой; сначала понимает задачу, помогает; цену называет точечно и только из результата инструмента.
2. **Бот не трогает деньги.** Оформление = черновик (pending) + подписанная ссылка на оплату; платит клиент сам виджетом CloudPayments; сумму считает сервер. hard-deny на все прямые платежи/рекуррент.
3. **human-on-the-loop.** Бот автономен на типовом; оператор видит диалоги, перехватывает в один клик; сложное/спорное/деньги/жалоба → эскалация на человека. Переход к большей автономии — по метрикам (acceptance rate), не по календарю.

## Поток (Этап 2-3)

```
клиент пишет в мессенджер → webhook → omni-inbound → inbound-worker.processOneMessage
  ├─ INSERT messages (sender_type='visitor')
  ├─ autoAssignOperator → тихое назначение при ai_agent_mode='bot' (оператор-наблюдатель)
  ├─ offline_auto_reply → только при mode='off'
  └─ maybeEnqueueAgentTurn() [за AI_AGENT_ENABLED, fire-and-forget] → omni-ai-turn (debounce 4с, коалесинг)

ai-turn-worker (процесс worker-outbound, singleton lock 737002 + NODE_ENV=production):
  killswitch ai:enabled (fail-closed) → leader-check → mode='bot'? →
  classifier «вышибала» (respond/skip/handoff) → runAgentTurn(bot) →
  CAS-гейт turn_count → INSERT bot message + enqueueOutbound(dedupKey)
  [Этап 3, за AI_AGENT_ORDERING_ENABLED] write-draft tools → черновик заказа →
  request_payment_link → generateChatPaymentUrl → ссылка клиенту

omni-outbound → processOutbound:
  второй гейт (sender_type='bot': перечитать mode, suppress если 'operator') → adapter.sendText

оператор reply/assign/transfer/claim/status → ai_agent_mode='operator'+lock → бот молчит
оплата: клиент платит виджетом → webhook /payments/pay → заказ оплачен → уведомление
```

## Флаги и управление

| Флаг (env) | Назначение | Default | Прод |
|---|---|---|---|
| `AI_AGENT_ENABLED` | Бот отвечает клиентам (Этап 2) | false | **true** |
| `AI_AGENT_ORDERING_ENABLED` | Бот оформляет заказы (Этап 3) | false | не задан (false) |
| `AI_AGENT_MODEL` | Модель «мозга» | `anthropic/claude-sonnet-4.6` | — |
| `AI_AGENT_CLASSIFIER_MODEL` | Дешёвая модель-«вышибала» | `deepseek/deepseek-v4-flash` | — |
| `AI_AGENT_COST_CAP_USD` | Лимит стоимости одного хода | 0.5 | — |
| `AI_AGENT_MAX_AUTO_ORDER` | Порог авто-оформления (руб); выше → эскалация | 5000 | — |
| `OPENROUTER_API_KEY` | Единый ключ ко всем моделям | — | задан, hard-limit $3 на ключе |

**Killswitch (мгновенно заглушить бота):** `redis-cli -a "$REDIS_PASSWORD" set ai:enabled false` (fail-closed: при недоступном Redis бот тоже молчит). Снять: `set ai:enabled true`.

**Оператор:** в пульте бейдж «🤖 AI ведёт», кнопки «Взять» / «Вернуть боту» (эндпоинт `POST /admin/sessions/:id/ai-agent-mode`).

## Модели (через OpenRouter, единый транспорт)

Все модели идут через один `OpenRouterProvider` и один ключ — смена модели = смена строки env, без правок кода. Прямые провайдеры (`claude/gemini/grok.provider.ts`) — легаси веб-suggest, агент их не использует.

- **Мозг:** Claude Sonnet 4.6 (надёжный tool-calling, строг к фактам). Альтернативы строкой: Opus 4.8, GPT-5.5.
- **Вышибала:** DeepSeek V4-flash / Grok 4.3 (дёшево, решает «отвечать ли»).
- **Capability-aware:** не шлёт `temperature` моделям, что её не поддерживают (gpt-5*, opus-4.8*).
- Gemini не использовать для фактов (ловили на выдумывании цен) — годен для будущего audio-STT.

## Безопасность

- **Деньги:** бот не списывает; сумма только server-recompute; идемпотентность (advisory-lock + sha256 confirm_token); порог `maxAutoOrder` → эскалация; ревью трёх агентов — 0 денежных дыр. booking/retouch → оператор (необратимые действия).
- **Гонки бот↔оператор:** тройной гейт — CAS turn_count (воркер) + второй гейт в `processOutbound` + перехват ставит lock. Бот молчит при перехвате даже посреди хода.
- **Dev не отвечает клиентам прода:** ai-turn-worker берёт advisory-lock `737002` на общей БД (singleton) + `NODE_ENV=production`.
- **ПДн:** verified-identity строго на канале текущего сообщения (анти-утечка через подмену телефона на слабом канале VK/MAX/Email). Персональные данные только для верифицированного контакта.
- **Prompt-injection:** контент клиента в делимитерах; чужой operator/bot не мапится в роль assistant; цена/промокод только из инструмента.
- **Аудит:** каждый ход в `ai_agent_runs`, каждый tool-call в `ai_agent_tool_calls` (risk_class, сырые vs валидированные аргументы, стоимость).

## Карта файлов

```
backend/src/services/ai-agent/
  ai-agent-tools.ts            read-tools + write-draft tools + payment-link, getToolDeclarations, executeTool, идемпотентность, verified-identity, порог
  ai-agent-orchestrator.service.ts  runAgentTurn (suggest/bot), buildSystemPrompt, slot-filling, tool-escalate
  ai-agent-classifier.ts       classifyInbound (respond/skip/handoff)
backend/src/services/ai-providers/
  openrouter.provider.ts       chatWithTools, capability-aware (единый транспорт)
  provider.interface.ts        ToolDef/ToolCall/AgentProvider + расширенный ChatMessage
backend/src/services/connectors/pipeline/
  ai-turn-worker.ts            omni-ai-turn: leader-check, killswitch, CAS-гейт, эскалация, оркестрация хода
  inbound-worker.ts            maybeEnqueueAgentTurn (точка автозапуска)
  outbound-worker.ts           dedup_key + второй гейт suppress
backend/src/services/
  ai-chat.service.ts           generateOperatorSuggestion (Этап 1 suggest через orchestrator)
  auto-assign.service.ts       silent-назначение наблюдателя
backend/src/routes/chat/
  chat-admin.routes.ts         перехват (mode='operator') + эндпоинт возврата
backend/database/migrations/
  zz_20260602_ai_agent.sql     ai_agent_runs / ai_agent_tool_calls / ai_agent_confirmations + колонки conversations + outbound_queue.dedup_key
src/app/features/employee/components/detail-panel/
  chat-detail.component.*       бейдж «AI ведёт» + кнопки Взять/Вернуть боту
```

Существующее переиспользовано: `chat-bot-engine`/`executeChatAction`/`handleFinalizeOrder` (оформление), `generateChatPaymentUrl` (оплата), `subscription.service` (подписки), `getChatHistory`.

## Операции

**Включить оформление (Этап 3) на проде:**
1. `deploy.sh backend` (билд из dev → rsync → рестарт; флаг оформления off — поведение = Этап 2, безопасно). Запускать с `SPLIT_ENABLED=true` (ai-turn-worker живёт в worker-outbound). Перед деплоем проверить `npx tsc --noEmit` (соседний order-queue WIP периодически менялся).
2. `AI_AGENT_ORDERING_ENABLED=true` в `angular-app/backend/.env` (deploy.sh не копирует .env).
3. Рестарт через `deploy.sh` (по слову владельца, не вручную pm2).
4. Смоук: оформить печать в Telegram → получить ссылку → оплатить малой суммой → проверить webhook пометил оплаченным + уведомление; перехват оператором глушит; крупная сумма → эскалация; подписка SUB-оплата; бот не вывалил прайс.

**Откат:** killswitch `ai:enabled=false` (мгновенно) / `UPDATE conversations SET ai_agent_mode='off'` / `AI_AGENT_ORDERING_ENABLED` убрать.

## Верификация (на момент коммитов)

- tsc 0, vitest зелёный (Этап 2: 104/104; Этап 3: 92/92 в ai-agent).
- Ревью каждого этапа тремя свежими агентами (код/безопасность/тесты); все P0 закрыты до коммита.
- Живой смоук на проде (P0-gate перед включением оформления) — за владельцем.

## Дорожная карта / долги

- Per-contact rate-limit (сейчас страхует hard-limit $3 на ключе OpenRouter).
- Голосовые сообщения: audio-STT шаг (Gemini Flash Lite / voxtral) перед мозгом.
- Нативные inline-кнопки в мессенджере (сейчас текст + ссылка; кнопки — отдельный этап при необходимости).
- Слияние с легаси веб-AI-стеком (web-Gemini/Grok) в единый orchestrator.
- Метрика acceptance-rate из `ai_agent_runs` как светофор повышения автономии.

Подробная история решений и контекст: файл памяти проекта `AI_CHAT_AGENT_ARCHITECTURE_2026_06_02.md`.
