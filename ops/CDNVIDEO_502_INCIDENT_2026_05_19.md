# CDNvideo 502 Incident, 2026-05-19

## Summary

On 2026-05-19, `svoefoto.ru` started returning intermittent `502` responses through CDNvideo.
The origin server itself stayed healthy: direct origin checks returned `200`, and origin nginx logs did not contain matching `502` or `504` responses.

Current working hypothesis: the failure is in CDNvideo's edge/origin-fetch path, not in the application backend or origin nginx.

No credentials, tokens, raw customer logs, or secret-bearing values are stored in this document.

## Affected Surface

- Public site: `https://svoefoto.ru/`
- Auth page and client application chunks
- API calls through the same domain:
  - `/api/health/ready`
  - `/api/booking/studios`
  - `/api/booking/alerts`
  - `/api/auth/me`
  - `/api/fingerprint/secret`
- Socket.IO polling requests through `/socket.io/`
- Service worker fetches for Angular chunks and `ngsw.json`

## CDNvideo Resource

- CDNvideo account: `ropacemo51`
- HTTP resource id: `xyt3ata9d4`
- Resource name: `svoefoto-test`
- CDN domain: `xyt3ata9d4.a.trbcdn.net`
- Desired CNAME / public host: `svoefoto.ru`
- Origin: `84.38.189.58:443`
- Origin Host/SNI: `svoefoto.ru`
- HTTPS to origin: enabled
- SSL verification: enabled
- Resource active: yes
- Cache state from API: `cache.disable=true`

Important: because `cache.disable=true`, current `502` responses are not explained by cached `5xx` objects.

## Timeline

All local times are Europe/Moscow unless stated otherwise.

### 2026-05-19 08:00-09:27

CDNvideo raw logs for `2026-05-19 05:00-07:00 UTC` were downloaded and aggregated.

Findings:

- Total CDN log lines: `2580`
- CDN status counts:
  - `1263 x 502`
  - `1263 x 200`
  - `30 x 302`
  - `10 x 201`
  - `6 x 404`
  - `3 x 499`
  - `3 x 304`
  - `2 x 504`
- All CDN responses in the sampled log were `MISS`
- `5xx` responses were all for host `svoefoto.ru`
- Top `502` paths included:
  - `/`
  - `/manifest.webmanifest`
  - `/ngsw.json`
  - `/api/fingerprint/secret`
  - Angular JS chunks
  - `/api/booking/studios`
  - `/api/booking/alerts`
  - `/api/auth/me`
  - `/socket.io/`

In the same interval, origin nginx access logs showed:

- `0 x 502`
- `0 x 504`
- Successful origin traffic continued to be logged

This means many CDN `502` responses did not appear as origin nginx `502/504` responses.

### 2026-05-19 09:30-09:35

Direct origin checks were healthy:

- `https://svoefoto.ru/health` via local origin resolve: `200`
- `https://ws.svoefoto.ru/health`: `200`
- API health on `127.0.0.1:3001`: healthy
- SSR on `127.0.0.1:4000`: healthy
- nginx service: active
- PM2 processes: online

Public CDN checks were unstable:

- `/`: intermittent `502`
- `/health`: intermittent `502`
- `/api/health/ready`: intermittent `502`
- `/ngsw.json` and `/manifest.webmanifest`: sometimes `200`, sometimes `502`

Known CDN request ids captured during the incident:

- `10d2292d9dc6fa4dd9123749c046dfa8`
- `3ba58ab6b770c126beb1b786fffe7592`
- `55cc8794a704e91e31a8ff99576078ed`
- `1085d84a4cd369d93a19343748fbae12`
- `a884eec1a409afd410904eec962f831f`
- `ee2162ef0bbdefda298ee7bac7a976ec`
- `63552d1f432f89566ae2dfb52458f9ec`

Observed CDN edge ids included:

- `2009`
- `2016`
- `2018`
- `2022`
- `2026`

### 2026-05-19 09:36

A full CDN cache purge was requested through CDNvideo API.

Request:

- Account: `ropacemo51`
- Endpoint: `POST https://api.cdnvideo.ru/app/cache/v3/ropacemo51/tasks`
- Domain: `svoefoto.ru`
- Action: `delete`
- Action type: `full`
- Extra zones: enabled

Task:

- `55bfcf4c-e583-4a02-98b2-dfed3ac293b4`

Status after repeated polling:

- `processing`

The purge did not immediately remove the intermittent `502` behavior.

### 2026-05-19 09:40-09:42

A controlled CDN monitoring slice was collected.

Artifact:

- `/tmp/svoefoto-cdn-monitor-20260519-094039-2min.tsv`

Summary:

- `45 x 200`
- `39 x 502`

Per-path sample:

- `/`: `3 x 200`, `9 x 502`
- `/health`: `8 x 200`, `4 x 502`
- `/api/health/ready`: `5 x 200`, `7 x 502`
- `/api/booking/studios`: `8 x 200`, `4 x 502`
- `/api/booking/alerts`: `5 x 200`, `7 x 502`
- `/ngsw.json`: `8 x 200`, `4 x 502`
- `/manifest.webmanifest`: `8 x 200`, `4 x 502`

This confirmed the issue affected both static files and API requests.

### 2026-05-19 09:43

Global DNS was not changed.

Instead, a local hosts bypass was added on Soborny PC only.

Host:

- `MAGNUSPHOTO`
- Windows user: `info`
- SSH alias: `soborny-pc`

Hosts entry added:

```text
84.38.189.58 svoefoto.ru www.svoefoto.ru
```

Backup created:

```text
C:\WINDOWS\System32\drivers\etc\hosts.codex-backup-20260519-094310
```

After `ipconfig /flushdns`, Soborny PC resolved `svoefoto.ru` directly to:

```text
84.38.189.58
```

Verification from Soborny PC:

- `https://svoefoto.ru/health`: `200`
- Remote IP: `84.38.189.58`
- Server header: `nginx/1.28.3`
- No `x-cdn-*` headers

This confirmed the Soborny PC bypasses CDNvideo for `svoefoto.ru`.

### 2026-05-19 09:59

Public DNS was temporarily switched away from CDNvideo by replacing the apex CDN record with a direct origin record.

Verified DNS state:

- `A svoefoto.ru -> 84.38.189.58`
- TTL: `3600`
- Previous apex `ALIAS svoefoto.ru -> xyt3ata9d4.a.trbcdn.net` no longer present
- Previous `edge.svoefoto.ru -> xyt3ata9d4.a.trbcdn.net` no longer present

Authoritative Selectel nameservers and the local resolver returned:

```text
84.38.189.58
```

HTTP verification through the public hostname returned:

- `https://svoefoto.ru/`: `200`
- Server header: `nginx/1.28.3`

### 2026-05-19 10:30-10:36

Public DNS was returned to the CDNvideo path.

Verified Selectel DNS state:

- `ALIAS svoefoto.ru -> xyt3ata9d4.a.trbcdn.net.`
- `CNAME edge.svoefoto.ru -> xyt3ata9d4.a.trbcdn.net.`
- The temporary apex `A svoefoto.ru -> 84.38.189.58` record was removed
- Authoritative Selectel nameservers resolved the apex through the CDNvideo target

The CDNvideo target resolved to:

```text
xyt3ata9d4.a.trbcdn.net -> 151.236.81.32
```

After the DNS rollback to CDNvideo, controlled checks still reproduced intermittent CDN `502` responses while direct origin checks remained healthy.

