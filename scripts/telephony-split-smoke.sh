#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/telephony-split-smoke.sh [--deploy-api-only] [--skip-local]

Checks:
  - external GET  /api/auth/phone-check          -> 400
  - external GET  /api/auth/phone-check?phone=... -> 200 and data.available=true
  - external GET  /api/auth/providers            -> 200 and phoneAuth.available=true
  - external GET  /api/auth/phone-captcha/challenge -> 200 with Cache-Control:no-store or 503
  - external POST /api/auth/phone-code {}        -> 400/422, never 404
  - local GET     /api/health                    -> 200
  - local GET     /health                        -> 200
  - local GET     /api/auth/phone-check          -> 400
  - local GET     /api/auth/phone-check?phone=... -> 200 and data.available=true

Options:
  --deploy-api-only   run SPLIT_ENABLED=true ./deploy.sh backend api between baseline and post-reload checks
  --skip-local        skip localhost checks; useful off-host
  -h, --help          show this help

Environment:
  TELEPHONY_SMOKE_EXTERNAL_BASE         default: https://svoefoto.ru
  TELEPHONY_SMOKE_LOCAL_API_BASE        default: http://localhost:3001
  TELEPHONY_SMOKE_LOCAL_TELEPHONY_BASE  default: http://localhost:3009
  TELEPHONY_SMOKE_TEST_PHONE            default: 79001234567
  TELEPHONY_SMOKE_ARTIFACT_DIR          default: /tmp/telephony-split-smoke-<utc timestamp>
  TELEPHONY_SMOKE_PM2_LOG_LINES         default: 80

Artifacts:
  Per-request headers/body plus summary.tsv files are written under TELEPHONY_SMOKE_ARTIFACT_DIR.
  On unexpected failures the script also saves pm2 diagnostics there.
USAGE
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'missing required command: %s\n' "$1" >&2
    exit 127
  fi
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

compact_body() {
  tr '\r\n\t' '   ' < "$1" | sed 's/[[:space:]]\+/ /g' | cut -c1-240
}

json_phone_auth_available_true() {
  local body_file="$1"

  if has_cmd jq; then
    jq -e '.phoneAuth.available == true' "$body_file" >/dev/null 2>&1
    return
  fi

  tr -d '[:space:]' < "$body_file" | grep -F '"phoneAuth":{"available":true' >/dev/null 2>&1
}

json_phone_check_available_true() {
  local body_file="$1"

  if has_cmd jq; then
    jq -e '.success == true and .data.available == true and .data.provider == "voice_call"' "$body_file" >/dev/null 2>&1
    return
  fi

  local compact
  compact="$(tr -d '[:space:]' < "$body_file")"
  printf '%s' "$compact" | grep -F '"success":true' >/dev/null 2>&1 \
    && printf '%s' "$compact" | grep -F '"data":{"available":true,"provider":"voice_call"}' >/dev/null 2>&1
}

capture_failure_context() {
  local failure_dir="$ARTIFACT_DIR/failure"

  if [[ "$FAILURE_CONTEXT_CAPTURED" -eq 1 ]]; then
    return
  fi

  FAILURE_CONTEXT_CAPTURED=1
  mkdir -p "$failure_dir"

  if has_cmd pm2; then
    pm2 list > "$failure_dir/pm2-list.txt" 2>&1 || true
    pm2 logs magnus-photo-api --lines "$PM2_LOG_LINES" --nostream > "$failure_dir/magnus-photo-api.log" 2>&1 || true
    pm2 logs magnus-photo-telephony --lines "$PM2_LOG_LINES" --nostream > "$failure_dir/magnus-photo-telephony.log" 2>&1 || true
  fi
}

fail_check() {
  local message="$1"

  FAILURES=$((FAILURES + 1))
  printf 'FAIL: %s\n' "$message" >&2
  capture_failure_context
}

ensure_phase_summary() {
  local phase="$1"
  local summary_file="$ARTIFACT_DIR/$phase/summary.tsv"

  mkdir -p "$ARTIFACT_DIR/$phase"
  if [[ ! -f "$summary_file" ]]; then
    printf 'name\ttimestamp_utc\tstatus\ttime_total_s\tx_request_id\tcache_control\tbody\n' > "$summary_file"
  fi
}

