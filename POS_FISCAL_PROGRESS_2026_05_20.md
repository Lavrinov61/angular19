# Прогресс по ФР/АТОЛ 27Ф и POS

Дата: 2026-05-20, около 20:30 MSK.

## Главное решение

`pos_shifts.fiscal_enabled` больше нельзя считать источником истины по фискальной смене.

Источник истины для пульта: живое состояние АТОЛ из POS-agent telemetry:

- `fiscal_online=true`
- `shift_status=open`
- активный POS-agent у студии есть

БД теперь используется для истории и метаданных: кто инициировал открытие, когда была команда, статус команды. Если живой телеметрии нет, фискальная смена считается не подтвержденной устройством.

## Что уже сделано

Backend:

- `backend/src/services/pos-fiscal-shift.service.ts` читает `pos:telemetry:{studio_id}` и считает `fiscalReady` только по живому состоянию ФР.
- В API смены добавлен `fiscal_status`: `ready`, `available`, `source`, `shift_status`, `checked_at`, `opened_at`, `opened_by`, `command_status`.
- Если АТОЛ уже говорит `open`, но команда в БД еще `processing`, пульт все равно может показать открытую ФР-смену и кассира из инициированной команды.
- `backend/src/routes/pos.routes.ts`: команды ФР теперь назначаются только активному POS-agent. Для Баррикадной не должен выбираться старый неактивный агент.

Frontend:

- `src/app/features/employee/components/pos/components/pos-shift-bar.component.ts` показывает статус ФР в верхней панели:
  - `ФР открыт 13:00 Бутенко Оля`, если АТОЛ подтвердил открытую смену и есть метаданные;
  - `ФР открыт на АТОЛ`, если устройство подтвердило открытую смену, но кассир/время неизвестны;
  - `ФР не настроен`, если нет активного POS-agent;
  - `ФР закрыт` / `ФР истек`, если АТОЛ не подтверждает открытую смену.
- Кнопка `Открыть ФР` показывается только когда ФР доступен и фискальная смена не подтверждена.

POS-agent / print-api:

- POS-agent на Соборном читает состояние смены через АТОЛ и публикует telemetry.
- `print-api/src/mqtt/subscriber.rs` исправлен: generic telemetry больше не забирает `pos/telemetry`, POS telemetry идет в отдельный обработчик.

## Деплой и проверки

Задеплоено:

- `./deploy.sh all` прошел успешно, все основные сервисы healthy.
- `cd print-api && cargo build --release` прошел успешно.
- `sudo -n systemctl restart print-api` выполнен, `print-api` active.
- `curl -sf http://localhost:3004/api/print/health` вернул `status=ok`.

Проверки:

- `cd backend && npx vitest run src/services/pos-fiscal-shift.service.test.ts src/services/redis-subscriber.service.test.ts` - passed.
- `cd backend && npx tsc --noEmit` - passed.
- `cd print-api && cargo test` - 80 passed.
- `cd print-api && cargo fmt --check` - passed.
- `npm run build:check` - passed, только старые Angular warnings.
- hookify changed-file guard - passed.

Relevant commits:

- `32aef543 Use device confirmation for fiscal shifts`
- `45026329 Read fiscal shift state from ATOL`
- `5bc8bfc2 Show ATOL fiscal shift status in POS`
- `c61b6c48 Fix POS telemetry cache readiness`

Отдельный последний фикс по почте:

- `9aeadb86 Fix inbound mail attachment storage`

## Факты по студиям на 2026-05-20

Соборный 21:

- `studio_id=30ef357f-06a6-4b01-b1ff-dbbe7eaed446`
- POS-смена `#17` открыта `2026-05-20 13:00:58 MSK`.
- В БД открывшая смену: `Бутенко Оля`.
- Команда ФР: `shift_open`, initiated `2026-05-20 13:00:58 MSK`, cashier `Бутенко Оля`, status в БД был `processing`.
- Лог Windows POS-agent ранее показывал:
  - `ATOL open shift cashier="Бутенко Оля"`
  - telemetry с `fiscal=true`, `shift_status="open"`.

2-я Баррикадная:

- `studio_id=a16b2e19-8c31-42b4-88f6-aa2cce3c1b69`
- POS-смена `#18` открыта `2026-05-20 17:30:15 MSK`.
- Активного POS/FR agent сейчас нет, поэтому ФР-кнопка там не должна быть рабочей/видимой как доступная.

## Где остановились

После перезапуска `print-api` логи уже показывали POS telemetry:

```text
POS telemetry studio=30ef357f-06a6-4b01-b1ff-dbbe7eaed446 terminal=false fiscal=true
```

Но проверка backend cache до следующего события показала:

```text
cached: null
fiscalStatus.source: none
fiscalReady: false
```

Нужно завтра закончить именно цепочку:

```text
POS-agent -> MQTT -> print-api -> Redis pub/sub pos:telemetry -> backend RedisSubscriberService -> cache pos:telemetry:{studio_id} -> pult API
```

Также видно отдельное предупреждение:

```text
Skipping malformed agent alert payload studio=30ef357f-06a6-4b01-b1ff-dbbe7eaed446 agent_type="pos"
```

