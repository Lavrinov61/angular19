# PM2 Split Rollout Plan

**Статус:** IMPLEMENTED/PREFLIGHTED (2026-04-22), **NOT YET FLIPPED**
**Trigger:** следующая сессия после 48h observe (≥ 2026-04-23) + pgbouncer prereq
**Owner:** impl-infra + team-lead
**Rollback:** `/home/rostv/rollback.sh` (< 5 мин)

## Prereq Status — 2026-04-22

- PgBouncer поднят и проверен: `127.0.0.1:6432`, `SELECT 1` через `magnus_user` OK.
- PgBouncer config выровнен с планом: `max_client_conn=200`, `default_pool_size=25`, `reserve_pool_size=5`, `ignore_startup_parameters=extra_float_digits`.
- Исправлены несовместимые с PgBouncer 1.25.1 параметры: `idle_in_transaction_session_timeout` → `idle_transaction_timeout`, `tcp_keepalives` → `tcp_keepalive`; создан пустой `/etc/pgbouncer/pgbouncer.local.conf`.
- `userlist.txt` переведён на plaintext password с правами `0600`, чтобы PgBouncer мог выполнять server-login к PostgreSQL.
- `backend/src/database/db.ts`: PgBouncer-compatible pool config использует client-side `query_timeout`; `statement_timeout` больше не отправляется как startup parameter.
- `ecosystem.config.cjs`: при `SPLIT_ENABLED=true` создаёт 6 PM2 apps; API получает `PROCESS_ROLE=api`, API/SSR/workers получают `DB_PORT=6432`; scheduler остаётся на `DB_PORT=5432`.
- Scheduler/workers имеют HTTP `/health` на `127.0.0.1:3005..3008` и CLI `--health-check`.
- Prometheus observe snapshot за 48h: `ws_pubsub_emit_failed_total=0`, `ws_pubsub_dropped_total=0`, `http_requests_total{status_code=~"5.."}≈14`, 5xx за последние 10m = 0, API RSS max ≈494MB, process starts = 14/48h.
- `ws_pubsub_lag_ms` p95 пока `NaN`, потому что split worker→api bridge в monolith-режиме не даёт samples; после flip проверять T+5/T+30 по runbook.
- Flip по-прежнему не выполнен: текущая дата проверки — 2026-04-22, триггер плана — не раньше 2026-04-23.

## Мотивация

Monolith `magnus-photo-api` (PORT 3001) несёт:
- REST API + Socket.IO
- 12 schedulers (scheduler-leader.ts, advisory lock 737001)
- Outbound send queue (Telegram/VK/WA/MAX — см. sendmessage-gateway.ts)
- AI worker (Claude/OpenAI)
- Bot update handlers (bot-engine)

Симптомы перегруза (2026-04-21):
- PM2 137 restart/сутки по max_memory_restart=768M (см. PULT_NOTIFICATIONS_OBSERVABILITY)
- Пики памяти после DnD-операций + photo pipeline
- Schedulers конкурируют с hot path за event loop

Целевая топология — 6 процессов:

| Процесс | Скрипт | Port | PROCESS_ROLE | DB pool |
|---|---|---|---|---|
| magnus-photo-api | backend/dist/server.js | 3001 | monolith / api при split | 12 / 15 |
| magnus-photo-ssr | dist/magnus-photo/server/server.mjs | 4000 | — | — |
| magnus-photo-scheduler | backend/dist/scheduler.js | 3008 | scheduler | 3 (direct PG:5432) |
| magnus-photo-worker-ai | backend/dist/workers/ai.js | 3005 | worker-ai | 6 |
| magnus-photo-worker-outbound | backend/dist/workers/outbound.js | 3006 | worker-outbound | 8 |
| magnus-photo-worker-bot | backend/dist/workers/bot.js | 3007 | worker-bot | 6 |

## Prereq (выполнить ПЕРЕД flip)

### 1. pgbouncer установлен и настроен

```bash
sudo apt install pgbouncer
```

`/etc/pgbouncer/pgbouncer.ini`:
```ini
[databases]
magnus_photo_db = host=127.0.0.1 port=5432 dbname=magnus_photo_db

[pgbouncer]
listen_addr = 127.0.0.1
listen_port = 6432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 200
default_pool_size = 25
reserve_pool_size = 5
server_reset_query = DISCARD ALL
ignore_startup_parameters = extra_float_digits
```

SCRAM hash в `/etc/pgbouncer/userlist.txt` получить через:
```sql
-- от PG superuser:
SELECT 'magnus_user' AS usr, rolpassword FROM pg_authid WHERE rolname='magnus_user';
-- скопировать scram-hash в userlist.txt формата: "magnus_user" "SCRAM-SHA-256$...$..."
```

```bash
sudo systemctl enable --now pgbouncer
sudo systemctl status pgbouncer
psql "postgres://magnus_user:PASS@127.0.0.1:6432/magnus_photo_db" -c 'SELECT 1;'
```

**ВАЖНО:** scheduler-процесс идёт напрямую в PG:5432 (не через pgbouncer) —
`pg_try_advisory_lock(737001)` требует session mode, pgbouncer в transaction mode
теряет session-level locks.

### 2. Backend artefacts готовы

Phase 4.2/4.3/4.4 закоммичены и собраны:
- `backend/dist/scheduler.js` — Phase 4.2
- `backend/dist/workers/ai.js` — Phase 4.3
- `backend/dist/workers/outbound.js` — Phase 4.3
- `backend/dist/workers/bot.js` — Phase 4.4

Каждый worker экспонирует `/health` на своём PORT (3005/3006/3007/3008):
минимум `200 OK`, с `db` + `redis` checks; scheduler дополнительно отдаёт `leader`.

