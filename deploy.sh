#!/bin/bash
# Деплой на одном сервере (Selectel)
# Билд в dev-папке → rsync артефактов в prod-папку → npm ci → pm2 reload → health check
#
# Использование:
#   ./deploy.sh backend            # build backend + reload API only (default in split mode)
#   ./deploy.sh backend telephony  # build backend + reload telephony only
#   ./deploy.sh backend all        # build backend + reload all split backend processes
#   ./deploy.sh frontend           # build frontend + reload SSR only
#   ./deploy.sh all                # full backend split reload + frontend
#   ./deploy.sh all all            # full backend split reload + frontend

set -e

DEV_DIR="${DEV_DIR:-/var/www/apimain/angular-dev}"
PROD_DIR="${PROD_DIR:-/var/www/apimain/angular-app}"
DEPLOY_HEALTHY=true

read_backend_env_var() {
  local key="$1"
  local env_file value
  for env_file in "$DEV_DIR/backend/.env" "$PROD_DIR/backend/.env" "$PROD_DIR/.env"; do
    [ -f "$env_file" ] || continue
    value="$(awk -F= -v key="$key" '
      $0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
        value = substr($0, index($0, "=") + 1)
        sub(/^[[:space:]]+/, "", value)
        sub(/[[:space:]]+$/, "", value)
        gsub(/^["'\'']|["'\'']$/, "", value)
        print value
        exit
      }
    ' "$env_file")"
    if [ -n "$value" ]; then
      printf '%s\n' "$value"
      return 0
    fi
  done
  return 1
}

detect_pm2_split_mode() {
  local pid
  pid="$(pm2 pid magnus-photo-worker-outbound 2>/dev/null | tr -d '[:space:]' || true)"
  [ -n "$pid" ] && [ "$pid" != "0" ]
}

DEPLOY_LOG="/var/log/pm2-observe/deploy-events.log"
DEPLOY_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DEPLOY_HEAD="$(git -C "$DEV_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
DEPLOY_TARGET="${1:-all}"
if [ -n "${2:-}" ]; then
  BACKEND_SCOPE="$2"
elif [ -n "${DEPLOY_BACKEND_SCOPE:-}" ]; then
  BACKEND_SCOPE="$DEPLOY_BACKEND_SCOPE"
elif [ "$DEPLOY_TARGET" = "all" ]; then
  BACKEND_SCOPE="all"
else
  BACKEND_SCOPE="api"
fi
TELEPHONY_PORT_EFFECTIVE="${TELEPHONY_PORT:-3009}"
SPLIT_MODE="${SPLIT_ENABLED:-$(read_backend_env_var SPLIT_ENABLED || true)}"
if [ -z "$SPLIT_MODE" ]; then
  if detect_pm2_split_mode; then
    SPLIT_MODE="true"
  else
    SPLIT_MODE="false"
  fi
fi
SPLIT_MODE="${SPLIT_MODE:-false}"
export SPLIT_ENABLED="$SPLIT_MODE"

mkdir -p "$(dirname "$DEPLOY_LOG")" 2>/dev/null || true
echo "$DEPLOY_TS deploy.sh $DEPLOY_TARGET scope=$BACKEND_SCOPE HEAD=$DEPLOY_HEAD split=$SPLIT_MODE user=$USER" >> "$DEPLOY_LOG"

wait_healthy() {
  local url="$1" name="$2" max=10 delay=3
  echo "=== Waiting for $name ==="
  for i in $(seq 1 "$max"); do
    if curl -sf "$url" > /dev/null 2>&1; then
      echo "  $name: healthy (attempt $i)"
      return 0
    fi
    echo "  $name: not ready ($i/$max), retrying in ${delay}s..."
    sleep "$delay"
  done
  echo "!!! WARNING: $name failed health check after $max attempts !!!"
  return 1
}

wait_http_status() {
  local url="$1" name="$2" expected_status="$3" max=10 delay=2
  echo "=== Waiting for $name ($expected_status) ==="
  for i in $(seq 1 "$max"); do
    local status
    status="$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)"
    if [ "$status" = "$expected_status" ]; then
      echo "  $name: status $status (attempt $i)"
      return 0
    fi
    echo "  $name: status ${status:-000} ($i/$max), retrying in ${delay}s..."
    sleep "$delay"
  done
  echo "!!! WARNING: $name did not return $expected_status after $max attempts !!!"
  return 1
}