Вероятная причина: POS-agent отправляет `AgentAlert` protobuf в `svoefoto/{studio}/pos/alerts`, а `print-api` generic alert handler сейчас ожидает JSON. Это не должно ломать fiscal telemetry, но предупреждение надо исправить отдельной правкой: либо декодировать protobuf alert для POS, либо унифицировать формат alert.

Диагностический Redis-подписчик `npx tsx ... psubscribe('pos:*')` был запущен перед остановкой работы и затем остановлен вручную (`kill 7589`).

## Обновление после продолжения, 2026-05-20 22:35 MSK

Найдена и исправлена причина, почему backend видел live `PUBLISH pos:telemetry`, но `pos:telemetry:{studio_id}` оставался `null`.

Причина: `redis-cache.service.ts` создавал lazy Redis client с `enableOfflineQueue=false`; первый `cacheSet/cacheGet` мог выполняться до состояния `ready`, ioredis fail-fast отклонял команду, а cache service глушил ошибку. Из-за этого первое POS telemetry событие после старта backend терялось.

Сделано:

- `backend/src/services/redis-cache.service.ts`: cache операции ждут Redis `ready` до 1500 ms перед `get/set/del`.
- `backend/src/services/redis-cache.service.test.ts`: добавлен тест, что cache write/read ждут ready-состояние lazy Redis client.
- `print-api/src/mqtt/mod.rs`: убрана дублирующая подписка на `svoefoto/+/pos/telemetry`; POS telemetry приходит через общий wildcard и дальше маршрутизируется POS handler.
- `print-api/src/mqtt/subscriber.rs`: `pos/alerts` теперь разбирает и legacy JSON, и protobuf `infra_proto::AgentAlert`; предупреждение `Skipping malformed agent alert payload` для POS-alert больше не должно появляться.

Новые проверки:

- `cd backend && npx vitest run src/services/redis-cache.service.test.ts src/services/pos-fiscal-shift.service.test.ts src/services/redis-subscriber.service.test.ts` - 7 passed.
- `cd backend && npx tsc --noEmit` - passed.
- `cd print-api && cargo fmt --check` - passed.
- `cd print-api && cargo test` - 82 passed.
- `cd print-api && cargo build --release` - passed.
- `sudo -n systemctl restart print-api` - service active, `/api/print/health` ok.
- `./deploy.sh all` - backend, frontend, SSR healthy.

Живая проверка после деплоя:

Соборный 21:

```json
{
  "telemetry": {
    "terminal_online": false,
    "fiscal_online": true,
    "shift_status": "open",
    "agent_id": "0affa6d8-4ea9-4ce6-b54d-ef5cfe6e02ca"
  },
  "fiscalReady": true,
  "source": "telemetry",
  "opened_at": "2026-05-20T10:00:58.633Z",
  "opened_by": "Бутенко Оля",
  "command_status": "processing"
}
```

2-я Баррикадная:

```json
{
  "telemetry": null,
  "fiscalReady": false,
  "fiscalAvailable": false,
  "source": "none"
}
```

Итог: пульт теперь должен показывать Соборному открытую ФР-смену по данным АТОЛ, с временем открытия и кассиром. Баррикадная остается без доступного ФР, потому что активного POS/FR agent там нет. Банковский терминал на Соборном сейчас по telemetry `terminal_online=false`.

## Если завтра продолжать

Цепочка `POS-agent -> MQTT -> print-api -> Redis pub/sub -> backend RedisSubscriberService -> cache -> pult API` после продолжения подтверждена. Ниже оставлены команды для повторной диагностики, если статус снова начнет расходиться с АТОЛ.

1. Повторить cache/status проверку после свежей POS telemetry:

```bash
npx tsx <<'TS'
import db from './backend/src/database/db.js';
import { cacheGet } from './backend/src/services/redis-cache.service.js';
import { getFiscalShiftStatusForShift } from './backend/src/services/pos-fiscal-shift.service.js';

const studioId = '30ef357f-06a6-4b01-b1ff-dbbe7eaed446';
const shift = await db.queryOne<{id:string;studio_id:string;opened_at:string|null;status:string|null;shift_number:number;}>(
  `SELECT id, studio_id, opened_at, status, shift_number
   FROM pos_shifts
   WHERE studio_id=$1 AND status='open'
   ORDER BY opened_at DESC
   LIMIT 1`,
  [studioId],
);
const cached = await cacheGet<unknown>(`pos:telemetry:${studioId}`);
const fiscalStatus = shift ? await getFiscalShiftStatusForShift(shift) : null;
console.log(JSON.stringify({ shift, cached, fiscalStatus }, null, 2));
process.exit(0);
TS
```

Ожидаемый результат для Соборного: `cached.shift_status="open"`, `cached.fiscal_online=true`, `fiscalStatus.fiscalReady=true`, `opened_by="Бутенко Оля"`.

2. Если cache снова `null`, проверить Redis pub/sub напрямую:

```bash
npx tsx <<'TS'
import Redis from 'ioredis';
import { config } from './backend/src/config/index.js';

const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  ...(config.redis.tls ? { tls: config.redis.tls } : {}),
});

redis.on('pmessage', (_pattern, channel, message) => {
  console.log(JSON.stringify({ channel, message }));
  redis.disconnect();
});

await redis.psubscribe('pos:*');
setTimeout(() => {
  console.log(JSON.stringify({ channel: null, message: null, note: 'timeout' }));
  redis.disconnect();
}, 70000);
TS
```

3. Если Redis событие приходит, но cache не пишется:

- смотреть `RedisSubscriberService.handleInfraMessage`;
- добавить точечный лог/cache test;
- проверить, что API process реально подписан на `pos:*` после deploy.

4. Если Redis событие не приходит:

- проверить `print-api` publish result для `pos:telemetry`, сейчас publish error там глушится;

## Обновление 2026-05-20 23:10 MSK

После повторной проверки фактов по Соборному:

- Последняя подтвержденная команда закрытия ФР: `shift_close`, `completed`, `2026-05-18 11:08:23 MSK`, transaction `6ad7aa8a-5729-4bc9-8a04-1928bf48d953`.
- На ПК Соборного POS-agent обработал закрытие в `2026-05-18 11:08:14 MSK`: `ATOL close shift (Z-report) cashier="Кассир"`.
- Текущая фискальная смена открыта сегодня, `2026-05-20 13:00:57 MSK` на POS-agent: `Processing shift command ... action=open cashier=Бутенко Оля`, затем `ATOL open shift cashier="Бутенко Оля"`.
- В БД POS-смена #17 открыта `2026-05-20 13:00:58 MSK`, сотрудник `Бутенко Оля`.
- Текущая live telemetry от АТОЛ: `fiscal_online=true`, `shift_status=open`, `terminal_online=false`.

Исправлена найденная backend-дыра при закрытии:

- До фикса `/pos/shifts/close` отправлял `shift_close` только если закрытая строка `pos_shifts.fiscal_enabled=true`.
- Это было неверно после перехода на источник истины от АТОЛ, потому что строка смены может не быть надежным индикатором текущей фискальной смены.
- Теперь route перед закрытием POS-смены вызывает `isFiscalShiftOpenForShift(shift_id)` и, если это последняя открытая POS-смена студии, отправляет `shift_close` по факту живого состояния ФР.

Файлы:

- `backend/src/routes/pos.routes.ts`
- `backend/src/routes/pos.routes.test.ts`

Проверки:

- `cd backend && npx vitest run src/routes/pos.routes.test.ts -t "sends shift_close when ATOL reports"` - сначала падал на `zReportSent=false`, после фикса passed.
- `cd backend && npx vitest run src/routes/pos.routes.test.ts src/services/pos-fiscal-shift.service.test.ts src/services/redis-cache.service.test.ts src/services/redis-subscriber.service.test.ts` - 54 passed.
- `cd backend && npx tsc --noEmit` - passed.
- hookify changed-file guard - passed.
- `./deploy.sh all` - backend/frontend/SSR healthy.

Коммит:

- `1ff6db05 Fix fiscal shift close source of truth`
- временно логировать ошибку `redis::cmd("PUBLISH")` в `handle_pos_telemetry`.

5. После подтверждения cache:

- проверить API ответа смены для Соборного;
- проверить в браузере сотрудника Оли на Соборном, что пульт показывает время открытия ФР и кассира;
- проверить Баррикадную: ФР недоступен, так как активного POS/FR agent там нет.

## План на 2026-05-25: ФД 4773 и чек коррекции

Утром перед любыми операциями с чеком коррекции:

1. Обновить POS-контур до фикса `93d4f4d3 Fix ATOL fiscal item measurement unit`:
   - серверный `print-api`;
   - `SvfPosAgent` на Windows-ПК Соборного.
2. Перезапустить `print-api` и службу `SvfPosAgent` на ПК Соборного.
3. Проверить, что Соборный пульт видит ФР как настроенный/доступный, а POS-agent публикует live telemetry.
4. Сделать короткую техническую проверку, что новый фискальный payload для АТОЛ содержит `measurementUnit="piece"` в позициях.
5. Только после обновления разбирать ФД 4773 от `2026-05-24`: чек не принят ФНС из-за отсутствующего тега `2108`; оформить чек коррекции по регламенту ОФД/бухгалтерии.

Отдельная продуктовая дыра кассы, которую нужно закрыть после коррекции:

- история продаж по сменам;
- просмотр самой смены;
- карточка/журнал чека;
- действия с чеком: копия, возврат, чек коррекции, статус ФНС/ОФД.

## Текущий dirty worktree

После коммитов остались не относящиеся к этому фиксу артефакты/локальные файлы:

- `.cursorignore`
- `print-api/target/release/print-api`
- `print-api/target/release/print-api.d`
- удаленный `скриншоты/BACKEND_INTEGRATION_QUESTIONS.md`
- untracked notes/tarballs/scripts, включая `scripts/pos-fiscal-smoke.md`

Не откатывать это автоматически. Разбирать отдельно, если потребуется.