### 2026-05-19 10:41-10:44

Nginx protection and firewall checks were performed to test whether origin-side security settings caused the CDN `502` responses.

Relevant nginx protections on `svoefoto.ru`:

- scanner blocks for `.php`, `.sql`, `wp-*`, `.env`, `.git`, and similar paths return `444`;
- general `/api/` location uses `limit_req zone=api burst=600 nodelay`;
- general `/api/` location uses `limit_conn addr 30`;
- CDNvideo real IP ranges are trusted via `set_real_ip_from`, so nginx limits are applied to the real client IP from `X-Forwarded-For`, not to the CDN edge as one shared client.

Firewall/security state:

- UFW allows inbound `80/tcp` and `443/tcp`;
- fail2ban `nginx-scanner` had `0` currently banned IPs;
- kernel/UFW logs around the test window showed blocks only for unrelated ports, not `80` or `443`;
- no recent nginx `limit_req` or `limit_conn` errors were found for the test window.

Marker test:

- Marker: `codex-nginxguard-1779176483`
- CDN path tested through `xyt3ata9d4.a.trbcdn.net` with Host/SNI `svoefoto.ru`
- CDN results for `/api/health/ready`: `9 x 200`, `11 x 502`
- Direct origin results for `/api/health/ready`: `4 x 200`
- Origin nginx access log contained `13` marker entries, all `200`
- Origin nginx access log contained `0` marker entries with `502`
- Origin nginx error log contained `0` marker entries

The `13` access log entries correspond exactly to the `9` successful CDN responses plus the `4` direct-origin responses. The `11` CDN `502` responses did not arrive at origin nginx as HTTP requests.

Additional CDN header sample for a failed response:

- HTTP status: `502`
- `x-cdn-edge-id: 2009`
- `x-cdn-edge-cache: MISS`
- CDN request id: `1cb932bbdf9cb4851956b4f78b387d8f`

Conclusion: current evidence does not support nginx request protections, fail2ban, UFW, or origin upstream failure as the primary cause. The failure is still best localized to CDNvideo's edge/origin-fetch path before the request reaches origin nginx.

### 2026-05-19 11:02-11:09

CDNvideo API configuration was rechecked through the official resource endpoint:

```text
GET https://api.cdnvideo.ru/cdn/api/v1/ropacemo51/resource/http/xyt3ata9d4
```

Selected API state:

- resource active: `true`
- CDN domain: `xyt3ata9d4.a.trbcdn.net`
- public name: `svoefoto.ru`
- origin server: `84.38.189.58:443`
- origin hostname: `svoefoto.ru`
- origin SNI hostname: `svoefoto.ru`
- origin HTTPS: `true`
- origin SSL verification: `true`
- cache disabled: `cache.disable=true`
- cache version: `4`
- locations: none
- limitations: none
- return/rewrite rules: none

The earlier full purge task was also rechecked:

```text
GET https://api.cdnvideo.ru/app/cache/v3/ropacemo51/tasks/55bfcf4c-e583-4a02-98b2-dfed3ac293b4
```

Result:

- status: `ok`
- rate: `100`

A short broad retest initially returned `200` for all sampled CDN requests:

- artifact: `/tmp/svoefoto-cdn-recheck-codex-cdn-recheck-20260519-110356-839513.tsv`
- CDN checks: `40 x 200`
- direct origin checks: `15 x 200`
- origin nginx access entries for the marker: `55 x 200`
- origin nginx error entries for the marker: `0`

A narrower retest of `/api/booking/studios` immediately reproduced the failure again:

- artifact: `/tmp/svoefoto-cdn-failids-codex-cdn-failids-20260519-110618-845869.tsv`
- CDN target: `151.236.81.32`
- CDN edge id: `2009`
- CDN results: `5 x 200`, `18 x 502`, `2 x 504`
- all CDN responses were `MISS`
- origin nginx access entries for the marker: `5 x 200`
- origin nginx error entries for the marker: `0`

Sample failed CDN request ids from that retest:

- `8ef9a27489ec206c3147f6556775f7ec`
- `da3e4950dc46f48afb522cf99a776888`
- `2dfdd0d8d2abe815d6c3b43bfc69381f`
- `1e270f1be5b5b4397bb05e267fb39971`
- `e94e5ac6ce720b1b2391a268418fa8ed`
- `ff2d8d1dad638af248884fc0b284ea4e`

The same path was then checked against several CDNvideo IPs returned by DNS:

- artifact: `/tmp/svoefoto-cdn-ipmatrix-codex-cdn-ipmatrix-20260519-110820-850607.tsv`
- `151.236.81.32`, edge `2009`: `3 x 200`, `5 x 502`
- `151.236.102.200`, edge `2010`: `5 x 200`, `3 x 502`
- `91.238.111.248`, edge `2015`: `4 x 200`, `3 x 502`, `1 x 504`
- `91.238.111.224`, edge `2024`: `5 x 200`, `3 x 502`
- origin nginx access entries for the marker: `17 x 200`

This shows that the error is not isolated to one DNS answer or one CDN edge id. The CDNvideo control-plane configuration currently looks correct, but the data-plane path from multiple CDNvideo edges to the origin remains unstable.

### 2026-05-19 11:13-11:15

A no-op resource reapply was performed through CDNvideo API. The current resource configuration was fetched, reduced to configurable fields, and sent back to the same endpoint without intentional behavior changes:

```text
PUT https://api.cdnvideo.ru/cdn/api/v1/ropacemo51/resource/http/xyt3ata9d4
```

CDNvideo accepted the reapply task:

- status: `accept`
- task id: `20260519111413713999`

Post-reapply API verification showed the same effective configuration:

- origin server: `84.38.189.58:443`
- origin hostname/SNI: `svoefoto.ru`
- origin HTTPS: `true`
- origin SSL verification: `true`
- cache disabled: `cache.disable=true`
- cache version: `4`
- public name: `svoefoto.ru`
- locations: none

HTTP protocol check before reapply did not show a clean client-side HTTP/2-only failure:

- forced HTTP/1.1 via CDNvideo: `2 x 200`, `9 x 502`, `1 x 504`
- forced HTTP/2 via CDNvideo: `2 x 200`, `7 x 502`, `3 x 504`

Post-reapply CDN test:

- artifact: `/tmp/svoefoto-cdn-after-reapply-codex-cdn-after-reapply-20260519-111445-866668.tsv`
- CDN target: `151.236.81.32`
- CDN edge id: `2009`
- CDN results: `10 x 200`, `15 x 502`
- direct origin results: `8 x 200`
- origin nginx access entries for the marker: `18 x 200`
- origin nginx error entries for the marker: `0`

Sample failed CDN request ids after reapply:

- `8576a6126e55c8eaaaeb3785de7c01ba`
- `1a22af8a6848fc6cc36652e8818a0f2d`
- `a7ab3bf5f1b7b80948a086c0a3631d43`
- `af0a9c34a08bf9f4e9517bdd837208e8`
- `a069251156adfdc5173b27a0a7572606`

Conclusion: forcing a resource reapply from the customer API did not clear the intermittent CDNvideo `502` behavior.

## Evidence Against Origin Failure