wait_http_body_contains() {
  local url="$1" name="$2" expected_fragment="$3" max=10 delay=2
  echo "=== Waiting for $name body fragment ==="
  for i in $(seq 1 "$max"); do
    local body
    body="$(curl -sf "$url" || true)"
    if printf '%s' "$body" | grep -F -q -- "$expected_fragment"; then
      echo "  $name: fragment matched (attempt $i)"
      return 0
    fi
    echo "  $name: fragment not matched ($i/$max), retrying in ${delay}s..."
    sleep "$delay"
  done
  echo "!!! WARNING: $name did not contain expected fragment after $max attempts !!!"
  return 1
}

run_sql_migration_file() {
  local migration_file="$1"
  local name="$2"

  if [ ! -f "$migration_file" ]; then
    echo "!!! Missing migration file: $migration_file !!!"
    exit 1
  fi

  if ! command -v psql >/dev/null 2>&1; then
    echo "!!! psql is required to apply $name before backend reload !!!"
    exit 1
  fi

  local database_url db_host db_port db_name db_user db_password db_ssl
  database_url="$(read_backend_env_var DATABASE_URL || true)"
  db_host="$(read_backend_env_var DB_HOST || true)"
  db_port="$(read_backend_env_var DB_PORT || true)"
  db_name="$(read_backend_env_var DB_NAME || true)"
  db_user="$(read_backend_env_var DB_USER || true)"
  db_password="$(read_backend_env_var DB_PASSWORD || true)"
  db_ssl="$(read_backend_env_var DB_SSL || true)"

  echo "=== Backend: applying migration $name ==="
  if [ -n "$database_url" ]; then
    psql "$database_url" -v ON_ERROR_STOP=1 -f "$migration_file"
    return 0
  fi

  if [ -z "$db_name" ] || [ -z "$db_user" ]; then
    echo "!!! DB_NAME and DB_USER are required to apply $name before backend reload !!!"
    exit 1
  fi

  if [ "$db_ssl" = "true" ]; then
    export PGSSLMODE="${PGSSLMODE:-require}"
  fi
  PGPASSWORD="$db_password" psql \
    -h "${db_host:-localhost}" \
    -p "${db_port:-6432}" \
    -U "$db_user" \
    -d "$db_name" \
    -v ON_ERROR_STOP=1 \
    -f "$migration_file"
}

apply_backend_migrations() {
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/135_subscription_payments_ledger.sql" \
    "subscription payments ledger"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260515_account_types_subscription_volume_discount.sql" \
    "account types subscription volume discount"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260515_zz_account_discount_activation_subscription.sql" \
    "account discount activation subscription"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260515_client_pin_auth.sql" \
    "client PIN auth"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260515_file_sleeve_min_check.sql" \
    "file sleeve price and minimum check"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260516_privacy_consents.sql" \
    "privacy consents"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260516_phone_otp_events.sql" \
    "phone OTP events"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260528_phone_otp_voximplant_webhook_event.sql" \
    "phone OTP Voximplant webhook events"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260529_call_logs_data_completeness.sql" \
    "call_logs data completeness + indexes"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260516_canon_c3226i_real_paper_sources.sql" \
    "Canon C3226i real paper sources"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260521_business_card_heavy6_presets.sql" \
    "Canon C3226i business card Heavy 6 presets"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260517_loyalty_monthly_cashback.sql" \
    "loyalty monthly cashback"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260517_print_package_usage_policy.sql" \
    "print package usage policy"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260517_chat_push_conversation_fk.sql" \
    "chat push conversation foreign key"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260521_pos_fiscal_settings.sql" \
    "POS ATOL27F fiscal print settings"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260521_pos_bank_settlement_transaction.sql" \
    "POS bank settlement transaction"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260526_pos_fiscal_correction_transaction.sql" \
    "POS fiscal correction transaction"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260625_pos_receipt_copy_print.sql" \
    "POS receipt copy print transaction"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260521_pos_receipt_payments_transfer.sql" \
    "POS receipt transfer payment type"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260621_pos_misc_cashier_items.sql" \
    "POS miscellaneous cashier items"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260604_ai_agent_request_trace.sql" \
    "AI agent request trace"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260604_ai_catalog_aliases.sql" \
    "AI catalog aliases"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260622_close_barrikadnaya_public_ai.sql" \
    "close Barrikadnaya public AI knowledge"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260621_document_crop_passport_800dpi.sql" \
    "document crop passport 800dpi preset"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260621_document_crop_extra_formats.sql" \
    "document crop Schengen and 3x4 presets"
  run_sql_migration_file \
    "$DEV_DIR/backend/database/migrations/zz_20260622_photo_workspace_ai_retouch.sql" \
    "photo workspace AI retouch"
}

