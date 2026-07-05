#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  GRPC_TARGET=grpc-staging.svoefoto.ru:443 scripts/grpc-unary-smoke.sh

Environment:
  GRPC_TARGET                         gRPC host:port, defaults to grpc.svoefoto.ru:443
  GRPC_PLAINTEXT=1                    use plaintext for local 127.0.0.1:50051 checks
  GRPC_INSECURE=1                     skip TLS cert verification
  GRPC_AUTHORITY=host                 override :authority / TLS server name
  GRPC_AUTH_TOKEN=token               access token for authenticated RPCs
  GRPC_REFRESH_TOKEN=token            refresh token for RefreshToken/optional Logout smoke
  GRPC_SMOKE_PHONE=+79000000000       phone for SendOtp
  GRPC_SMOKE_OTP=1234                 4-digit voice OTP code for VerifyOtp; parsed token is used for later RPCs
  GRPC_SMOKE_PROFILE_NAME=name        optional display name for VerifyOtp profile completion
  GRPC_SMOKE_PROFILE_BIRTH_DATE=date  optional YYYY-MM-DD birth date for VerifyOtp profile completion
  GRPC_DEVICE_ID=grpc-smoke           stable device/app install id for phone OTP
  GRPC_DEVICE_NAME=grpcurl smoke      user-visible device name for phone OTP
  GRPC_2FA_TEMP_TOKEN=token           temp token for optional Verify2FA smoke
  GRPC_2FA_CODE=123456                2FA code for optional Verify2FA smoke
  GRPC_SMOKE_SEND_MESSAGE=1           send a real chat message in the safe test account
  GRPC_SMOKE_MESSAGE_TEXT=...         message text, defaults to "grpc smoke"
  GRPC_SMOKE_UPLOAD_FILE=/path/file   enable StartChatUpload, S3 PUT, CompleteChatUpload
  GRPC_SMOKE_UPLOAD_CONTENT_TYPE=...  override detected upload MIME type
  GRPC_SMOKE_BUNDLE_UPLOAD=1          use CompleteChatBundleUpload instead of CompleteChatUpload
  GRPC_BUNDLE_CATEGORY_SLUG=slug      required when GRPC_SMOKE_BUNDLE_UPLOAD=1
  GRPC_BUNDLE_SELECTED_DOC=slug       optional bundle selectedDoc
  GRPC_BUNDLE_CUSTOMER_NOTE=...       optional bundle customerNote
  GRPC_BUNDLE_CONFIGURATOR_TOTAL=0    optional bundle total in RUB
  GRPC_SMOKE_MEDIA_UPLOAD_URL=1       run Media.GetSignedUploadUrl without uploading bytes
  GRPC_THUMBNAIL_URL=url              run Media.GetThumbnail for this URL
  GRPC_MEDIA_KEY=key                  run media signed read smoke for an S3 key
  GRPC_MEDIA_URL=url                  run media signed read smoke for a public media URL
  GRPC_ORDER_ID=id                    run Orders.GetOrder for this order; otherwise first order is used
  GRPC_SMOKE_LOGOUT=1                 run Logout at the end when a refresh token is available
  GRPC_SMOKE_VERBOSE=1                print non-sensitive RPC responses; auth tokens stay redacted

The script never prints access or refresh tokens.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'missing required command: %s\n' "$1" >&2
    exit 127
  fi
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

redact_tokens() {
  if has_cmd jq; then
    jq 'if .tokens then
          .tokens.accessToken = "***" |
          .tokens.refreshToken = "***" |
          .tokens.access_token = "***" |
          .tokens.refresh_token = "***"
        else . end'
  else
    printf '[response hidden because it contains tokens]\n'
  fi
}