### 3. Grafana — 48h clean window

За последние 48h метрики должны быть «зелёные»:
- `ws_pubsub_failed_total` rate = 0
- `ws_events_dropped_total` rate = 0
- `ws_event_lag_ms` p95 < 50
- `api_http_5xx_total` rate < базовый уровень
- PM2 restart count API < 10/сутки (не 137)

## Flip procedure

1. **Бэкап состояния:**
   ```bash
   pm2 save
   ls -la /var/www/apimain/angular-app/ecosystem.config.cjs.pre-split-backup
   # Убедиться, что backup существует и актуальный (mtime ~ последний backend-деплой)
   ```

2. **Проверить условный ecosystem:**
   `ecosystem.config.cjs` больше не требует ручного раскомментирования.
   Без `SPLIT_ENABLED=true` он отдаёт 2 apps; с флагом — 6 apps.

3. **Верификация config:**
   ```bash
   cd /var/www/apimain/angular-dev
   node -e "require('./ecosystem.config.cjs')"   # should exit 0
   node -e "console.log(require('./ecosystem.config.cjs').apps.length)"  # should print 2
   SPLIT_ENABLED=true node -e "console.log(require('./ecosystem.config.cjs').apps.length)"  # should print 6
   ```

4. **Commit + push:**
   ```bash
   git add ecosystem.config.cjs ops/PM2_SPLIT_ROLLOUT_PLAN.md
   git commit -m "infra(pm2): activate split-ready process config"
   ```

5. **Deploy с флагом:**
   ```bash
   SPLIT_ENABLED=true ./deploy.sh all
   ```

## Verify post-flip (T+0, T+5min, T+30min, T+2h)

### T+0
- `pm2 list` — 6 процессов, все `online`
- `curl -sf http://localhost:3001/api/health`
- `curl -sf http://localhost:3005/health` (worker-ai)
- `curl -sf http://localhost:3006/health` (worker-outbound)
- `curl -sf http://localhost:3007/health` (worker-bot)
- `curl -sf http://localhost:3008/health` (scheduler)
- `curl -sf http://localhost:4000/ssr-health`

### T+5min
- Smoke: отправить сообщение в чат → проверить что ui видит
  (outbound worker работает) + bot-echo (bot worker работает)
- PG: `SELECT pg_try_advisory_lock(737001);` из psql должен вернуть `false`
  (scheduler держит лок — success). Если `true` — scheduler НЕ captured lock, проблема
- `journalctl -u pgbouncer --since "10 minutes ago"` — no errors

### T+30min
- Grafana: ws_events_dropped_total = 0, api memory < 600M (должно упасть с 700+M)
- Pult notifications — heartbeat работает (см. log-and-emit.ts)

### T+2h
- PM2 restart count = 0 по всем 6 процессам
- PG connections: `SELECT count(*) FROM pg_stat_activity WHERE usename='magnus_user';`
  должно быть ~35-40 (было ~12 monolith), не > 50

## Rollback trigger

Выполняем `/home/rostv/rollback.sh` немедленно если:
- любой health check `/health` fails > 2 min
- `api_http_5xx_total` rate > 5x baseline
- scheduler не захватывает advisory lock (оба процесса видят `pg_try_advisory_lock`=true
  или оба видят false — это split-brain или полная потеря lock)
- `ws_pubsub_failed_total` > 0 (Redis pub/sub пропускает события между процессами)
- PG connections > 80 (overflow)
- memory в любом процессе растёт линейно > 30 мин (leak)

Rollback:
```bash
/home/rostv/rollback.sh
# ~5 мин: restore backup, pm2 delete workers, pm2 restart api+ssr
```

## Post-rollback actions

1. Собрать логи: `pm2 logs --lines 1000 --nostream > /tmp/pm2-split-crash.log`
2. Сохранить ecosystem-snapshot: `cp /var/www/apimain/angular-app/ecosystem.config.cjs.split-broken ~/split-broken-$(date +%s).cjs`
3. Открыть incident ticket + прикрепить PG `pg_stat_activity` + `EXPLAIN ANALYZE` проблемных запросов
4. Убрать раскомментирование из dev-ecosystem, commit `revert: split rollback — [cause]`

## FAQ

**Q: Зачем scheduler на отдельном процессе, а не просто выделенная pg-сессия?**
A: Advisory lock привязан к BE PID в PG. Если process перезапускается (max_memory_restart,
OOM, crash) — lock выбрасывается, и leader-election отрабатывает штатно. При monolith'е
любой рестарт API => пересоздание lock. При split — scheduler рестартится реже
(у него меньше кода и утечек).

**Q: Почему kill_timeout=30000 для workers?**
A: BullMQ при SIGTERM дренит in-flight jobs до `gracefulShutdownTimeoutMs`. Если оборвать
раньше — висят stale jobs в `active` state, требуют manual cleanup через Redis CLI.

**Q: Почему scheduler ходит прямо в PG:5432?**
A: `pg_try_advisory_lock` — session-level. pgbouncer pool_mode=transaction возвращает
connection в пул после каждого TX → lock теряется. Поправить можно pool_mode=session
для отдельной базы — но это сводит к нулю смысл pgbouncer для schedulers.
Выбрали compromise: schedulers через 5432 (прямо), все остальные через 6432.

**Q: Что если pgbouncer крашится?**
A: api/workers видят `connection refused` → retries. Scheduler не задет (он на 5432).
Смотреть `journalctl -u pgbouncer -e`. Если pgbouncer флапит — rollback.sh и discussion
о перенесении схемы (node-pool на прикладном уровне вместо пулера).
