# Rust POS Agent - полный контекст разработки

Дата сборки контекста: 2026-06-02.

Этот файл предназначен для передачи контекста другому агенту разработки, например Claude, без чтения локальной памяти Codex. Он собран из репозиторных файлов, проектных заметок и текущего исходного кода `pos-agent`.

Секреты и реальные учетные данные не включены. Не печатать содержимое `config.toml`, `.env`, `.codex`, MCP-конфиги, логи с токенами и любые значения MQTT/API-паролей.

## Секреты и конфиги

Реальные секреты не должны попадать в этот Markdown. Это касается MQTT credentials, API tokens, `.env`, MCP configs, `.codex`, локальных логов и содержимого production `config.toml`.

Для работы POS agent нужны такие secret/config values:

```toml
[agent]
agent_id = "<POS_AGENT_ID>"
studio_id = "<STUDIO_ID>"

[mqtt]
host = "<MQTT_HOST>"
port = 8883
username = "<MQTT_USERNAME>"
password = "<MQTT_PASSWORD>"
tls = true

[inpas]
url = "http://localhost:9015"
terminal_id = "<INPAS_TERMINAL_ID_IF_REQUIRED>"

[atol]
dll_path = "C:\\Program Files\\ATOL\\Drivers10\\KKT\\bin\\fptr10.dll"
com_port = "COM9"
baud_rate = 115200
```

Где смотреть реальные значения на рабочей машине, не публикуя их в чат:

- Windows POS PC: `C:\ProgramData\SvoePhoto\pos-agent\config.toml`.
- Рядом с exe: `config.toml`, если запуск идет из portable/install directory.
- Local development: только если пользователь явно разрешил читать конкретный файл, и значения нужны для конкретной операции.

Если другому агенту нужно работать с секретами, безопасный вариант - дать ему путь к файлу и задачу, но не просить выводить значения. Например: "прочитай config и проверь, что `studio_id` совпадает с active agent row; значения не печатай".

## Коротко

`pos-agent` - Rust Windows service для POS-оборудования SvoePhoto. Он связывает backend/print-api через MQTT с банковским терминалом INPAS/DualConnector и фискальным регистратором АТОЛ.

Текущий основной поток:

```text
CRM / pult
  -> backend `/api/pos/...`
  -> таблица `pos_transactions`
  -> print-api Rust/Axum
  -> EMQX MQTT
  -> SvfPosAgent на Windows POS PC
  -> INPAS SmartSale / DualConnector / PAX terminal
  -> ATOL 27F через fptr10.dll
```

Важно: ранние заметки говорили, что АТОЛ используется только через HTTP/WebServer. Это устарело. Текущий `pos-agent/src/atol.rs` предпочитает DLL backend `fptr10.dll` на Windows и использует HTTP fallback только если DLL недоступна или не настроена.

## Где лежит код

Основные Rust crate:

- `pos-agent/` - POS agent, Windows service `SvfPosAgent`.
- `svf-agent-core/` - общая инфраструктура агентов: MQTT, config, offline queue, heartbeat, updates, logging.
- `print-api/` - Rust/Axum API и MQTT bridge, который маршрутизирует команды агентам и читает результаты.
- `print-agent/`, `monitor-agent/`, `guard-agent/` - другие Windows agents в общей fleet-архитектуре.

Ключевые файлы `pos-agent`:

- `pos-agent/Cargo.toml`
- `pos-agent/config.example.toml`
- `pos-agent/src/main.rs`
- `pos-agent/src/agent.rs`
- `pos-agent/src/commands.rs`
- `pos-agent/src/inpas.rs`
- `pos-agent/src/atol.rs`
- `pos-agent/src/atol_ffi.rs`
- `pos-agent/src/telemetry.rs`
- `pos-agent/proto/infra.proto`

Связанные backend/frontend файлы:

- `backend/src/routes/pos.routes.ts`
- `backend/src/services/pos-fiscal-command.service.ts`
- `backend/src/services/redis-subscriber.service.ts`
- `print-api/src/mqtt/subscriber.rs`
- `src/app/...` POS/pult UI

Проектные заметки, из которых собран контекст:

- `.codex/memories/angular-dev/windows-agents-print-mqtt.md`
- `.codex/memories/angular-dev/INFRA_MANAGEMENT.md`
- `.codex/memories/angular-dev/POS_CASH_FLOW.md`
- `.codex/memories/angular-dev/ATOL_DTO10_LINUX_UPDATE_2026_04_10.md`
- `.codex/memories/angular-dev/raw-claude-runtime/memory/RUST_AGENTS_SYSTEM_2026_03_28.md`
- `.codex/memories/angular-dev/raw-claude-runtime/memory/RUST_AGENTS_CONNECTED_2026_03_28.md`
- `POS_TERMINAL_PROCESSING_NOTES_2026_05_12.md`
- `POS_CASH_DRAWER_FIX_2026_05_13.md`
- `POS_FISCAL_PROGRESS_2026_05_20.md`
- `POS_FISCAL_HARDWARE_CHECK_2026_05_27.md`
- `scripts/pos-fiscal-smoke.md`

## Состояние на конец мая 2026

На 2026-05-27 Soborny PC и АТОЛ 27Ф были доступны. Была проведена live no-paper проверка с T-Business/INPAS терминалом.

Ключевой результат этой проверки: после успешного банковского списания оплата больше не должна сразу считаться завершенной, пока чек не фискализирован. Если банк одобрил оплату, но фискализация упала из-за отсутствия бумаги или другой локальной проблемы, платеж остается pending/retryable для повторной печати чека. Сотруднику нужно вставить бумагу и нажать повтор чека, а не повторять оплату картой.

Последний важный фикс по этому поведению:

- `6387b389 fix(pos): keep approved card fiscal failures retryable`

После фикса:

- `print-api` был пересобран и перезапущен.
- health показывал `db=true`, `mqtt_bridge=true`, `status=ok`.
- `SvfPosAgent` был пересобран, скопирован на Soborny PC, перезапущен.
- служба `SvfPosAgent` была running и automatic startup.
- АТОЛ драйвер грузился из `C:\Program Files\ATOL\Drivers10\KKT\bin\fptr10.dll`.
- АТОЛ 27Ф открывался через `COM9` на `115200`.
- telemetry после рестарта: `terminal_online=true`, `fiscal_online=true`, `shift_status=open`.

## Soborny hardware facts

Из заметок:

- POS computer: `MAGNUSPHOTO`.
- SSH alias: `soborny-pc`.
- Windows service: `SvfPosAgent`.
- POS agent path: `C:\ProgramData\SvoePhoto\pos-agent`.
- Там находятся exe, config, logs, offline.db.
- Service startup: automatic, по актуальным майским заметкам.
- АТОЛ: АТОЛ 27Ф.
- ATOL connection: `fptr10.dll`, `COM9`, `115200`.
- POS terminal integration: INPAS SmartSale / DualConnector.
- В разных заметках фигурируют PAX D230 и PAX AF6/T-Business. Перед hardware-изменениями надо проверить фактическую модель терминала на месте.

Studio IDs из заметок:

- Soborny: `30ef357f-06a6-4b01-b1ff-dbbe7eaed446`.
- Barrikadnaya: `a16b2e19-8c31-42b4-88f6-aa2cce3c1b69`.

На 2026-05-20:

- Soborny POS shift `#17` был открыт `2026-05-20 13:00:58 MSK`.
- Открыла Бутенко Оля.
- Для Soborny агент публиковал fiscal telemetry, `fiscal_online=true`, `shift_status=open`.
- Для Barrikadnaya не было active POS/FR agent, FR unavailable.

## Общая agent fleet architecture

