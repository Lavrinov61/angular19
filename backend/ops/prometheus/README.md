# Prometheus Alert Rules

Prometheus alerting rule files, loaded by the scrape configuration.

## Deploy

1. Скопировать файлы в `/etc/prometheus/rules.d/`:
   ```
   scp backend/ops/prometheus/*.rules.yml root@84.38.189.58:/etc/prometheus/rules.d/
   ```
2. Проверить синтаксис:
   ```
   promtool check rules /etc/prometheus/rules.d/fleet.rules.yml
   promtool check rules /etc/prometheus/rules.d/circuit-breaker.rules.yml
   ```
3. Reload Prometheus:
   ```
   curl -X POST http://localhost:9090/-/reload
   ```
4. Проверить активные правила:
   ```
   curl -s http://localhost:9090/api/v1/rules | jq '.data.groups[] | .name'
   ```

## Fleet Management Rules

Файл: `fleet.rules.yml`

| Name | Severity | Purpose |
|------|----------|---------|
| FleetAllPrintersOffline | critical | Весь парк offline >5m (сетевая катастрофа) |
| FleetAlertsActiveSpike | warning | >5 новых алертов за 10m |
| FleetDashboardSummarySlow | warning | p95 latency summary >100ms |
| PrinterPollTimeoutRate | warning | SNMP timeout >30% для принтера |
| FleetSupplyCritical | warning | Расходник <10% >30m |
| FleetPrinterStaleOffline | info | Offline >1h |

## Circuit Breaker Rules

Файл: `circuit-breaker.rules.yml`

| Name | Severity | Purpose |
|------|----------|---------|
| CircuitBreakerOpenTooLong | critical | Breaker OPEN >2m (внешний сервис down) |
| CircuitBreakerFallbackHigh | warning | Rate отклонений >10 req/s |
| CircuitBreakerFlapping | warning | >5 трипов за 15m (intermittent) |
| CircuitBreakerCallSlow | warning | p95 длительность >3s (degradation) |

Метрики (emitted by `backend/src/services/metrics.service.ts`):

- `circuit_breaker_state{name}` — 0=CLOSED, 1=HALF_OPEN, 2=OPEN (gauge)
- `circuit_breaker_trips_total{service}` — CLOSED→OPEN transitions (counter)
- `circuit_breaker_recovered_total{service}` — HALF_OPEN→CLOSED (counter)
- `circuit_breaker_fallback_requests_total{service}` — rejected calls during OPEN (counter)
- `circuit_breaker_call_duration_seconds{service}` — duration of successful CLOSED-state calls (histogram)