- Direct origin health checks returned `200`.
- PM2 API and SSR processes were online.
- nginx was active.
- Origin nginx logs had no matching `502/504` responses for the CDN error window.
- Marker tests showed CDN `502` responses absent from origin nginx access/error logs, while successful CDN responses and direct origin checks were logged as `200`.
- Multiple CDNvideo edge ids produced `502/504` while direct origin checks and logged origin requests stayed `200`.
- UFW allowed `80/443`, fail2ban had no active `nginx-scanner` bans, and nginx had no recent `limit_req` or `limit_conn` errors for the test window.
- CDN raw logs reported many `502/504` responses as `MISS`.
- CDN `502` responses affected unrelated paths: HTML, Angular chunks, API, webmanifest, service worker, Socket.IO polling.

## User-Visible Symptoms

Browser console showed:

- Angular/service worker fetch failures for JS chunks
- `HttpClient` `502` responses for booking API endpoints
- Socket.IO polling failures
- Visitor chat connection errors
- Login/profile page partially loaded while follow-up static/API requests failed

## Current State

- Origin is healthy.
- CDNvideo remains unstable in observed samples.
- CDN full purge task completed with `status=ok` and `rate=100`.
- Soborny PC has a local hosts bypass and should reach the origin directly.
- Public DNS was returned to CDNvideo through Selectel `ALIAS svoefoto.ru -> xyt3ata9d4.a.trbcdn.net.`.
- The temporary public apex `A svoefoto.ru -> 84.38.189.58` record was removed.
- `edge.svoefoto.ru` was restored as `CNAME edge.svoefoto.ru -> xyt3ata9d4.a.trbcdn.net.`.
- Authoritative Selectel nameservers currently resolve the apex through CDNvideo. Some recursive resolvers may still return different CDNvideo edge IPs because the CDN target itself resolves differently by resolver/location.
- An SLA/RCA request has been sent to CDNvideo after the diagnostics below were prepared.

## CDNvideo SLA/RCA Request

### 2026-05-19 12:06

The operator reported that an email was sent to CDNvideo regarding this incident.

The request asks CDNvideo to:

- register the incident for `2026-05-19`;
- confirm the CDNvideo-side failure window, observed by us as approximately `09:00-12:00 MSK`;
- provide RCA for intermittent `MISS 502/504` responses from the CDN edge/origin-fetch path;
- explain why failed CDN requests did not reach origin nginx while direct origin checks returned `200`;
- inspect the affected resource `xyt3ata9d4` across multiple edge/origin-fetch clusters;
- check the customer full purge task `55bfcf4c-e583-4a02-98b2-dfed3ac293b4`;
- check the customer no-op reapply task `20260519111413713999`;
- provide the exact degradation window according to CDNvideo monitoring;
- state what remediation was performed or will be performed to avoid recurrence;
- review a May 2026 SLA discount/credit according to CDNvideo service terms.

SLA context from CDNvideo public terms:

- CDN tariffs are publicly advertised with `SLA 99.9%`.
- The public offer contains an SLA section covering continuous operation of the CDN and availability of customer content delivery.
- The offer states that a written discount request must be sent within 30 days of the suspected failure.
- The offer's discount tiers are `5%`, `10%`, and `15%` of the monthly payment depending on monthly availability.
- The offer says failures must be confirmed by CDNvideo measurement systems and excludes planned maintenance, force majeure, and customer-caused downtime.

No raw email body, credentials, tokens, or secret-bearing values are stored in this incident document.

## Monitoring Evidence

### Prometheus Blackbox HTTP Check

We have an internal Prometheus blackbox check for the public site.

Configuration:

- Prometheus datasource: `Prometheus`
- Job: `blackbox-http`
- Target: `https://svoefoto.ru`
- Blackbox exporter endpoint: local `127.0.0.1:9115`
- Module: `http_2xx`
- Valid final statuses: `200`, `301`, `302`
- Redirects: enabled
- Alert rule: `EndpointDown` when `probe_success == 0` for `2m`

Important caveat: this is not a third-party multi-region/global uptime check.
It is our own Prometheus blackbox probe from the production/monitoring host through the public hostname.
It is still useful because it records what an HTTP client received from `https://svoefoto.ru`, but it does not replace CDNvideo's own monitoring/RCA.

For `2026-05-19 09:00-12:00 MSK` (`06:00-09:00 UTC`), Prometheus recorded:

- `125 x 502`
- `1 x 504`
- `595 x 200`
- `126` failed probe samples (`probe_success == 0`)
- probe interval: approximately `15s`
- calculated unavailable time from failed probe samples: approximately `31m 30s`
- calculated availability in this 3-hour monitoring window: approximately `82.52%`
- calculated unavailability in this 3-hour monitoring window: approximately `17.48%`
- first `502` in this window: `2026-05-19 09:00:00 MSK`
- last `502` in this window: `2026-05-19 11:34:00 MSK`
- single `504`: `2026-05-19 11:18:15 MSK`

This was not one continuous `31m 30s` outage.
The public HTTP check was flapping: the degradation window lasted from approximately `09:00` to `11:34 MSK`, and the failed samples inside that window add up to about `31m 30s` of observed unavailability.

### SLA Availability Interpretation

The blackbox HTTP probe only checks `https://svoefoto.ru`.
It can undercount real customer impact because the site is an application, not a single static page: during the incident, CDNvideo also returned `502/504` for API endpoints, Angular chunks, `ngsw.json`, `manifest.webmanifest`, and Socket.IO polling requests.
A root-page `200` sample therefore does not necessarily mean the customer journey was healthy.

For May 2026, the month has `44,640` minutes.
A `99.9%` monthly SLA allows up to approximately `44m 38s` of monthly unavailability.

Availability interpretations from the current evidence:

- Conservative blackbox failed-sample total: `31m 30s` unavailable, approximately `99.9294%` monthly availability. This alone does not fall below `99.9%`.
- Customer-impact degradation window from first to last blackbox `502`: `09:00-11:34 MSK`, approximately `154m` degraded/unavailable, approximately `99.6550%` monthly availability.
- Broader business-impact window stated in the SLA/RCA request: `09:00-12:00 MSK`, approximately `180m` degraded/unavailable, approximately `99.5968%` monthly availability.

Recommended SLA argument: use `31m 30s` as the hard lower bound proven by our single public HTTP probe, and use `09:00-11:34 MSK` or `09:00-12:00 MSK` as the customer-impact window because multiple critical application resources failed through CDNvideo.

The same monitoring stack recorded `0` failed TLS-connect probe samples for `svoefoto.ru:443` during the same `09:00-12:00 MSK` window.
This points away from a simple TCP/TLS outage and toward HTTP-level failures on the CDN/origin-fetch path.

Alerting note: the `EndpointDown` alert reached `pending` states during the incident, but no `firing` state was found for `https://svoefoto.ru` in the checked window.
Reason: the alert requires `probe_success == 0` continuously for `2m`, while the observed failures were intermittent.

### Origin Metrics And Loki Logs

The same `09:00-12:00 MSK` window was checked against our origin-side metrics and logs:

- Prometheus app metric `http_requests_total` had no `status_code=5xx` series in the checked window.
- Statuses present in origin app metrics were `200`, `201`, `400`, `401`, `403`, and `404`.
- Loki `nginx` access logs had no matching `502`, `504`, or generic `5xx` access-log entries.
- Loki `nginx-error` logs had no matching `upstream`, `502`, `504`, `connect`, `timed out`, or `refused` entries.

This supports the earlier CDNvideo raw-log finding: users/checks saw `502/504`, while origin nginx and application metrics did not produce corresponding `5xx` responses.

## Open Follow-Ups

1. Await CDNvideo response to the SLA/RCA request.