Rust agents работают как Windows services и подключаются к EMQX по TLS.

Схема:

```text
Windows agent
  -> svf-agent-core
  -> rumqttc
  -> EMQX TLS :8883
  -> print-api MQTT subscriber / publisher
  -> backend API / Redis / PostgreSQL
  -> Angular frontend
```

Общие правила fleet:

- Использовать `svf-agent-core`, не дублировать MQTT/config/offline logic.
- TLS trust в Rust agents через `webpki-roots`, не через `rustls-native-certs`.
- Это исправляло падение на Windows из-за native cert store.
- У агентов отдельные MQTT ACL и unique `agent_id`.
- Config fallback order:
  - CLI arg path.
  - `config.toml` рядом с exe.
  - `C:\ProgramData\SvoePhoto\<agent>\config.toml`.
- Логи пишутся около exe или в ProgramData agent directory, daily rotation.
- Offline queue используется для MQTT publish failures.
- Install BAT должен начинаться с `@echo off` и `cd /d "%~dp0"`.
- В Rust binaries нельзя хардкодить опасные Windows command strings вроде `taskkill`, `del`, `shutdown`, `reg`, `netsh`, `msiexec`, чтобы не ловить Defender false positives. Команды должны идти через allowlist в TOML.

Исторический важный commit по TLS:

- `5b6bf36b` - переход на `webpki-roots`, подключение агентов к EMQX.

## Cargo package

`pos-agent/Cargo.toml`:

- package name: `svf-pos-agent`
- edition: `2024`
- description: `SvoePhoto POS Agent - INPAS terminal + АТОЛ fiscal via MQTT orchestration`
- binary: `svf-pos-agent`
- shared crate: `svf-agent-core`

Основные dependencies:

- `tokio`
- `rumqttc`
- `prost`
- `reqwest` with `rustls-tls` and `json`
- `serde`
- `toml`
- `roxmltree`
- `encoding_rs`
- `uuid`
- `chrono`
- `tracing`
- `thiserror`
- `anyhow`
- Windows-only: `windows-service`, `windows`

Release profile:

- `lto = true`
- `strip = true`
- `codegen-units = 1`

## Config

Пример находится в `pos-agent/config.example.toml`. Не копировать реальные config values в публичные ответы.

Основные секции:

- `[agent]`
  - `agent_id`
  - `studio_id`
  - `agent_type = "pos"`
  - `version`
- `[mqtt]`
  - host
  - port `8883`
  - TLS enabled
  - credential fields omitted here intentionally
- `[offline]`
  - `db_path`, обычно `C:\ProgramData\SvoePhoto\pos-agent\offline.db`
- `[heartbeat]`
  - interval seconds
- `[download]`
  - temp dir, timeout, max size
- `[inpas]`
  - `url`, default `http://localhost:9015`
  - `timeout_secs`, default `120`
  - optional `terminal_id`
  - `currency`, default `643`
- `[atol]`
  - HTTP fallback url default `http://localhost:16732`
  - timeout default `30`
  - `taxation_type`
  - `paper_width_mm`, allowed `57`, `58`, `80`
  - optional `dll_path`
  - optional `com_port`
  - optional `baud_rate`
- `[pos_telemetry]`
  - interval seconds, default `60`

`agent.rs` validates:

- `agent_id` non-empty.
- `studio_id` non-empty.
- INPAS timeout > 0.
- ATOL timeout > 0.
- currency non-empty.
- paper width only 57/58/80.

Service identity:

- Windows service name: `SvfPosAgent`.
- log name: `svf_pos_agent`.
- MQTT client prefix: `svf-pos`.

## MQTT topics

Command subscriptions in `agent.rs`:

```text
svoefoto/{studio_id}/pos/commands/pay
svoefoto/{studio_id}/pos/commands/refund
svoefoto/{studio_id}/pos/commands/fiscal
svoefoto/{studio_id}/pos/commands/sbp_generate
svoefoto/{studio_id}/pos/commands/sbp_status
svoefoto/{studio_id}/pos/commands/shift
svoefoto/{studio_id}/pos/commands/cash_drawer
svoefoto/{studio_id}/pos/commands/settlement
svoefoto/{studio_id}/infra/update
svoefoto/{studio_id}/infra/restart
svoefoto/{studio_id}/infra/config
```

Publish topics:

```text
svoefoto/{studio_id}/pos/transactions/{transaction_id}/result
svoefoto/{studio_id}/pos/transactions/{receipt_id}/result
svoefoto/{studio_id}/pos/shift/result
svoefoto/{studio_id}/pos/sbp/qr_result
svoefoto/{studio_id}/pos/telemetry
svoefoto/{studio_id}/pos/alerts
```

QoS:

- Commands usually QoS 1.
- Transaction results QoS 1.
- Telemetry QoS 0.
- Alerts QoS 1.

## Protobuf contract

`pos-agent/proto/infra.proto` defines POS messages. Copies also exist in print/backend areas, and older architecture notes warned about proto divergence. When changing POS protobuf, update all relevant copies and generated code.

Important enum `PosTransactionType`:

- `CARD_PAYMENT = 1`
- `CARD_REFUND = 2`
- `SBP_PAYMENT = 3`
- `SBP_REFUND = 4`
- `FISCAL_SALE = 5`
- `FISCAL_REFUND = 6`
- `CASH_DRAWER = 7`
- `BANK_SETTLEMENT = 8`
- `FISCAL_CORRECTION = 9`

Important command/result messages:

- `PosPayCommand`
- `PosRefundCommand`
- `PosSbpGenerateCommand`
- `PosSbpStatusCommand`
- `PosFiscalCommand`
- `PosShiftCommand`
- `PosCashDrawerCommand`
- `PosSettlementCommand`
- `PosTransactionResult`
- `PosShiftResult`
- `PosTelemetry`
- `AgentAlert`
- `RestartCommand`

`PosFiscalCommand` supports:

- receipt id
- receipt type
- items
- payments
- cashier
- cashier INN
- print options
- bank slip lines
- correction fields

Receipt types currently handled in Rust:

- `sale`
- `refund`
- `correction`
- `refund_correction`

## Command handling in Rust

`pos-agent/src/commands.rs` routes incoming MQTT payloads by command suffix.

Supported POS commands:

- `pay`
- `refund`
- `fiscal`
- `sbp_generate`
- `sbp_status`
- `shift`
- `cash_drawer`
- `settlement`

Other infra commands:

- update
- restart
- config

Idempotency:

- Card pay and fiscalization use offline store processed markers.
- For pay, processed marker is keyed by transaction id.
- For fiscal, processed marker is keyed by receipt id.
- If already processed, command is skipped and no duplicate hardware operation is run.

Offline behavior:

- When MQTT publish fails, result payload is put into offline queue.
- Background sync runs periodically.
- There is a 10 second offline sync loop.

Config update:

- `commands.rs` can receive config update command.
- Current code writes updated config to a Windows ProgramData path. Double-check exact path behavior before relying on remote config updates, because the normal runtime config path is usually under `C:\ProgramData\SvoePhoto\pos-agent`.

## INPAS / DualConnector

`pos-agent/src/inpas.rs` implements HTTP integration with INPAS SmartSale / DualConnector.

Default endpoint:

```text
http://localhost:9015
```

Protocol:

- XML over HTTP POST to root.
- Response field `39 == "1"` means success.

Operation codes used by current code:

- sale: `1`
- refund: `3`
- test: `26`
- settlement: `59`

Important request fields:

- field `00`: amount in kopecks.
- field `04`: currency, usually `643`.
- field `21`: timestamp.
- field `25`: operation code.
- field `27`: terminal id.
- field `14`: original RRN for refund.