run_rpc() {
  local label="$1"
  local method="$2"
  local data="$3"
  local token="${4:-}"
  local tmp headers status extra_args

  if (($# >= 4)); then
    shift 4
  else
    shift 3
  fi
  extra_args=("$@")

  tmp="$(mktemp)"
  headers=()
  if [[ -n "$token" ]]; then
    headers+=(-H "authorization: Bearer ${token}")
  fi

  printf '%-30s' "${label}"
  if "$GRPCURL_BIN" "${BASE_ARGS[@]}" "${extra_args[@]}" "${headers[@]}" -d "$data" "$GRPC_TARGET" "$method" >"$tmp" 2>&1; then
    printf 'ok\n'
    LAST_RESPONSE="$(<"$tmp")"
    if is_truthy "${GRPC_SMOKE_VERBOSE:-}"; then
      if [[ "$method" == "svf.auth.v1.AuthService/VerifyOtp" ||
            "$method" == "svf.auth.v1.AuthService/RefreshToken" ||
            "$method" == "svf.auth.v1.AuthService/Verify2FA" ]]; then
        printf '%s\n' "$LAST_RESPONSE" | redact_tokens
      else
        printf '%s\n' "$LAST_RESPONSE"
      fi
    fi
  else
    status=$?
    printf 'failed\n' >&2
    sed -n '1,120p' "$tmp" >&2
    rm -f "$tmp"
    exit "$status"
  fi

  rm -f "$tmp"
}

jq_payload() {
  if ! has_cmd jq; then
    printf 'jq is required for this optional smoke step\n' >&2
    return 1
  fi
  jq "$@"
}

detect_content_type() {
  local file_path="$1"

  if [[ -n "${GRPC_SMOKE_UPLOAD_CONTENT_TYPE:-}" ]]; then
    printf '%s\n' "$GRPC_SMOKE_UPLOAD_CONTENT_TYPE"
    return
  fi

  if has_cmd file; then
    file -b --mime-type "$file_path"
    return
  fi

  case "$file_path" in
    *.jpg|*.jpeg) printf 'image/jpeg\n' ;;
    *.png) printf 'image/png\n' ;;
    *.webp) printf 'image/webp\n' ;;
    *.pdf) printf 'application/pdf\n' ;;
    *.txt) printf 'text/plain\n' ;;
    *) printf 'application/octet-stream\n' ;;
  esac
}

new_client_message_id() {
  if has_cmd uuidgen; then
    uuidgen | tr '[:upper:]' '[:lower:]'
    return
  fi

  printf 'grpc-smoke-%s-%s\n' "$(date +%s)" "$RANDOM"
}

GRPCURL_BIN="${GRPCURL_BIN:-grpcurl}"
GRPC_TARGET="${GRPC_TARGET:-grpc.svoefoto.ru:443}"
GRPC_PLATFORM="${GRPC_PLATFORM:-android}"
GRPC_TIMEOUT_SECONDS="${GRPC_TIMEOUT_SECONDS:-20}"
TOKEN="${GRPC_AUTH_TOKEN:-}"
REFRESH_TOKEN="${GRPC_REFRESH_TOKEN:-}"
LAST_RESPONSE=""
BASE_ARGS=(-max-time "$GRPC_TIMEOUT_SECONDS")
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
HEALTH_PROTO_ARGS=()

if is_truthy "${GRPC_PLAINTEXT:-}"; then
  BASE_ARGS+=(-plaintext)
fi
if is_truthy "${GRPC_INSECURE:-}"; then
  BASE_ARGS+=(-insecure)
fi
if [[ -n "${GRPC_AUTHORITY:-}" ]]; then
  BASE_ARGS+=(-authority "$GRPC_AUTHORITY")
fi
if [[ -f "$REPO_ROOT/proto/grpc/health/v1/health.proto" ]]; then
  HEALTH_PROTO_ARGS=(-import-path "$REPO_ROOT/proto" -proto grpc/health/v1/health.proto)
fi

require_cmd "$GRPCURL_BIN"

printf 'Target: %s\n' "$GRPC_TARGET"

run_rpc "Health.Check" \
  "grpc.health.v1.Health/Check" \
  '{"service":""}' \
  "" \
  "${HEALTH_PROTO_ARGS[@]}"

run_rpc "Config.GetAppConfig" \
  "svf.platform.v1.ConfigService/GetAppConfig" \
  "{\"platform\":\"${GRPC_PLATFORM}\"}"