print_backend_scope_warning() {
  local scope="$1"
  local changed_files
  changed_files="$(
    git -C "$DEV_DIR" show --pretty='' --name-only HEAD 2>/dev/null || true
  )"

  if [ -z "$changed_files" ]; then
    return 0
  fi

  if printf '%s\n' "$changed_files" | grep -E -q -- '^(backend/src/(telephony\.ts|telephony-app\.ts|routes/phone-auth\.routes\.ts|routes/telephony\.routes\.ts|services/phone-auth-captcha\.service\.ts|services/voice-otp-dispatcher\.service\.ts|services/voximplant.*)|deploy-configs/nginx/telephony-location\.conf|ecosystem\.config\.cjs)$'; then
    if [ "$scope" = "api" ]; then
      echo "!!! WARNING: latest commit touched telephony/phone-auth files; consider './deploy.sh backend all' or './deploy.sh backend telephony' !!!"
    fi
  fi
}

validate_backend_scope() {
  case "$1" in
    api|telephony|all)
      ;;
    *)
      echo "Usage error: backend scope must be one of: api, telephony, all"
      exit 2
      ;;
  esac
}

check_split_core_health() {
  set +e
  wait_healthy "http://localhost:3001/api/health" "API" || DEPLOY_HEALTHY=false
  wait_healthy "http://localhost:${TELEPHONY_PORT_EFFECTIVE}/health" "telephony" || DEPLOY_HEALTHY=false
  wait_http_status "http://localhost:${TELEPHONY_PORT_EFFECTIVE}/api/auth/phone-check" "telephony phone-auth route" "400" || DEPLOY_HEALTHY=false
  wait_http_body_contains "http://localhost:3001/api/auth/providers" "API auth providers phone auth availability" '"phoneAuth":{"available":true' || DEPLOY_HEALTHY=false
  set -e
}

check_split_full_health() {
  set +e
  wait_healthy "http://localhost:3001/api/health" "API" || DEPLOY_HEALTHY=false
  wait_healthy "http://localhost:3005/health" "worker-ai" || DEPLOY_HEALTHY=false
  wait_healthy "http://localhost:3006/health" "worker-outbound" || DEPLOY_HEALTHY=false
  wait_healthy "http://localhost:3007/health" "worker-bot" || DEPLOY_HEALTHY=false
  wait_healthy "http://localhost:3008/health" "scheduler" || DEPLOY_HEALTHY=false
  wait_healthy "http://localhost:${TELEPHONY_PORT_EFFECTIVE}/health" "telephony" || DEPLOY_HEALTHY=false
  wait_http_status "http://localhost:${TELEPHONY_PORT_EFFECTIVE}/api/auth/phone-check" "telephony phone-auth route" "400" || DEPLOY_HEALTHY=false
  wait_http_body_contains "http://localhost:3001/api/auth/providers" "API auth providers phone auth availability" '"phoneAuth":{"available":true' || DEPLOY_HEALTHY=false
  set -e
}

deploy_frontend() {
  echo "=== Frontend: building ==="
  cd "$DEV_DIR"
  npx ng build --configuration production

  echo "=== Frontend: syncing dist to prod ==="
  rsync -az --delete "$DEV_DIR/dist/" "$PROD_DIR/dist/"

  echo "=== Frontend: restarting SSR ==="
  pm2 restart magnus-photo-ssr --update-env

  set +e
  wait_healthy "http://localhost:4000/ssr-health" "SSR" || DEPLOY_HEALTHY=false
  set -e
}