- Account: `ropacemo51`
- Resource id: `xyt3ata9d4`
- CDN domain: `xyt3ata9d4.a.trbcdn.net`
- Public host: `svoefoto.ru`
- Origin: `84.38.189.58:443`
- Host/SNI: `svoefoto.ru`
- Cache disabled: `cache.disable=true`
- Raw logs show many `502/504`, all `MISS`
- Origin nginx has no corresponding `502/504`
- Captured request ids and edge ids are available in this document
- Ask CDNvideo to force-reapply/redeploy the resource configuration to all edge/origin-fetch clusters if they have not already done so.
- Confirm why multiple edges returned `MISS 502/504` without matching origin nginx requests.
- Confirm whether CDNvideo acknowledges the outage for SLA purposes.

2. If CDNvideo remains unstable and customer impact is high, consider one of:

- Keep only targeted hosts bypasses for operational PCs.
- Temporarily switch public DNS directly to `84.38.189.58`.
- Change CDNvideo origin/TLS settings only after confirming with support or after a controlled test.

## Next Mandatory Implementation

Implement multi-CDN failover for `svoefoto.ru`.

This is mandatory follow-up work from this incident. The current single-CDN setup creates a single external point of failure: when CDNvideo returns intermittent `502` while the origin is healthy, public users still fail unless DNS is changed manually or a local hosts bypass is used.

The target architecture is:

```text
svoefoto.ru
  -> DNS traffic manager with health checks
      -> primary: CDNvideo
      -> secondary: second CDN provider
      -> emergency fallback: direct origin 84.38.189.58
```

Do not implement this as multiple plain `A`, `ANAME`, or `ALIAS` records without health checks. Plain DNS round-robin can keep sending some users to a broken CDN. The traffic manager must remove unhealthy endpoints from DNS answers or route only to healthy pools.

### Traffic Manager Decision

The traffic manager should be DNS-layer failover with health checks.

Current DNS state:

- DNS zone: Selectel DNS
- Apex record: `ALIAS svoefoto.ru -> xyt3ata9d4.a.trbcdn.net.`
- `edge.svoefoto.ru`: `CNAME edge.svoefoto.ru -> xyt3ata9d4.a.trbcdn.net.`
- `ws.svoefoto.ru`: direct `A -> 84.38.189.58`

Selectel DNS is currently used as regular authoritative DNS. Based on the current available Selectel DNS API/tools, it should not be treated as the failover traffic manager unless Selectel confirms health-check based DNS failover for external CDN endpoints.

Cloudflare is not acceptable for this project. The failover layer must be implemented with a Russian or Russia-operable provider.

Recommended RF-first traffic manager: EdgeCenter DNS Failover, pending a short proof of concept for the final apex-domain record layout.

Why EdgeCenter is the first candidate:

- it is a DNS-layer failover product, not plain DNS round-robin;
- it performs availability checks and removes unhealthy targets from DNS answers;
- it supports DNS Failover on advanced DNS records, including `A`, `AAAA`, and `CNAME` records according to the provider documentation;
- it has paid check intervals down to 10 seconds;
- it can keep traffic management independent from CDNvideo.

The traffic manager must provide:

- health monitors from multiple regions;
- active/passive failover pools;
- support for apex/root domain routing;
- support for endpoint hostnames, not only fixed IPs;
- configurable Host header/SNI behavior for CDN endpoints;
- API support for setup and incident operations;
- event logs or notifications for endpoint health changes.

RF-compatible alternatives to evaluate if EdgeCenter cannot satisfy the apex/CNAME layout:

- NGENIX DNS/GSLB or managed CDN/DNS service, if they can provide health-check based routing between CDNvideo, a second CDN, and origin fallback;
- Qrator managed reverse proxy/load balancing, if DNS-layer failover is not enough or if they can provide a cleaner RF support contract;
- Yandex Cloud Application Load Balancer or Selectel load balancer only if the design changes from DNS failover to a fronting reverse-proxy/L7-balancer architecture. These are not the first choice for multi-CDN DNS failover because the public endpoint then becomes the load balancer itself rather than direct CDN endpoints.

Rejected for this project:

- Cloudflare Load Balancing;
- AWS Route 53;
- Google Cloud DNS;
- NS1, DNSMadeEasy, Constellix, and similar non-RF DNS traffic managers.

### RF Traffic Manager POC Checklist

Before migration, test EdgeCenter DNS Failover or the selected RF alternative with a non-production host:

```text
cdnfailover-test.svoefoto.ru
```

The POC must confirm:

- whether the service can fail over between CDN endpoint hostnames, not only static IP addresses;
- whether apex/root `svoefoto.ru` can be implemented cleanly, because normal DNS does not allow a plain `CNAME` at the zone apex;
- whether health checks can send the correct Host header and SNI for `svoefoto.ru`;
- whether health checks can distinguish CDNvideo `502` from origin health;
- whether API/automation exists for emergency override and rollback;
- expected failover time with TTL and check interval values.

If EdgeCenter cannot health-check/failover CDN CNAME targets at the apex, use one of these fallback designs:

1. Ask the selected CDN providers for dedicated anycast IPs and use health-checked `A` records.
2. Move the public canonical host to `www.svoefoto.ru` with CNAME-based failover and keep `svoefoto.ru` as a redirect endpoint.
3. Use an RF managed reverse proxy/GSLB provider such as Qrator or NGENIX instead of pure DNS failover.

### Required Second CDN Readiness

Before changing public DNS, configure and test a second CDN resource:

- public host: `svoefoto.ru`;
- test host: `edge2.svoefoto.ru` or another temporary validation hostname;
- origin: `84.38.189.58:443`;
- origin Host/SNI: `svoefoto.ru`;
- SSL certificate valid for `svoefoto.ru`;
- `/api/*` behavior either bypasses cache or uses safe no-store rules;
- Socket.IO polling path works;
- Angular chunks, `ngsw.json`, `manifest.webmanifest`, and root HTML load correctly;
- health endpoint for traffic manager: prefer `/health` or a dedicated lightweight edge/origin check.

### Yandex Cloud CDN POC Plan

A dedicated execution plan was added:

```text
docs/superpowers/plans/2026-05-19-yandex-cdn-websocket-poc.md
```

The goal is to create a Yandex Cloud CDN POC without switching production DNS:

- create `ycdn-test.svoefoto.ru` as a temporary HTTP/API CDN validation host;
- create `ws-ycdn-test.svoefoto.ru` as a temporary WebSocket validation host;
- point both to the existing origin `84.38.189.58:443` with origin Host header `svoefoto.ru`;
- keep cache disabled for the first POC pass, especially for `/`, `/api/*`, `/socket.io/*`, `/ngsw.json`, and `manifest.webmanifest`;
- ask Yandex Cloud support to enable WebSocket support for the CDN resource;
- test desktop HTTP/API behavior, WebSocket upgrade, and mobile reachability during RF internet restrictions;
- if mobile and WebSocket checks pass, use Yandex Cloud CDN as the second CDN endpoint and prioritize routing `ws.svoefoto.ru` through it.

This POC must not change the current production records for `svoefoto.ru`, `www.svoefoto.ru`, `edge.svoefoto.ru`, or `ws.svoefoto.ru` until the test result is recorded.

### Yandex Cloud CDN POC Result

Recorded at `2026-05-19 21:40 MSK`.

Created Yandex Cloud test resource without switching production DNS:

- Cloud: `cloud-magnusfoto` (`b1gi3ld7ie87asf7808t`)
- Folder: `default` (`b1gttu8ne7l6jcpgn6cs`)
- CDN resource: `bc8r2qbnzmax3e7d6g4v`
- Test host: `ycdn-test.svoefoto.ru`
- WebSocket test host: `ws-ycdn-test.svoefoto.ru`
- Provider CNAME: `a0a8d49e117aa37e.topology.gslb.yccdn.ru`
- Certificate Manager certificate: `fpq1tq4occsujioi8li5`, status `ISSUED` / CDN SSL status `READY`
- Origin: `84.38.189.58`, origin protocol `HTTPS`, origin Host header `svoefoto.ru`

DNS records added in Selectel for the POC only:

- `_acme-challenge.ycdn-test.svoefoto.ru CNAME fpq1tq4occsujioi8li5.cm.yandexcloud.net.`
- `_acme-challenge.ws-ycdn-test.svoefoto.ru CNAME fpq1tq4occsujioi8li5.cm.yandexcloud.net.`
- `ycdn-test.svoefoto.ru CNAME a0a8d49e117aa37e.topology.gslb.yccdn.ru.`
- `ws-ycdn-test.svoefoto.ru CNAME a0a8d49e117aa37e.topology.gslb.yccdn.ru.`

Production records were not changed:

- `svoefoto.ru ALIAS xyt3ata9d4.a.trbcdn.net.`
- `edge.svoefoto.ru CNAME xyt3ata9d4.a.trbcdn.net.`
- `ws.svoefoto.ru A 84.38.189.58`

Desktop/server-side validation after Yandex edge propagation:

- `https://ycdn-test.svoefoto.ru/` reached Yandex CDN and returned `200 OK` from updated edge nodes.
- `https://ycdn-test.svoefoto.ru/manifest.webmanifest` returned `200 OK` via Yandex CDN with `Cache-Status: MISS`.
- `https://ycdn-test.svoefoto.ru/api/booking/studios` returned `200 OK` via Yandex CDN with `Cache-Status: MISS`.
- During propagation, some Yandex edge IPs still returned `404` and the default `*.yccdn.cloud.yandex.net` certificate; this stabilized gradually. Yandex documentation says CDN setting changes may take up to 15 minutes to apply across CDN servers.

Yandex Cloud CDN API limitations observed:

- Creating the CDN resource with WebSocket enabled failed with `webscokets option is not allowed during creation`.
- Updating allowed methods to include `POST` failed with `method POST management is unavailable for resource`.
- Yandex documentation confirms that WebSocket support and POST customer requests require contacting Yandex Cloud support with the use case.

WebSocket validation:

- `ws-ycdn-test.svoefoto.ru` reaches the CDN/origin path, but WebSocket upgrade is not enabled for the CDN resource yet.
- Manual curl WebSocket handshake returned `400 Bad Request`; this is not production-ready for Socket.IO/WebSocket traffic until Yandex support enables WebSocket support.

Mobile RF restriction validation:

- User tested `https://ycdn-test.svoefoto.ru/` and `http://ycdn-test.svoefoto.ru/` from restricted mobile internet.
- Result: failed with `ERR_TIMED_OUT`.
- The failure is not DNS-level: the hostname resolves and desktop access reaches Yandex CDN. The symptom points to routing/IP/allowlist filtering for the shared Yandex CDN address pool used by this resource.

Decision:

- Do not use the current shared-IP Yandex Cloud CDN resource as the RF mobile reachability fallback.
- Keep the resource only as a technical CDN POC unless pricing and support response justify continuing.
- Next meaningful Yandex test is dedicated CDN IP addressing or another Yandex endpoint with a dedicated reserved IP, because Yandex documentation states shared service IPs are not suitable evidence for Минцифры whitelisting and recommends reserved `/32` IPs for whitelist applications.
- WebSocket and POST support must be requested from Yandex support before this CDN can be considered for production API/chat traffic.

### CDNvideo Route And Orchestration Snapshot

Recorded at `2026-05-19 21:46-21:48 MSK`.

Purpose: understand the CDNvideo data-plane/orchestration path for `xyt3ata9d4.a.trbcdn.net`, not the origin application path.

DNS state observed:

- `svoefoto.ru` resolved through the Selectel `ALIAS` to CDNvideo.
- `edge.svoefoto.ru` resolved as `CNAME edge.svoefoto.ru -> xyt3ata9d4.a.trbcdn.net.`
- `xyt3ata9d4.a.trbcdn.net` returned different IPs depending on resolver and timing.
- Authoritative CDNvideo zone servers for `trbcdn.net` included `ns006.cdnvideo.ru`, `ns007.cdnvideo.ru`, `ns008.cdnvideo.ru`, `ns009.cdnvideo.ru`, and `ns060.cdnvideo.ru`.
- `trbcdn.net` SOA was `ns006.cdnvideo.ru`.

Sample DNS answers collected from local/system and public resolvers:

```text
151.236.81.32
151.236.72.248
151.236.89.224
151.236.121.248
151.236.122.216
91.240.169.224
78.159.249.192
```

ASN/prefix mapping:

| IP | Prefix | ASN / holder | Geo hint | CDN edge id |
| --- | --- | --- | --- | --- |
| `151.236.81.32` | `151.236.81.0/24` | `AS57363 CDNvideo LLC` | Saint Petersburg, RU | `2009` |
| `91.240.169.224` | `91.240.169.0/24` | `AS57363 CDNvideo LLC` | Moscow, RU | `2004` |
| `151.236.72.248` | `151.236.72.0/24` | `AS57363 CDNvideo LLC` | Moscow, RU | `2016` |
| `151.236.89.224` | `151.236.89.0/24` | `AS57363 CDNvideo LLC` | Moscow, RU | `2005` |
| `151.236.121.248` | `151.236.121.0/24` | `AS204720 CDNetworks GLOBAL CLOUD NETWORK LLC` | Moscow, RU | `2007` |
| `78.159.249.192` | `78.159.249.0/24` | `AS57363 CDNvideo LLC` | Moscow, RU | `2022` |
| `151.236.122.216` | `151.236.122.0/23` | `AS57363 CDNvideo LLC` | Moscow, RU | `2018` |

HTTP header checks against these IPs, with Host/SNI forced to `svoefoto.ru`, returned `200` at the time of this snapshot and exposed different `x-cdn-edge-id` values.
All checked responses had `x-cdn-edge-cache: MISS`.

Representative route hints from `tracepath`:

- `151.236.81.32`: route passed through `spb.cdnvideo.ru`, then reached the edge.
- `151.236.121.248`: route passed through `msk-ix.cdnvideo.ru`, then reached the edge. This IP belongs to `AS204720 CDNetworks GLOBAL CLOUD NETWORK LLC`, not `AS57363 CDNvideo LLC`.
- `78.159.249.192`: route passed through `msk-ix.inetcom.ru`, then reached the edge.

Interpretation:

- CDNvideo is not serving this resource from one fixed IP. The same CDN CNAME is mapped by CDNvideo DNS/GSLB to multiple edge IPs and edge ids.
- The observed set includes both CDNvideo-owned ASN space and at least one CDNetworks ASN prefix. This suggests CDNvideo may use partner/global-cloud-network infrastructure for part of the edge/orchestration path.
- This snapshot does not prove which other customers share the same CDN edge IPs. Public DNS/BGP can show shared CDN infrastructure and ASN ownership, but tenant co-location requires passive DNS, CDN provider data, or internet-wide TLS/HTTP scans and still may be incomplete because CDN edges are Host/SNI-routed.