Card payment:

- `pay(amount, description)` sends operation `1`.
- Returns approval code, RRN, terminal id, card mask, slip, raw response when available.

Refund:

- `refund(amount, original_rrn)` sends operation `3`.
- Original RRN is included in field `14`.
- Risk: notes say refund opcode `3` must be verified against the actual T-Business/INPAS profile. Some profiles may require void/cancel instead of refund.

Settlement:

- `settle()` sends operation `59`.
- Uses long timeout, about 600 seconds.
- Publishes `BankSettlement` result with receipt/report data.

SBP:

- `generate_sbp_qr` and `check_sbp_status` are present at command layer.
- Current INPAS XML profile code says SBP is not configured and returns failure.
- Do not assume SBP works without bank/DualConnector profile changes.

Encoding handling:

- INPAS responses may be mojibake.
- Current code decodes raw bytes carefully:
  - valid UTF-8 first.
  - charset from `Content-Type`.
  - XML declared encoding.
  - fallbacks: UTF-8, Windows-1251/CP1251, IBM866/CP866, KOI8-R.
- It scores decoded candidates.
- PAN/card values are masked.

Tests in `inpas.rs` cover:

- XML field parsing.
- refund request.
- settlement request.
- Windows-1251 decoding.
- card mask handling.
- response parsing.

## ATOL / fptr10

`pos-agent/src/atol.rs` is the current ATOL fiscal client.

Current backend order:

1. On Windows, if `dll_path` is configured, try DLL backend through `fptr10.dll`.
2. Configure COM port and baud rate.
3. Apply paper width setting.
4. If DLL init/open fails, log warning and fallback to HTTP.
5. On non-Windows or no DLL config, use HTTP backend.

This means old notes saying "ATOL via HTTP API only" are stale.

DLL backend:

- Implemented by `pos-agent/src/atol_ffi.rs`.
- Dynamically loads `fptr10.dll` with `LoadLibraryW`.
- Resolves libfptr functions with `GetProcAddress`.
- Wraps:
  - create/destroy
  - open/close
  - is_opened
  - apply single settings
  - set/get params
  - query data
  - process JSON
  - read/write device setting
  - error description

Default/current Soborny facts:

- DLL path: `C:\Program Files\ATOL\Drivers10\KKT\bin\fptr10.dll`.
- COM port: `COM9`.
- Baud rate: `115200`.

HTTP fallback:

- default endpoint `http://localhost:16732`
- uses `/api/v2/requests`
- older ATOL WebServer style.

ATOL operations exposed:

- `fiscal`
- `open_shift`
- `close_shift`
- `open_cash_drawer`
- `is_online`
- `shift_status`

Shift status:

- DLL mode can query actual shift status.
- Raw mapping:
  - `0` -> closed
  - `1` -> open
  - `2` -> expired
- HTTP fallback `shift_status` returns `None` because old HTTP path does not provide equivalent live query in current code.

Fiscal document types:

- `sell`
- `sellReturn`
- `sellCorrection`
- `sellReturnCorrection`

ATOL fiscal payload includes:

- operator name
- optional cashier INN
- items
- payments
- taxation type
- customer email/phone when present
- correction fields when relevant
- print options
- bank slip lines

Payment mapping:

- `cash` -> ATOL cash.
- `card`, `online`, `transfer`, `sbp`, `unknown` -> electronically.
- `prepaid`, `advance`, `subscription` -> prepaid.

Refund/correction amount behavior:

- Payment rows use explicit payments when provided.
- Refund amounts are normalized with absolute value where needed.
- If no payments are provided, code falls back to top-level payment method.

Paper width:

- ATOL setting id `285`.
- 57/58 mm -> value `2`.
- 80 mm -> value `1`.

Electronic receipt suppression:

- Code suppresses paper receipt only if customer contact is present.
- If contact is missing, it warns and prints paper.

Tests in `atol.rs` cover:

- paper width.
- item serialization.
- DLL/HTTP serialization.
- payment mapping.
- correction fields.
- cash drawer serialization.
- shift status mapping.
- bank slip lines.

## Telemetry

`pos-agent/src/telemetry.rs` publishes POS telemetry.

Loop behavior:

- initial delay about 5 seconds.
- interval from `[pos_telemetry]`, default 60 seconds.
- runs INPAS online check and ATOL online/status checks concurrently.

Telemetry fields include:

- terminal online
- fiscal online
- shift status
- timestamp
- agent identity

Online checks:

- INPAS:
  - if terminal id is configured, sends test operation `26`.
  - otherwise checks HTTP endpoint availability.
- ATOL:
  - in DLL mode checks real device opening/status.
  - in HTTP mode checks availability but may not know shift state.

Alerts:

- Sends `AgentAlert` to `{prefix}/alerts`.
- terminal offline -> warning.
- fiscal offline -> critical.

## Backend and print-api integration

Backend POS routes are under `backend/src/routes/pos.routes.ts`.

Important points:

- POS routes require permission `pos:use`.
- Opening shift creates DB shift with `fiscal_enabled=false` and can enqueue fiscal shift open command.
- Closing shift uses live fiscal state, not only `pos_shifts.fiscal_enabled`, to decide whether `shift_close` should be enqueued.
- Receipt creation checks whether fiscalization is required and whether an ATOL/fiscal shift is available.
- Refund/void/partial-refund flows enqueue fiscal commands when needed.

Important service:

- `backend/src/services/pos-fiscal-command.service.ts`

It:

- finds active online POS agent for studio.
- requires `agent_type='pos'`.
- requires active/online heartbeat within online window.
- inserts records into `pos_transactions`.
- enqueues fiscal/shift commands for print-api/MQTT path.
- logs/alerts if agent is missing or command fails.

Redis subscriber:

- `backend/src/services/redis-subscriber.service.ts`
- subscribes to `pos:*`.
- caches POS telemetry snapshots.
- relays `pos:transaction_update` and `pos:telemetry` to Socket.IO.
- emits fiscal success events.

print-api:

- routes MQTT topics between backend and agents.
- `print-api/src/mqtt/subscriber.rs` had a fix so generic telemetry does not consume POS telemetry.
- It publishes Redis channels such as:
  - `pos:transaction_update`
  - `pos:shift_update`
  - `pos:sbp_qr_ready`
  - `pos:telemetry`

Older infra migration mentioned tables:

- `agents`
- `agent_releases`
- `agent_update_commands`
- `infra_alerts`
- `alert_rules`
- `system_telemetry`
- `pos_transactions`
- `cameras`

## Fiscal state source of truth

Important architectural decision from 2026-05-20:

`pos_shifts.fiscal_enabled` is not the source of truth for pult/frontend.

The source of truth is live ATOL state from POS-agent telemetry:

- active POS agent exists.
- `fiscal_online=true`.
- `shift_status=open`.

Backend reads Redis key:

```text
pos:telemetry:{studio_id}
```

and exposes fiscal status with fields like:

- `ready`
- `available`
- `source`
- `shift_status`
- `checked_at`
- `opened_at`
- `opened_by`
- `command_status`

Frontend shift bar statuses:

- `ФР открыт ...`
- `ФР открыт на АТОЛ`
- `ФР не настроен`
- `ФР закрыт/истек`

Related fixes/commits:

- `32aef543`
- `45026329`
- `5bc8bfc2`
- `c61b6c48`
- `1ff6db05 Fix fiscal shift close source of truth`

## Payment finalization rule

Critical rule after 2026-05-27 no-paper test:

Bank approval is not enough to mark a card payment fully completed in UI.

Correct behavior:

1. Card payment is approved by bank.
2. Agent attempts fiscal receipt.
3. If fiscal receipt succeeds, payment completes.
4. If fiscal receipt fails after bank approval, keep payment pending/retryable.
5. Employee fixes local problem, usually inserts paper.
6. Employee retries receipt/fiscalization.
7. Do not ask customer to pay card again.

Old behavior:

- Card payment was treated as successful immediately after bank approval.
- No-paper fiscal failure could trigger reversal attempt.
- In the live test, reversal happened after bank approval and no-paper fiscal failure, but reversal itself failed.

Conclusion:

- Do not assume "no paper" means bank payment was cancelled.
- Receipt retry is primary recovery after approved card and failed fiscalization.
- Auto-reversal is not the primary recovery path for local fiscal failures after receipt creation.

## Cash drawer

Cash drawer support landed around 2026-05-13.

Notes:

- Old installed binary lacked `cash_drawer` / `openCashDrawer`.
- New Windows pos-agent was built and installed.
- Backup was created:
  - `C:\ProgramData\SvoePhoto\pos-agent\svf-pos-agent.exe.bak-cashdrawer-20260513-192740`
- DB constraint had to include transaction type `cash_drawer`.
- Migration:
  - `backend/database/migrations/zz_20260513_pos_cash_drawer_transaction.sql`
- print-api needed amount cast fix:
  - `pt.amount::float8 AS amount`

Related commit:

- `98c98661 Fix POS transaction amount casting`

Test transaction from notes:

- `f870773b-12f1-4bae-a8d1-115b2847458d`

## Bank settlement

`settlement` command exists in current `commands.rs`.

Flow:

- Backend/print-api publishes `PosSettlementCommand`.
- Agent calls INPAS operation `59`.
- Result is published as `BANK_SETTLEMENT`.
- Result includes report/receipt data when provided by INPAS.

Use this for end-of-day bank terminal totals, but verify exact bank processing profile before relying on it operationally.

## Refunds

Current INPAS refund behavior:

- operation code `3`.
- original RRN is sent as field `14`.

Risk:

- T-Business/INPAS profile may require a different operation for void/cancel versus refund.
- The note from 2026-05-27 explicitly says to verify this with real T-Business/INPAS profile.

If profile requires a different opcode:

1. patch `pos-agent/src/inpas.rs`.
2. run targeted tests:

```bash
cd pos-agent
cargo test inpas::tests
```

3. deploy to Soborny.
4. retest with real terminal.

## SBP

SBP command names and protobuf messages exist:

- `sbp_generate`
- `sbp_status`
- `PosSbpGenerateCommand`
- `PosSbpStatusCommand`

But current INPAS XML implementation returns failure because SBP is not configured in the DualConnector XML profile.

Do not mark SBP as production-ready until bank profile/API is confirmed and tested.

## Corrections

Correction receipt types are supported in ATOL JSON:

- `correction`
- `refund_correction`

Notes from 2026-05-27:

- 10 correction receipts were queued/completed on 2026-05-26.
- Local fiscal fields were empty in those notes.
- If legal proof is needed, verify OFD/FNS separately.

## Windows service behavior

`pos-agent/src/main.rs` handles Windows service lifecycle.

Behavior:

- `--console` runs agent directly.
- Without `--console`, runs as Windows Service `SvfPosAgent`.
- Handles stop/shutdown control event.
- Sets service status to running after a short startup period.

Useful Windows diagnostics:

```powershell
Get-Service SvfPosAgent
Start-Service SvfPosAgent
Stop-Service SvfPosAgent
Restart-Service SvfPosAgent
Get-Content C:\ProgramData\SvoePhoto\pos-agent\agent.log* -Tail 100
Get-Process | Where-Object { $_.ProcessName -match 'inpas|smart|java|prunsvc|prunmgr|atol|fptr' }
```

Do not paste real `config.toml` contents into chat or public docs.

## Smoke test notes

`scripts/pos-fiscal-smoke.md` contains a Soborny 21 ATOL/PAX smoke plan.