if [[ -n "${GRPC_SMOKE_PHONE:-}" ]]; then
  if has_cmd jq; then
    send_otp_payload="$(jq_payload -n \
      --arg phone "$GRPC_SMOKE_PHONE" \
      --arg device_id "${GRPC_DEVICE_ID:-grpc-smoke}" \
      --arg device_name "${GRPC_DEVICE_NAME:-grpcurl smoke}" \
      '{phone:$phone, device_id:$device_id, device_name:$device_name}')"
    run_rpc "Auth.SendOtp" \
      "svf.auth.v1.AuthService/SendOtp" \
      "$send_otp_payload"

    if [[ -n "${GRPC_SMOKE_OTP:-}" ]]; then
      verify_otp_payload="$(jq_payload -n \
        --arg phone "$GRPC_SMOKE_PHONE" \
        --arg code "$GRPC_SMOKE_OTP" \
        --arg device_id "${GRPC_DEVICE_ID:-grpc-smoke}" \
        --arg device_name "${GRPC_DEVICE_NAME:-grpcurl smoke}" \
        --arg profile_name "${GRPC_SMOKE_PROFILE_NAME:-}" \
        --arg profile_birth_date "${GRPC_SMOKE_PROFILE_BIRTH_DATE:-}" \
        '{
          phone:$phone,
          code:$code,
          device_id:$device_id,
          device_name:$device_name
        } + (
          if $profile_name == "" then {}
          else {
            profile: ({
              displayName:$profile_name
            } + (
                if $profile_birth_date == "" then {}
                else {dateOfBirth:$profile_birth_date}
                end
              ))
          }
          end
        )')"
      run_rpc "Auth.VerifyOtp" \
        "svf.auth.v1.AuthService/VerifyOtp" \
        "$verify_otp_payload"
      TOKEN="$(printf '%s\n' "$LAST_RESPONSE" | jq -r '.tokens.accessToken // .tokens.access_token // empty')"
      REFRESH_TOKEN="$(printf '%s\n' "$LAST_RESPONSE" | jq -r '.tokens.refreshToken // .tokens.refresh_token // empty')"
      REQUIRES_PROFILE="$(printf '%s\n' "$LAST_RESPONSE" | jq -r '.requiresProfile // .requires_profile // false')"
      if [[ -n "$TOKEN" ]]; then
        printf '%-30sok\n' "Auth token captured"
      elif [[ "$REQUIRES_PROFILE" == "true" ]]; then
        printf 'Auth profile required; set GRPC_SMOKE_PROFILE_NAME and rerun VerifyOtp with the same active OTP\n'
      else
        printf 'VerifyOtp succeeded but no access token was found in the response\n' >&2
      fi
    else
      printf 'Auth.VerifyOtp skipped; set GRPC_SMOKE_OTP after receiving the OTP code\n'
    fi
  else
    printf 'Auth.SendOtp skipped; jq is required to build JSON safely\n'
  fi
fi

if [[ -n "${GRPC_2FA_TEMP_TOKEN:-}" || -n "${GRPC_2FA_CODE:-}" ]]; then
  if ! has_cmd jq; then
    printf 'Auth.Verify2FA skipped; jq is required to build JSON safely\n'
  elif [[ -n "${GRPC_2FA_TEMP_TOKEN:-}" && -n "${GRPC_2FA_CODE:-}" ]]; then
    verify_2fa_payload="$(jq_payload -n \
      --arg temp_token "$GRPC_2FA_TEMP_TOKEN" \
      --arg code "$GRPC_2FA_CODE" \
      '{tempToken:$temp_token, code:$code}')"
    run_rpc "Auth.Verify2FA" \
      "svf.auth.v1.AuthService/Verify2FA" \
      "$verify_2fa_payload"
    TOKEN="$(printf '%s\n' "$LAST_RESPONSE" | jq -r '.tokens.accessToken // .tokens.access_token // empty')"
    REFRESH_TOKEN="$(printf '%s\n' "$LAST_RESPONSE" | jq -r '.tokens.refreshToken // .tokens.refresh_token // empty')"
    if [[ -n "$TOKEN" ]]; then
      printf '%-30sok\n' "2FA token captured"
    else
      printf 'Verify2FA succeeded but no access token was found in the response\n' >&2
    fi
  else
    printf 'Auth.Verify2FA skipped; set both GRPC_2FA_TEMP_TOKEN and GRPC_2FA_CODE\n'
  fi
fi

if [[ -z "$TOKEN" ]]; then
  printf 'Authenticated RPCs skipped; set GRPC_AUTH_TOKEN, GRPC_SMOKE_PHONE plus GRPC_SMOKE_OTP, or GRPC_2FA_TEMP_TOKEN plus GRPC_2FA_CODE\n'
  exit 0
fi

require_cmd jq

if [[ -n "$REFRESH_TOKEN" ]] && has_cmd jq; then
  refresh_payload="$(jq_payload -n --arg refresh_token "$REFRESH_TOKEN" '{refreshToken:$refresh_token}')"
  run_rpc "Auth.RefreshToken" \
    "svf.auth.v1.AuthService/RefreshToken" \
    "$refresh_payload"

  refreshed_token="$(printf '%s\n' "$LAST_RESPONSE" | jq -r '.tokens.accessToken // .tokens.access_token // empty')"
  refreshed_refresh_token="$(printf '%s\n' "$LAST_RESPONSE" | jq -r '.tokens.refreshToken // .tokens.refresh_token // empty')"
  if [[ -n "$refreshed_token" ]]; then
    TOKEN="$refreshed_token"
    printf '%-30sok\n' "Refreshed token captured"
  fi
  if [[ -n "$refreshed_refresh_token" ]]; then
    REFRESH_TOKEN="$refreshed_refresh_token"
  fi