run_request() {
  local phase="$1"
  local name="$2"
  local method="$3"
  local url="$4"
  local data="${5-}"
  local phase_dir headers_file body_file meta ts curl_exit

  phase_dir="$ARTIFACT_DIR/$phase"
  headers_file="$phase_dir/${name}.headers"
  body_file="$phase_dir/${name}.body"
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  ensure_phase_summary "$phase"

  set +e
  if [[ "$method" == "GET" ]]; then
    meta="$(curl -sS -D "$headers_file" -o "$body_file" -w 'HTTP_CODE=%{http_code}\nTIME_TOTAL=%{time_total}\n' "$url")"
    curl_exit=$?
  else
    meta="$(curl -sS -D "$headers_file" -o "$body_file" -w 'HTTP_CODE=%{http_code}\nTIME_TOTAL=%{time_total}\n' -X "$method" -H 'Content-Type: application/json' --data "$data" "$url")"
    curl_exit=$?
  fi
  set -e

  LAST_NAME="$name"
  LAST_PHASE="$phase"
  LAST_URL="$url"
  LAST_HEADERS_FILE="$headers_file"
  LAST_BODY_FILE="$body_file"
  LAST_STATUS="$(printf '%s\n' "$meta" | awk -F= '/^HTTP_CODE=/{print $2}')"
  LAST_TIME_TOTAL="$(printf '%s\n' "$meta" | awk -F= '/^TIME_TOTAL=/{print $2}')"
  LAST_REQUEST_ID="$(awk 'BEGIN{IGNORECASE=1} /^X-Request-Id:/ {sub(/\r$/, "", $2); print $2}' "$headers_file" | tail -n1)"
  LAST_CACHE_CONTROL="$(awk 'BEGIN{IGNORECASE=1} /^Cache-Control:/ {sub(/\r$/, ""); sub(/^Cache-Control: /, ""); print; exit}' "$headers_file")"
  LAST_BODY_SHORT="$(compact_body "$body_file")"

  if [[ "$curl_exit" -ne 0 ]]; then
    fail_check "$phase/$name curl failed for $url (exit $curl_exit)"
    return 1
  fi

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$name" \
    "$ts" \
    "${LAST_STATUS:--}" \
    "${LAST_TIME_TOTAL:--}" \
    "${LAST_REQUEST_ID:--}" \
    "${LAST_CACHE_CONTROL:--}" \
    "$LAST_BODY_SHORT" >> "$phase_dir/summary.tsv"

  printf '[%s] %-32s status=%s time=%ss request_id=%s\n' \
    "$phase" \
    "$name" \
    "${LAST_STATUS:--}" \
    "${LAST_TIME_TOTAL:--}" \
    "${LAST_REQUEST_ID:--}"
}

assert_request_id_present() {
  local label="$1"

  if [[ -z "${LAST_REQUEST_ID:-}" ]]; then
    fail_check "$label did not return X-Request-Id"
  fi
}

assert_status_eq() {
  local expected="$1"
  local label="$2"

  if [[ "${LAST_STATUS:-}" != "$expected" ]]; then
    fail_check "$label expected status $expected, got ${LAST_STATUS:-missing}"
  fi
}

assert_status_in() {
  local label="$1"
  shift
  local expected

  for expected in "$@"; do
    if [[ "${LAST_STATUS:-}" == "$expected" ]]; then
      return
    fi
  done

  fail_check "$label expected one of [$*], got ${LAST_STATUS:-missing}"
}

assert_providers_body() {
  local label="$1"

  if ! json_phone_auth_available_true "$LAST_BODY_FILE"; then
    fail_check "$label did not report phoneAuth.available=true"
  fi
}

assert_phone_check_body() {
  local label="$1"

  if ! json_phone_check_available_true "$LAST_BODY_FILE"; then
    fail_check "$label did not report data.available=true with voice_call provider"
  fi
}

assert_captcha_status() {
  local label="$1"

  case "${LAST_STATUS:-}" in
    200)
      if [[ "${LAST_CACHE_CONTROL:-}" != *no-store* ]]; then
        fail_check "$label returned 200 without Cache-Control containing no-store"
      fi
      ;;
    503)
      ;;
    *)
      fail_check "$label expected status 200 or 503, got ${LAST_STATUS:-missing}"
      ;;
  esac
}

run_external_checks() {
  local phase="$1"

  run_request "$phase" phone_check_no_phone GET "$EXTERNAL_BASE/api/auth/phone-check"
  assert_request_id_present "$phase/phone_check_no_phone"
  assert_status_eq 400 "$phase/phone_check_no_phone"

  run_request "$phase" phone_check_with_phone GET "$EXTERNAL_BASE/api/auth/phone-check?phone=$TEST_PHONE"
  assert_request_id_present "$phase/phone_check_with_phone"
  assert_status_eq 200 "$phase/phone_check_with_phone"
  assert_phone_check_body "$phase/phone_check_with_phone"

  run_request "$phase" providers GET "$EXTERNAL_BASE/api/auth/providers"
  assert_request_id_present "$phase/providers"
  assert_status_eq 200 "$phase/providers"
  assert_providers_body "$phase/providers"

  run_request "$phase" phone_captcha_challenge GET "$EXTERNAL_BASE/api/auth/phone-captcha/challenge"
  assert_request_id_present "$phase/phone_captcha_challenge"
  assert_captcha_status "$phase/phone_captcha_challenge"

  run_request "$phase" phone_code_incomplete POST "$EXTERNAL_BASE/api/auth/phone-code" '{}'
  assert_request_id_present "$phase/phone_code_incomplete"
  assert_status_in "$phase/phone_code_incomplete" 400 422
}

