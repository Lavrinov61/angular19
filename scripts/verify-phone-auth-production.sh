#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

RUN_LIVE_SMOKE="${RUN_LIVE_SMOKE:-false}"
RUN_FULL_BACKEND_LINT="${RUN_FULL_BACKEND_LINT:-false}"

FRONTEND_SPECS=(
  "src/app/core/interceptors/telephony-api-routing.spec.ts"
  "src/app/core/interceptors/server-http.interceptor.spec.ts"
  "src/app/core/services/auth.service.spec.ts"
)

BACKEND_LINT_FILES=(
  "src/routes/phone-auth.routes.ts"
  "src/routes/auth.routes.test.ts"
  "src/telephony-app.ts"
  "src/telephony-app.test.ts"
  "src/services/phone-auth-captcha.service.ts"
  "src/services/voice-otp-dispatcher.service.ts"
  "src/services/telephony-split-readiness.service.ts"
  "src/services/code-delivery.service.ts"
  "src/routes/auth-route-policy.ts"
  "src/routes/auth-route-policy.test.ts"
)

BACKEND_TESTS=(
  "src/routes/auth.routes.test.ts"
  "src/telephony-app.test.ts"
  "src/routes/auth-route-policy.test.ts"
)

run_in() {
  local dir="$1"
  shift
  printf '\n=== (%s) %s ===\n' "$dir" "$*"
  (cd "$dir" && "$@")
}

printf 'Phone auth production verification gate\n'
printf 'Root: %s\n' "$ROOT_DIR"

run_in "$ROOT_DIR" npm run build:check
run_in "$ROOT_DIR" npm run lint
run_in "$ROOT_DIR" npx vitest run "${FRONTEND_SPECS[@]}"

run_in "$ROOT_DIR/backend" npx eslint "${BACKEND_LINT_FILES[@]}"
run_in "$ROOT_DIR/backend" npx vitest run "${BACKEND_TESTS[@]}"
run_in "$ROOT_DIR" npx tsc --noEmit -p backend/tsconfig.json

run_in "$ROOT_DIR" bash -n deploy.sh
run_in "$ROOT_DIR" bash -n scripts/telephony-split-smoke.sh
run_in "$ROOT_DIR" bash -n scripts/phone-auth-live-e2e.sh

if [[ -x "$ROOT_DIR/.codex/local-marketplaces/angular-dev-hookify/plugins/angular-dev-hookify/scripts/angular-dev-hookify.sh" ]]; then
  run_in "$ROOT_DIR" "$ROOT_DIR/.codex/local-marketplaces/angular-dev-hookify/plugins/angular-dev-hookify/scripts/angular-dev-hookify.sh" --changed
fi

if [[ "$RUN_FULL_BACKEND_LINT" == "true" ]]; then
  run_in "$ROOT_DIR/backend" npm run lint
else
  printf '\n=== Skipping full backend lint ===\n'
  printf 'Set RUN_FULL_BACKEND_LINT=true to run it; current repository-wide backend lint has known legacy debt.\n'
fi

if [[ "$RUN_LIVE_SMOKE" == "true" ]]; then
  run_in "$ROOT_DIR" scripts/telephony-split-smoke.sh
else
  printf '\n=== Skipping live smoke ===\n'
  printf 'Set RUN_LIVE_SMOKE=true to hit live/local phone-auth endpoints with scripts/telephony-split-smoke.sh.\n'
fi

printf '\nPhone auth production verification gate passed.\n'