elif [[ -n "$REFRESH_TOKEN" ]]; then
  printf 'Auth.RefreshToken skipped; jq is required to build JSON safely\n'
else
  printf 'Auth.RefreshToken skipped; set GRPC_REFRESH_TOKEN or use OTP smoke\n'
fi

run_rpc "Auth.GetMe" \
  "svf.auth.v1.AuthService/GetMe" \
  '{}' \
  "$TOKEN"

run_rpc "Chat.GetCurrentSession" \
  "svf.chat.v1.ChatService/GetCurrentSession" \
  '{"includeMessages":true}' \
  "$TOKEN"

SESSION_ID="${GRPC_CHAT_SESSION_ID:-}"
if [[ -z "$SESSION_ID" ]] && has_cmd jq; then
  SESSION_ID="$(printf '%s\n' "$LAST_RESPONSE" | jq -r '.session.id // empty')"
fi

CLIENT_MESSAGE_ID="${GRPC_CLIENT_MESSAGE_ID:-}"
if [[ -n "$SESSION_ID" ]]; then
  get_history_payload="$(jq_payload -n \
    --arg session_id "$SESSION_ID" \
    '{sessionId:$session_id, pagination:{page:1, limit:20}}')"
  run_rpc "Chat.GetHistory" \
    "svf.chat.v1.ChatService/GetHistory" \
    "$get_history_payload" \
    "$TOKEN"

  if is_truthy "${GRPC_SMOKE_SEND_MESSAGE:-}"; then
    CLIENT_MESSAGE_ID="${CLIENT_MESSAGE_ID:-$(new_client_message_id)}"
    send_message_payload="$(jq_payload -n \
      --arg session_id "$SESSION_ID" \
      --arg content "${GRPC_SMOKE_MESSAGE_TEXT:-grpc smoke}" \
      --arg client_message_id "$CLIENT_MESSAGE_ID" \
      '{sessionId:$session_id, content:$content, messageType:"MESSAGE_TYPE_TEXT", clientMessageId:$client_message_id}')"
    run_rpc "Chat.SendMessage" \
      "svf.chat.v1.ChatService/SendMessage" \
      "$send_message_payload" \
      "$TOKEN"
  else
    printf 'Chat.SendMessage skipped; set GRPC_SMOKE_SEND_MESSAGE=1 for the mutating smoke\n'
  fi

  mark_read_payload="$(jq_payload -n --arg session_id "$SESSION_ID" '{sessionId:$session_id}')"
  run_rpc "Chat.MarkRead" \
    "svf.chat.v1.ChatService/MarkRead" \
    "$mark_read_payload" \
    "$TOKEN"

  if [[ -n "$CLIENT_MESSAGE_ID" ]]; then
    delivery_payload="$(jq_payload -n \
      --arg session_id "$SESSION_ID" \
      --arg client_message_id "$CLIENT_MESSAGE_ID" \
      '{sessionId:$session_id, clientMessageIds:[$client_message_id]}')"
    run_rpc "Chat.GetDeliveryStatuses" \
      "svf.chat.v1.ChatService/GetDeliveryStatuses" \
      "$delivery_payload" \
      "$TOKEN"
  else
    printf 'Chat.GetDeliveryStatuses skipped; set GRPC_CLIENT_MESSAGE_ID or GRPC_SMOKE_SEND_MESSAGE=1\n'
  fi
else
  printf 'Chat session-scoped smoke skipped; no session id found, set GRPC_CHAT_SESSION_ID\n'
fi