run_local_checks() {
  local phase="$1"

  run_request "$phase" api_health GET "$LOCAL_API_BASE/api/health"
  assert_request_id_present "$phase/api_health"
  assert_status_eq 200 "$phase/api_health"

  run_request "$phase" telephony_health GET "$LOCAL_TELEPHONY_BASE/health"
  assert_request_id_present "$phase/telephony_health"
  assert_status_eq 200 "$phase/telephony_health"

  run_request "$phase" telephony_phone_check_no_phone GET "$LOCAL_TELEPHONY_BASE/api/auth/phone-check"
  assert_request_id_present "$phase/telephony_phone_check_no_phone"
  assert_status_eq 400 "$phase/telephony_phone_check_no_phone"

  run_request "$phase" telephony_phone_check_with_phone GET "$LOCAL_TELEPHONY_BASE/api/auth/phone-check?phone=$TEST_PHONE"
  assert_request_id_present "$phase/telephony_phone_check_with_phone"
  assert_status_eq 200 "$phase/telephony_phone_check_with_phone"
  assert_phone_check_body "$phase/telephony_phone_check_with_phone"
}

run_deploy_api_only() {
  local deploy_log="$ARTIFACT_DIR/deploy-api-only.log"
  local deploy_exit

  printf 'Running api-only deploy: SPLIT_ENABLED=true ./deploy.sh backend api\n'

  set +e
  (
    cd "$REPO_ROOT"
    SPLIT_ENABLED=true ./deploy.sh backend api
  ) 2>&1 | tee "$deploy_log"
  deploy_exit=${PIPESTATUS[0]}
  set -e

  if [[ "$deploy_exit" -ne 0 ]]; then
    fail_check "api-only deploy failed with exit $deploy_exit"
    return 1
  fi
}

RUN_DEPLOY_API_ONLY=0
SKIP_LOCAL=0

while (($# > 0)); do
  case "$1" in
    --deploy-api-only)
      RUN_DEPLOY_API_ONLY=1
      shift
      ;;
    --skip-local)
      SKIP_LOCAL=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'unknown argument: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

require_cmd curl

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
EXTERNAL_BASE="${TELEPHONY_SMOKE_EXTERNAL_BASE:-https://svoefoto.ru}"
LOCAL_API_BASE="${TELEPHONY_SMOKE_LOCAL_API_BASE:-http://localhost:3001}"
LOCAL_TELEPHONY_BASE="${TELEPHONY_SMOKE_LOCAL_TELEPHONY_BASE:-http://localhost:3009}"
TEST_PHONE="${TELEPHONY_SMOKE_TEST_PHONE:-79001234567}"
ARTIFACT_DIR="${TELEPHONY_SMOKE_ARTIFACT_DIR:-/tmp/telephony-split-smoke-$(date -u +%Y%m%dT%H%M%SZ)}"
PM2_LOG_LINES="${TELEPHONY_SMOKE_PM2_LOG_LINES:-80}"

FAILURES=0
FAILURE_CONTEXT_CAPTURED=0
LAST_NAME=""
LAST_PHASE=""
LAST_URL=""
LAST_HEADERS_FILE=""
LAST_BODY_FILE=""
LAST_STATUS=""
LAST_TIME_TOTAL=""
LAST_REQUEST_ID=""
LAST_CACHE_CONTROL=""
LAST_BODY_SHORT=""

mkdir -p "$ARTIFACT_DIR"

printf 'Artifacts: %s\n' "$ARTIFACT_DIR"
printf 'External base: %s\n' "$EXTERNAL_BASE"
if [[ "$SKIP_LOCAL" -eq 0 ]]; then
  printf 'Local API base: %s\n' "$LOCAL_API_BASE"
  printf 'Local telephony base: %s\n' "$LOCAL_TELEPHONY_BASE"
fi

run_external_checks baseline-external

if [[ "$SKIP_LOCAL" -eq 0 ]]; then
  run_local_checks baseline-local
fi

if [[ "$RUN_DEPLOY_API_ONLY" -eq 1 ]]; then
  run_deploy_api_only
  run_external_checks postreload-external
  if [[ "$SKIP_LOCAL" -eq 0 ]]; then
    run_local_checks postreload-local
  fi
fi

if [[ "$FAILURES" -ne 0 ]]; then
  printf 'Smoke failed with %s issue(s). Artifacts: %s\n' "$FAILURES" "$ARTIFACT_DIR" >&2
  exit 1
fi

printf 'Smoke passed. Artifacts: %s\n' "$ARTIFACT_DIR"