Follow-up if we need to answer "who else sits with them":

- collect passive DNS for the observed edge IPs from SecurityTrails/Censys/Shodan or an equivalent source;
- scan default TLS certificates and HTTP default vhosts for the IPs, understanding that SNI-based CDN tenants will not appear without hostname input;
- ask CDNvideo directly whether resource `xyt3ata9d4` is served only from CDNvideo-owned nodes or also through CDNetworks/partner nodes;
- ask CDNvideo whether affected edge ids `2004`, `2005`, `2007`, `2009`, `2016`, `2018`, `2022`, `2024`, and `2026` share a common shield/origin-fetch layer.

### Restricted Mobile Internet Checks

Recorded from manual user testing on restricted RF mobile internet on `2026-05-19` evening.

Failed:

- `https://ycdn-test.svoefoto.ru/`: `ERR_TIMED_OUT`
- `http://ycdn-test.svoefoto.ru/`: `ERR_TIMED_OUT`

Opened successfully:

- Timeweb public site, exact hostname not recorded in chat
- Timeweb CDN POC technical domain `uqsumlvrb7.cdn.twcstorage.ru`
- `mws.ru`
- `stormwall.pro`
- `platform.sbertech.ru`

Interpretation:

- The Yandex Cloud CDN shared-IP test host is reachable from desktop/server, but not from the restricted mobile path. This points to network/IP/allowlist filtering rather than broken DNS or broken origin.
- The Timeweb CDN technical domain opening from the restricted mobile path is the strongest POC result so far. It tests the exact reachability scenario we need, not just provider marketing.
- The successful checks suggest the next provider shortlist should prioritize RF-facing anti-DDoS/CDN/edge providers that are actually reachable from the restricted mobile network, not just providers that have a CDN product.
- Practical next candidates to evaluate first: Timeweb, MWS, StormWall, and SberTech/related edge offerings.

### Timeweb CDN POC Result

Recorded at `2026-05-19 22:25 MSK`.

User created a Timeweb CDN resource from the panel:

- Resource name: `Ambitious Finch`
- Source: `svoefoto.ru`
- Technical CDN domain: `uqsumlvrb7.cdn.twcstorage.ru`
- Panel state: settings are still applying
- Production DNS was not switched

Manual restricted mobile internet test:

- `uqsumlvrb7.cdn.twcstorage.ru` opens from the restricted mobile network.
- This differs from the Yandex Cloud CDN POC, where `ycdn-test.svoefoto.ru` timed out from the same restricted mobile path while desktop/server checks worked.

Operational conclusion:

- Timeweb CDN should become the next active CDN POC candidate.
- Before production use, validate HTTPS with a custom hostname, origin Host/SNI behavior, `/api/*`, `manifest.webmanifest`, Angular chunks, service worker files, and Socket.IO/WebSocket behavior.
- Cache policy should be conservative at first: do not cache `/`, `/api/*`, `/socket.io/*`, `ngsw.json`, `manifest.webmanifest`, or other dynamic app shell/service-worker control files.
- If API access is granted, use a short-lived restricted Timeweb token limited to CDN, DNS/domain, and SSL operations if the panel supports scoped permissions.

### Timeweb CDN API Configuration

Recorded at `2026-05-19 22:45 MSK`.

API and documentation notes:

- Public Timeweb API docs are available at `https://timeweb.cloud/api-docs`, but the downloaded OpenAPI bundle did not expose CDN resource endpoints.
- The Timeweb Cloud panel uses authenticated CDN endpoints under `https://api.timeweb.cloud/api/v1/cdn/http-resources`.
- Resource `5408` is the existing POC resource for `svoefoto.ru`; no new paid CDN resource was created.
- Timeweb CDN documentation says the technical domain is created automatically, cannot be removed, and HTTPS works on it by default.
- The same documentation says custom CDN delivery domains are subdomains only, with CNAME to the technical CDN domain. This is a blocker for using the apex `svoefoto.ru` directly unless Timeweb support confirms an exception or a different production hostname plan is accepted.

Configuration applied through API:

- CDN resource: `5408`
- API resource status after changes: `processing`; the technical domain was already serving requests during this state.
- CDN technical domain: `uqsumlvrb7.cdn.twcstorage.ru`
- Origin: `svoefoto.ru:443` with HTTPS enabled
- CDN cache: disabled
- Browser cache override: disabled
- Query-arg cache rule: disabled
- Always-online stale cache: disabled
- Gzip: enabled
- HTTP/3: left disabled for the first stability check
- `robots.txt`: deny indexing on the technical CDN domain
- Full cache purge requested after changing the cache policy; API returned HTTP `204`

Server-side validation from this host:

- `https://uqsumlvrb7.cdn.twcstorage.ru/` returned `200 OK`.
- `https://uqsumlvrb7.cdn.twcstorage.ru/manifest.webmanifest` returned `200 OK`.
- `https://uqsumlvrb7.cdn.twcstorage.ru/api/booking/studios` returned `200 OK`.
- `https://uqsumlvrb7.cdn.twcstorage.ru/socket.io/?EIO=4&transport=polling` returned `200 OK`.

WebSocket validation:

- Direct origin check against `84.38.189.58` with Host/SNI `svoefoto.ru` returned `101 Switching Protocols` for `/socket.io/?EIO=4&transport=websocket`.
- The same manual WebSocket Upgrade through Timeweb CDN returned `400 Bad Request` with Engine.IO body `{"code":3,"message":"Bad request"}`.
- A direct origin request without Upgrade headers returns the same Engine.IO `400`, so the current evidence points to Timeweb CDN not forwarding or not supporting the WebSocket Upgrade path in this configuration.

Additional validation at `2026-05-19 22:50-22:54 MSK`:

- DNS for `uqsumlvrb7.cdn.twcstorage.ru` resolves as `CNAME uqsumlvrb7.a.trbcdn.net.`
- `uqsumlvrb7.a.trbcdn.net` resolved to CDNvideo/TRB edge IPs during the test, including `151.236.81.32` and `91.240.169.232`.
- Responses from the Timeweb technical CDN domain included `X-CDN-Edge-Id: 2009` and `X-CDN-Edge-Id: 2019`, matching the TRB/CDNvideo-style edge path.
- Forced WebSocket Upgrade through the Timeweb technical domain to both sampled edge IPs returned `400 Bad Request`.
- Forced Socket.IO polling through the same Timeweb technical domain and edge IPs returned `200 OK` and Engine.IO open packets.
- Direct origin polling returned `200 OK`.
- Direct origin WebSocket Upgrade returned `101 Switching Protocols`.
- The active nginx `location /socket.io/` has no `allow` or `deny` directives, no `limit_req`, and no `limit_conn`; it forwards `Upgrade` and `Connection` headers to `127.0.0.1:3001`.
- No nftables rule matching this test was found that would block `80` or `443`.

Conclusion: this is not explained by our origin permissions or nginx protection rules. The Timeweb CDN POC appears to ride on TRB/CDNvideo infrastructure for this technical domain, and true WebSocket Upgrade is not working through that CDN path in the current configuration.

Operational conclusion:

- Timeweb CDN is a strong RF restricted-mobile reachability candidate for HTTP app/API traffic.
- Timeweb CDN is not yet validated for WebSocket chat traffic. Treat Socket.IO polling through Timeweb as available, but do not claim true WebSocket support until Timeweb support confirms and enables Upgrade forwarding or another configuration is proven.
- Do not switch production DNS to Timeweb CDN until a custom hostname, SSL, mobile check, API check, service worker behavior, and chat transport behavior are validated together.

