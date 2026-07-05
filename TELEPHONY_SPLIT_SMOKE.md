# Telephony Split Smoke

Use this helper on the production host after split telephony rollouts. It captures the same evidence requested in the rollout plan: UTC timestamps, status, response time, `X-Request-Id`, short body snippets, and failure diagnostics.

Safe smoke without deploy:

```bash
scripts/telephony-split-smoke.sh
```

Full API-only regression in split mode:

```bash
scripts/telephony-split-smoke.sh --deploy-api-only
```

Run from another host and skip localhost probes:

```bash
TELEPHONY_SMOKE_EXTERNAL_BASE='https://svoefoto.ru' \
scripts/telephony-split-smoke.sh --skip-local
```

Defaults:

- `TELEPHONY_SMOKE_EXTERNAL_BASE=https://svoefoto.ru`
- `TELEPHONY_SMOKE_LOCAL_API_BASE=http://localhost:3001`
- `TELEPHONY_SMOKE_LOCAL_TELEPHONY_BASE=http://localhost:3009`
- `TELEPHONY_SMOKE_ARTIFACT_DIR=/tmp/telephony-split-smoke-<utc timestamp>`

What the script asserts:

- `GET /api/auth/phone-check` without `phone` returns `400`.
- `GET /api/auth/providers` returns `200` and reports `phoneAuth.available=true`.
- `GET /api/auth/phone-captcha/challenge` returns either:
  - `200` with `Cache-Control` containing `no-store`, or
  - `503` when captcha is intentionally unavailable in production.
- `POST /api/auth/phone-code` with `{}` returns validation (`400` or `422`), not `404`.
- Local split checks:
  - `http://localhost:3001/api/health` -> `200`
  - `http://localhost:3009/health` -> `200`
  - `http://localhost:3009/api/auth/phone-check` without `phone` -> `400`

Artifacts are written into per-phase directories:

- `baseline-external/`
- `baseline-local/`
- `postreload-external/`
- `postreload-local/`

Each phase includes `summary.tsv` plus raw `*.headers` and `*.body` files per request.

On unexpected failures the script also saves:

- `failure/pm2-list.txt`
- `failure/magnus-photo-api.log`
- `failure/magnus-photo-telephony.log`

This is intentionally separate from `deploy.sh`: deploy keeps its narrow health gates, while this helper proves the external origin path and the business-critical `phone auth` regression condition around `API-only` reloads.