if [[ -n "${GRPC_SMOKE_UPLOAD_FILE:-}" ]]; then
  require_cmd curl
  if ! has_cmd jq; then
    printf 'Chat upload smoke skipped; jq is required to parse presign output\n'
  elif [[ -z "$SESSION_ID" ]]; then
    printf 'Chat upload smoke skipped; no session id found, set GRPC_CHAT_SESSION_ID\n'
  elif [[ ! -f "$GRPC_SMOKE_UPLOAD_FILE" ]]; then
    printf 'Chat upload smoke skipped; file not found: %s\n' "$GRPC_SMOKE_UPLOAD_FILE"
  elif is_truthy "${GRPC_SMOKE_BUNDLE_UPLOAD:-}" && [[ -z "${GRPC_BUNDLE_CATEGORY_SLUG:-}" ]]; then
    printf 'Chat bundle upload smoke skipped; set GRPC_BUNDLE_CATEGORY_SLUG\n'
  else
    upload_name="${GRPC_SMOKE_UPLOAD_NAME:-$(basename "$GRPC_SMOKE_UPLOAD_FILE")}"
    upload_type="$(detect_content_type "$GRPC_SMOKE_UPLOAD_FILE")"
    upload_size="$(wc -c <"$GRPC_SMOKE_UPLOAD_FILE" | tr -d '[:space:]')"
    start_upload_payload="$(jq_payload -n \
      --arg session_id "$SESSION_ID" \
      --arg file_name "$upload_name" \
      --arg content_type "$upload_type" \
      --argjson size_bytes "$upload_size" \
      '{sessionId:$session_id, files:[{fileName:$file_name, contentType:$content_type, sizeBytes:$size_bytes}]}')"

    run_rpc "Chat.StartChatUpload" \
      "svf.chat.v1.ChatService/StartChatUpload" \
      "$start_upload_payload" \
      "$TOKEN"

    upload_url="$(printf '%s\n' "$LAST_RESPONSE" | jq -r '.uploads[0].uploadUrl // .uploads[0].upload_url // empty')"
    s3_key="$(printf '%s\n' "$LAST_RESPONSE" | jq -r '.uploads[0].s3Key // .uploads[0].s3_key // empty')"
    if [[ -z "$upload_url" || -z "$s3_key" ]]; then
      printf 'Chat.StartChatUpload did not return uploadUrl and s3Key\n' >&2
      exit 1
    fi

    printf '%-30s' "S3 PUT"
    curl --fail --show-error --silent \
      -X PUT \
      -H "Content-Type: ${upload_type}" \
      --data-binary "@${GRPC_SMOKE_UPLOAD_FILE}" \
      "$upload_url" >/dev/null
    printf 'ok\n'

    if is_truthy "${GRPC_SMOKE_BUNDLE_UPLOAD:-}"; then
      complete_bundle_upload_payload="$(jq_payload -n \
        --arg session_id "$SESSION_ID" \
        --arg s3_key "$s3_key" \
        --arg file_name "$upload_name" \
        --arg content_type "$upload_type" \
        --arg category_slug "$GRPC_BUNDLE_CATEGORY_SLUG" \
        --arg selected_doc "${GRPC_BUNDLE_SELECTED_DOC:-}" \
        --arg customer_note "${GRPC_BUNDLE_CUSTOMER_NOTE:-grpc smoke}" \
        --argjson size_bytes "$upload_size" \
        --argjson configurator_total "${GRPC_BUNDLE_CONFIGURATOR_TOTAL:-0}" \
        '{sessionId:$session_id, files:[{s3Key:$s3_key, fileName:$file_name, contentType:$content_type, sizeBytes:$size_bytes}], orderConfig:{categorySlug:$category_slug, selectedDoc:$selected_doc, customerNote:$customer_note, configuratorTotal:$configurator_total}}')"

      run_rpc "Chat.CompleteChatBundleUpload" \
        "svf.chat.v1.ChatService/CompleteChatBundleUpload" \
        "$complete_bundle_upload_payload" \
        "$TOKEN"
    else
      complete_upload_payload="$(jq_payload -n \
        --arg session_id "$SESSION_ID" \
        --arg s3_key "$s3_key" \
        --arg file_name "$upload_name" \
        --arg content_type "$upload_type" \
        --argjson size_bytes "$upload_size" \
        '{sessionId:$session_id, files:[{s3Key:$s3_key, fileName:$file_name, contentType:$content_type, sizeBytes:$size_bytes}], caption:"grpc smoke", suppressBot:true}')"

      run_rpc "Chat.CompleteChatUpload" \
        "svf.chat.v1.ChatService/CompleteChatUpload" \
        "$complete_upload_payload" \
        "$TOKEN"
    fi
  fi
else
  printf 'Chat upload smoke skipped; set GRPC_SMOKE_UPLOAD_FILE to run StartChatUpload and an upload complete RPC\n'
fi

run_rpc "Orders.GetMyOrders" \
  "svf.orders.v1.OrderService/GetMyOrders" \
  '{"pagination":{"page":1,"limit":10}}' \
  "$TOKEN"