Before live tests:

- Confirm `SvfPosAgent` is running.
- Confirm active agent row in DB matches config `studio_id` and `agent_id`.
- Confirm print-api version routes POS telemetry and persists POS shift results.
- Confirm PAX terminal is reachable.
- Do not run sale/refund until bank terminal is definitely reachable.

Test classes:

- ATOL shift open/close smoke.
- Fiscal sale.
- Refund.
- No-paper fiscal retry.
- Cash drawer.
- Bank settlement.

Operational caution:

- Do not auto-reconcile bank-approved payments as failed just because local fiscal printing failed.
- Treat fiscal retry separately from bank charging.

## Direct terminal integration notes

From 2026-05-12 payment notes:

- PAX D230 Wi-Fi primarily talks to bank/acquirer.
- Direct integration usually needs ECR TCP/IP, POSLink/SDK, cloud API, or bank-provided processing protocol.
- Alfa/PAX S300 note said there is no built-in web server/API and DualConnector is obligatory in that setup.
- If DualConnector is required, we cannot fully bypass the POS PC.

Practical options listed in notes:

1. Stabilize current D230/INPAS/DualConnector + POS PC setup.
2. Move terminal integration to a dedicated mini-PC if current workstation is unstable.
3. Ask bank/processing provider for direct ECR Ethernet/TCP/IP/POSLink/cloud API options without DualConnector.

## Known stale notes

Treat these older statements as stale unless reverified:

- "ATOL only via HTTP API" - stale. Current code prefers `fptr10.dll` DLL backend.
- "Soborny POS agent disabled because no ATOL KKT" - stale. Later notes show Soborny ATOL 27F online through COM9 and POS agent deployed.
- "Card payment complete immediately after bank approval" - stale. Current intended behavior waits for fiscalization or keeps retryable pending state.
- "No-paper means reversal/auto-cancel path" - stale. No-paper after bank approval should lead to receipt retry.

## Verification commands

Narrow checks for POS agent work:

```bash
cd pos-agent
cargo fmt --check
cargo test
cargo check
```

Targeted INPAS checks:

```bash
cd pos-agent
cargo test inpas::tests
```

Targeted ATOL checks:

```bash
cd pos-agent
cargo test atol::tests
```

For print-api changes:

```bash
cd print-api
cargo fmt --check
cargo test
cargo check
```

For backend TypeScript changes:

```bash
cd backend
npx tsc --noEmit
npx vitest run
```

For Angular changes:

```bash
npm run build:check
```

Repository rule also mentions Hookify guardrails when available:

```bash
./.codex/local-marketplaces/angular-dev-hookify/plugins/angular-dev-hookify/scripts/angular-dev-hookify.sh --changed
```

## Development cautions

- Preserve user changes in the dirty worktree.
- Do not edit generated/dependency/cache paths: `dist/`, `backend/dist/`, `node_modules/`, `.angular/`.
- Treat `.codex/` as private local runtime/config memory.
- Do not expose secrets from config/logs.
- Use Kanel DB types for backend DB work.
- Use `unknown[]` for SQL params, not `any[]`.
- Backend logging should use pino/local logger helpers, not raw `console.*`.
- Angular touched code should follow modern standalone/signal/OnPush project rules.
- Do not run production build/deploy unless explicitly requested.

## Open risks / follow-up items

- Verify actual PAX model at Soborny because notes mention both D230 and AF6.
- Verify INPAS refund opcode `3` with real T-Business/INPAS profile.
- Verify SBP capability with bank/DualConnector profile before enabling any SBP UI promise.
- Verify OFD/FNS state for correction receipts if legal proof is needed.
- Check config update path in `commands.rs` before using remote config update operationally.
- Watch proto copies for divergence before changing `infra.proto`.
- Keep current rule that approved-card plus failed-fiscal remains retryable unless a verified bank reversal succeeded.