build_photo_retouch_tool() {
  if [ ! -f "$DEV_DIR/photo-retouch-tool/Cargo.toml" ]; then
    return 0
  fi

  echo "=== Photo Retouch Tool: building Rust ==="
  cargo build --release --manifest-path "$DEV_DIR/photo-retouch-tool/Cargo.toml"

  echo "=== Photo Retouch Tool: syncing binary to prod ==="
  mkdir -p "$PROD_DIR/backend/bin"
  rsync -az "$DEV_DIR/photo-retouch-tool/target/release/photo-retouch-tool" "$PROD_DIR/backend/bin/photo-retouch-tool"
}

deploy_backend() {
  local scope="$1"

  validate_backend_scope "$scope"
  print_backend_scope_warning "$scope"
  build_photo_retouch_tool

  echo "=== Backend: building ==="
  cd "$DEV_DIR/backend"
  rm -rf dist
  npm run build

  echo "=== Backend: syncing to prod ==="
  rsync -az --delete "$DEV_DIR/backend/dist/" "$PROD_DIR/backend/dist/"
  rsync -az "$DEV_DIR/backend/package.json" "$DEV_DIR/backend/package-lock.json" "$PROD_DIR/backend/"
  rsync -az "$DEV_DIR/backend/workers/" "$PROD_DIR/backend/workers/"
  rm -f "$PROD_DIR/backend/workers/face_validator.py"

  echo "=== Backend: syncing ecosystem.config.cjs to prod ==="
  cp "$PROD_DIR/ecosystem.config.cjs" "$PROD_DIR/ecosystem.config.cjs.pre-split-backup" 2>/dev/null || true
  rsync -az "$DEV_DIR/ecosystem.config.cjs" "$PROD_DIR/ecosystem.config.cjs"

  echo "=== Backend: installing dependencies ==="
  cd "$PROD_DIR/backend"
  npm ci --omit=dev

  apply_backend_migrations

  if [ "$SPLIT_MODE" = "true" ]; then
    case "$scope" in
      api)
        echo "=== Backend: SPLIT_ENABLED=true — reloading API only ==="
        pm2 startOrReload "$PROD_DIR/ecosystem.config.cjs" --only magnus-photo-api --update-env
        check_split_core_health
        ;;
      telephony)
        echo "=== Backend: SPLIT_ENABLED=true — reloading telephony only ==="
        pm2 startOrReload "$PROD_DIR/ecosystem.config.cjs" --only magnus-photo-telephony --update-env
        check_split_core_health
        ;;
      all)
        echo "=== Backend: SPLIT_ENABLED=true — reloading all split backend processes ==="
        pm2 startOrReload "$PROD_DIR/ecosystem.config.cjs" --update-env
        check_split_full_health
        ;;
    esac
  else
    if [ "$scope" = "telephony" ]; then
      echo "!!! telephony-only deploy requested, but SPLIT_ENABLED is false !!!"
      exit 2
    fi

    echo "=== Backend: restarting API (monolith) ==="
    pm2 restart magnus-photo-api --update-env

    set +e
    wait_healthy "http://localhost:3001/api/health" "API" || DEPLOY_HEALTHY=false
    set -e
  fi

  pm2 save
}

case "$DEPLOY_TARGET" in
  backend)
    deploy_backend "$BACKEND_SCOPE"
    ;;
  telephony)
    deploy_backend "telephony"
    ;;
  frontend)
    deploy_frontend
    ;;
  all)
    deploy_backend "$BACKEND_SCOPE"
    deploy_frontend
    ;;
  *)
    echo "Usage: ./deploy.sh [backend|frontend|all|telephony] [api|telephony|all]"
    exit 2
    ;;
esac

if [ "$DEPLOY_HEALTHY" = false ]; then
  echo "!!! DEPLOY COMPLETED WITH HEALTH CHECK FAILURES !!!"
  exit 1
fi

echo "Done! All services healthy."