### MWS / MTS CDN Candidate Precheck

Recorded at `2026-05-19 23:01 MSK`.

Reason for checking:

- Timeweb CDN was reachable from restricted mobile internet, but DNS showed the technical domain is backed by TRB/CDNvideo infrastructure.
- MWS was opened as the next RF CDN candidate because it is tied to the MTS ecosystem and may provide a separate delivery path.

Public documentation findings:

- MWS Cloud Platform CDN creates technical domains in the form `top<ID>.mwscdn.ru`.
- A CDN resource supports DNS names, caching, security settings, optimization settings, HTTP headers, and locations.
- The resource creation flow allows setting source URLs, enabling/disabling caching, and overriding the origin `Host` header.
- MWS CDN supports primary and backup origins. A backup origin is activated automatically if all primary origins return `5xx` or do not respond before timeout.
- Published SLA for MWS Cloud Platform CDN is `99.95%`.
- Published PAYG price in the public docs is `0.732 RUB/GB` of outgoing CDN traffic including VAT 22%.

Infrastructure evidence from DNS/ASN checks:

- `mwscdn.ru` authoritative nameservers are `ns1.mwscdn.ru` and `ns2.mwscdn.ru`.
- `mwscdn.ru` SOA points to `mwsdns.mts.ru`.
- `ns1.mwscdn.ru` resolves to `185.242.16.1`; Team Cymru maps it to `AS8359 MTS, RU`.
- `ns2.mwscdn.ru` resolves to `185.242.17.1`; Team Cymru maps it to `AS8359 MTS, RU`.
- `mws.ru` resolved during the check to `178.248.237.192`, mapped to `AS51115 HLL-AS, RU`.
- `console.mws.ru` and `api.mwsapis.ru` resolved during the check to `188.93.55.129/188.93.55.134`, mapped to `AS44677 MTS-NGCLOUD-AS, RU`.
- `docs.cloud.mts.ru` resolved during the check to `89.22.170.175`, mapped to `AS209024 MTS-CLOUD-A, RU`.

WebSocket status:

- Public MWS CDN docs checked during this pass did not contain explicit `WebSocket`, `Upgrade`, `Connection: Upgrade`, `Socket.IO`, or `ws://` support statements.
- The MWS CDN OpenAPI schema exposes an `options.websockets` boolean on CDN resources, so WebSocket support appears to be an API-level option.
- WebSocket support still must be treated as unproven until a created `top<ID>.mwscdn.ru` resource is tested with a real Upgrade request.

Initial POC configuration recommendation:

- Create only a temporary MWS CDN resource first; do not switch production DNS.
- Use origin `https://svoefoto.ru:443`.
- Override origin `Host` to `svoefoto.ru`.
- Keep cache conservative for the first pass: do not cache `/`, `/api/*`, `/socket.io/*`, `index.html`, `ngsw.json`, `manifest.webmanifest`, or service-worker control files.
- If the panel exposes an explicit WebSocket/Upgrade option, enable it.
- After creation, validate the generated `top<ID>.mwscdn.ru` technical domain before adding any production CNAME/ANAME.

POC acceptance checks:

- DNS for the technical domain must not CNAME into `trbcdn.net`.
- Root page, app chunks, `manifest.webmanifest`, `/api/booking/studios`, and Socket.IO polling must return healthy responses.
- Direct WebSocket Upgrade through the CDN must return `101 Switching Protocols`.
- Restricted mobile internet must open the technical CDN domain or the temporary custom hostname.
- CDN response headers and resolved IPs/ASNs must be recorded before making any production routing decision.

### MWS / MTS CDN API Access Status

Recorded at `2026-05-19 23:31 MSK`.

Local API setup:

- Service account authorized-key authentication works with the downloaded MWS key file stored locally with `0600` permissions.
- No private key, JWT, IAM token, or API token values are recorded in this document.
- Correct IAM token flow for this key:
  - create an ES256 JWS with `kid` equal to the short authorized-key name, not the full key resource path;
  - use the full service account resource path as `sub`;
  - send that JWS directly in the IAM `Authorization` header, without `Bearer`;
  - use the returned IAM token as `Authorization: Bearer <token>` for CDN API calls.

Read-only CDN API result:

- `GET https://cdn.mwsapis.ru/cdn/v1/projects/project-f-lavrinov1/cdnResources` reached the MWS CDN API.
- The request was rejected with `403 PERMISSION_DENIED`.
- Missing permission reported by MWS: `cdn.cdnResource.list`.

Required MWS access change:

- Grant service account `sa-hiqnar` role `cdn.editor` on project `project-f-lavrinov1` to let Codex create and configure the temporary CDN resource.
- `cdn.viewer` is enough only for listing and inspecting resources.
- MWS public docs state CDN resource creation and management require at least `cdn.editor`; cache management requires `cdn.cacheTask.editor`.
- After the role is granted, repeat the read-only list call before creating anything.

Follow-up check after the user reported adding roles:

- Rechecked at `2026-05-19 23:35 MSK` with a freshly issued IAM token.
- CDN list still returned `403 PERMISSION_DENIED` for `cdn.cdnResource.list`.
- IAM read of `projects/project-f-lavrinov1/serviceAccounts/sa-hiqnar` with the same token also returned `403 Access denied`.
- Conclusion: authentication is valid, but the MWS role is still not effective for the service account as a project-level subject. Most likely the role was assigned to the user account, to the service account resource itself, or to another scope instead of assigning a project role to service account `sa-hiqnar`.

Final access check after project-level role assignment:

- Rechecked at `2026-05-19 23:45 MSK`.
- `GET https://cdn.mwsapis.ru/cdn/v1/projects/project-f-lavrinov1/cdnResources` returned `200`.
- The service account can now list CDN resources and create the temporary CDN POC resource.

### MWS / MTS CDN POC Resource

Recorded at `2026-05-19 23:58 MSK`; refreshed at `2026-05-20 00:25 MSK`.

Created temporary CDN resource:

- MWS project: `project-f-lavrinov1`
- Resource ID: `cdn-svoefoto-poc`
- Technical domain: `top350302556.mwscdn.ru`
- Resolved A records during the check:
  - `185.242.19.249`
  - `185.242.19.250`
- Original POC origin: `https://svoefoto.ru:443`
- Corrected POC origin: `https://84.38.189.58:443`
- Origin `Host` override: `svoefoto.ru`
- Origin SNI override: `svoefoto.ru`
- CDN resource active: `true`
- CDN readiness after rollout: `OK`
- CDN cache option for the POC: disabled
- CDN WebSocket option in MWS API: `websockets: true`

Why the POC origin was corrected:

- Public `svoefoto.ru` currently resolves to `151.236.81.32`, which is the CDNvideo edge path for `xyt3ata9d4.a.trbcdn.net`.
- `edge.svoefoto.ru` is also a CNAME to `xyt3ata9d4.a.trbcdn.net`.
- Keeping `https://svoefoto.ru:443` as the MWS origin could create this chain: user -> MWS CDN -> CDNvideo -> origin.
- The corrected origin uses the direct origin IP `84.38.189.58` while preserving `Host: svoefoto.ru` and SNI `svoefoto.ru`.
- MWS API recheck after the correction returned readiness `OK`, the direct origin IP was present in the resource config, and the CDNvideo marker `xyt3ata9d4` was absent from the resource config.