ORDER_ID="${GRPC_ORDER_ID:-}"
if [[ -z "$ORDER_ID" ]] && has_cmd jq; then
  ORDER_ID="$(printf '%s\n' "$LAST_RESPONSE" | jq -r '.orders[0].id // empty')"
fi

if [[ -n "$ORDER_ID" ]]; then
  get_order_payload="$(jq_payload -n --arg order_id "$ORDER_ID" '{orderId:$order_id}')"
  run_rpc "Orders.GetOrder" \
    "svf.orders.v1.OrderService/GetOrder" \
    "$get_order_payload" \
    "$TOKEN"
else
  printf 'Orders.GetOrder skipped; no order found, set GRPC_ORDER_ID\n'
fi

if is_truthy "${GRPC_SMOKE_MEDIA_UPLOAD_URL:-}"; then
  media_upload_payload="$(jq_payload -n \
    --arg file_name "${GRPC_SMOKE_MEDIA_FILE_NAME:-grpc-smoke.pdf}" \
    --arg content_type "${GRPC_SMOKE_MEDIA_CONTENT_TYPE:-application/pdf}" \
    --arg purpose "${GRPC_SMOKE_MEDIA_PURPOSE:-document}" \
    --argjson size_bytes "${GRPC_SMOKE_MEDIA_SIZE_BYTES:-1}" \
    '{fileName:$file_name, contentType:$content_type, sizeBytes:$size_bytes, purpose:$purpose}')"
  run_rpc "Media.GetSignedUploadUrl" \
    "svf.media.v1.MediaService/GetSignedUploadUrl" \
    "$media_upload_payload" \
    "$TOKEN"
else
  printf 'Media.GetSignedUploadUrl skipped; set GRPC_SMOKE_MEDIA_UPLOAD_URL=1\n'
fi

if [[ -n "${GRPC_THUMBNAIL_URL:-}" ]]; then
  thumbnail_payload="$(jq_payload -n \
    --arg url "$GRPC_THUMBNAIL_URL" \
    --arg format "${GRPC_THUMBNAIL_FORMAT:-webp}" \
    --argjson width "${GRPC_THUMBNAIL_WIDTH:-320}" \
    --argjson height "${GRPC_THUMBNAIL_HEIGHT:-320}" \
    '{url:$url, width:$width, height:$height, format:$format}')"
  run_rpc "Media.GetThumbnail" \
    "svf.media.v1.MediaService/GetThumbnail" \
    "$thumbnail_payload" \
    "$TOKEN"
else
  printf 'Media.GetThumbnail skipped; set GRPC_THUMBNAIL_URL\n'
fi

if [[ -n "${GRPC_MEDIA_KEY:-}" || -n "${GRPC_MEDIA_URL:-}" ]]; then
  if [[ -n "${GRPC_MEDIA_KEY:-}" ]]; then
    media_read_payload="$(jq_payload -n --arg key "$GRPC_MEDIA_KEY" '{key:$key}')"
    media_batch_payload="$(jq_payload -n --arg key "$GRPC_MEDIA_KEY" '{keys:[$key]}')"
  else
    media_read_payload="$(jq_payload -n --arg url "$GRPC_MEDIA_URL" '{url:$url}')"
    media_batch_payload="$(jq_payload -n --arg url "$GRPC_MEDIA_URL" '{urls:[$url]}')"
  fi

  run_rpc "Media.GetSignedReadUrl" \
    "svf.media.v1.MediaService/GetSignedReadUrl" \
    "$media_read_payload" \
    "$TOKEN"

  run_rpc "Media.BatchGetSignedReadUrls" \
    "svf.media.v1.MediaService/BatchGetSignedReadUrls" \
    "$media_batch_payload" \
    "$TOKEN"
else
  printf 'Media signed read smoke skipped; set GRPC_MEDIA_KEY or GRPC_MEDIA_URL\n'
fi

if is_truthy "${GRPC_SMOKE_LOGOUT:-}"; then
  if [[ -n "$REFRESH_TOKEN" ]]; then
    logout_payload="$(jq_payload -n --arg refresh_token "$REFRESH_TOKEN" '{refreshToken:$refresh_token}')"
    run_rpc "Auth.Logout" \
      "svf.auth.v1.AuthService/Logout" \
      "$logout_payload" \
      "$TOKEN"
  else
    printf 'Auth.Logout skipped; no refresh token available\n'
  fi
else
  printf 'Auth.Logout skipped; set GRPC_SMOKE_LOGOUT=1 when the refresh token may be invalidated\n'
fi