Route and ownership checks:

- `top350302556.mwscdn.ru` has no CNAME into `trbcdn.net`; it resolves directly to `185.242.19.249` and `185.242.19.250`.
- Team Cymru ASN lookup maps both MWS edge IPs to `AS8359 MTS, RU`.
- The current CDNvideo comparison IP `151.236.81.32` maps to `AS57363 CDNVIDEO-AS, RU`.
- Team Cymru was used only as a public whois/ASN lookup source; it is not part of the request path and does not mean traffic is routed through `cymru.com`.
- MWS edge responses include `server: Angie`, `x-edge-host: spb-fed-edge02`, `x-edge-cache-status`, and `x-mwscdn-trace-id`.
- Header names like `x-cdn-*` alone are not proof of CDNvideo. DNS, ASN, and the MWS-specific headers show this POC is not riding on the CDNvideo/TRB edge path.

HTTP checks from the server:

- `https://top350302556.mwscdn.ru/` returned `200`, `content-type: text/html`, `content-length: 264563`.
- `http://top350302556.mwscdn.ru/` redirected to HTTPS with `301`.
- `https://top350302556.mwscdn.ru/api/booking/studios` returned `200` and a valid booking studios JSON payload.
- Response headers show MWS CDN edge processing, including `server: Angie`, `x-cdn-request-id`, `x-cdn-edge-id`, and `x-mwscdn-trace-id`.
- Direct origin bypass with `--resolve svoefoto.ru:443:84.38.189.58` returned `200` for `/api/booking/studios`, confirming the origin itself is healthy.

WebSocket checks:

- Direct origin bypass test with `--resolve svoefoto.ru:443:84.38.189.58` returned `101 Switching Protocols` for `/socket.io/?EIO=4&transport=websocket`.
- After the POC origin was corrected to `https://84.38.189.58:443`, MWS CDN test for `https://top350302556.mwscdn.ru/socket.io/?EIO=4&transport=websocket` returned `101 Switching Protocols`.
- Socket.IO polling through MWS returned `200`, so the `/socket.io/` path reaches the origin for non-Upgrade traffic.
- User-side restricted mobile internet test reported that the MWS technical domain opens from mobile restrictions, unlike the Yandex CDN POC.

Current POC conclusion:

- MWS CDN is usable for page/API HTTP delivery in this POC.
- MWS CDN is now proven to pass a true WebSocket Upgrade in this POC.
- This MWS route is not CDNvideo based on DNS, ASN, API config, and response-header evidence.
- Do not switch the main `svoefoto.ru` production HTTP route to MWS until mobile retest on the custom hostname, `/api/*`, Angular chunks, service worker files, and production chat behavior are validated together.

### MWS / MTS CDN Custom WebSocket Host Activation

Recorded at `2026-05-20 01:28 MSK`.

MWS CDN resource state:

- MWS project: `project-f-lavrinov1`
- CDN resource: `cdn-svoefoto-poc`
- Technical domain: `top350302556.mwscdn.ru`
- Custom hostname: `ws.svoefoto.ru`
- Managed certificate: `certmanager/projects/project-f-lavrinov1/certificates/ws-svoefoto-ru`
- Certificate state before DNS switch: `ready: OK`, `valid: true`
- CDN resource state after adding the custom hostname and certificate: `ready: OK`
- CDN WebSocket option: `websockets: true`
- CDN cache option for this route: disabled

DNS changes:

- Removed `A ws.svoefoto.ru -> 84.38.189.58` from Selectel DNS.
- Added `CNAME ws.svoefoto.ru -> top350302556.mwscdn.ru.` with TTL `300`.
- Authoritative Selectel DNS check returned `top350302556.mwscdn.ru.` for `ws.svoefoto.ru`.
- Public resolver check returned `top350302556.mwscdn.ru.`, then `185.242.19.250` and `185.242.19.249`.

Verification from the server:

- `https://top350302556.mwscdn.ru/socket.io/?EIO=4&transport=websocket` returned `101 Switching Protocols`.
- `https://ws.svoefoto.ru/socket.io/?EIO=4&transport=websocket` with `--resolve` to both MWS IPs returned `101 Switching Protocols`.
- `https://ws.svoefoto.ru/socket.io/?EIO=4&transport=websocket` after the DNS switch returned `101 Switching Protocols` without `--resolve`.
- The successful responses included `server: Angie`, `x-edge-host: spb-fed-edge02`, and `x-mwscdn-trace-id`, confirming the request path is the MWS CDN edge.
- A regular HTTPS check for `https://ws.svoefoto.ru/` returned `200` through MWS edge headers.

Operational note:

- Production Angular is configured to use `https://ws.svoefoto.ru` for Socket.IO with WebSocket-first transport and polling fallback.
- Browser Socket.IO WebSocket still uses the HTTP Upgrade flow and is confirmed by `101 Switching Protocols`; HTTP/2 support for ordinary page/API requests does not replace that browser WebSocket handshake.
- The next user-side validation is a restricted mobile internet check against `ws.svoefoto.ru`.

### Yandex Cloud POC Cleanup Status

User requested removing all Yandex Cloud POC resources that may incur cost.

Resources to remove on next continuation:

- Yandex Cloud CDN resource: `bc8r2qbnzmax3e7d6g4v`
- Yandex Cloud origin group created for this POC: `common-84-38-189-58` / `5550572976095530695`
- Yandex Certificate Manager certificate: `fpq1tq4occsujioi8li5`
- Selectel DNS POC records:
  - `_acme-challenge.ycdn-test.svoefoto.ru`
  - `_acme-challenge.ws-ycdn-test.svoefoto.ru`
  - `ycdn-test.svoefoto.ru`
  - `ws-ycdn-test.svoefoto.ru`

Cleanup was started but not completed in this session.
The local Yandex Cloud CLI could not get an IAM token and returned an authentication error requiring the Yandex End User License Agreement and Privacy Policy to be accepted.
The browser automation session was also redirected to a Yandex captcha page.

Do not assume these Yandex resources are deleted until a successful delete/list verification is recorded.
After cleanup, also remove local Yandex Cloud CLI tokens/profiles from this machine.

### Implementation Acceptance Criteria

- A health-checking DNS traffic manager is the authoritative path for `svoefoto.ru`.
- CDNvideo failure does not require manual DNS edits.
- A simulated CDNvideo failure routes new DNS resolutions to the second CDN or origin fallback.
- Origin health and CDN health are monitored separately, so a CDN-only failure is distinguishable from an origin failure.
- Rollback to direct origin or current CDNvideo-only DNS is documented.
- Operational PCs no longer need local hosts bypasses after the failover layer is live.

References:

- EdgeCenter DNS Failover overview: https://edgecenter.ru/knowledge-base/dns/what-is-a-dns-failover
- EdgeCenter DNS Failover setup: https://edgecenter.ru/knowledge-base/dns/set-up-and-use-dns-failover
- EdgeCenter DNS service and failover intervals: https://edgecenter.ru/dns

## Rollback for Soborny PC Hosts Bypass

To roll back the Soborny PC hosts change, restore the backup:

```powershell
Copy-Item -LiteralPath "C:\WINDOWS\System32\drivers\etc\hosts.codex-backup-20260519-094310" `
  -Destination "C:\WINDOWS\System32\drivers\etc\hosts" `
  -Force
ipconfig /flushdns
```

Then verify:

```powershell
[System.Net.Dns]::GetHostAddresses("svoefoto.ru")
```
