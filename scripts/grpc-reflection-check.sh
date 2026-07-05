#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  GRPC_TARGET=grpc-staging.svoefoto.ru:443 scripts/grpc-reflection-check.sh

Environment:
  GRPC_TARGET                         gRPC host:port, defaults to grpc.svoefoto.ru:443
  GRPC_PLAINTEXT=1                    use plaintext for local 127.0.0.1:50051 checks
  GRPC_INSECURE=1                     skip TLS cert verification
  GRPC_AUTHORITY=host                 override :authority / TLS server name
  GRPC_TIMEOUT_SECONDS=20             grpcurl timeout

Fails if reflection exposes unexpected services, unexpected methods, or internal
customer-forbidden packages such as svf.gateway.v1, svf.infra.v1, or
svf.print.v1.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

GRPCURL_BIN="${GRPCURL_BIN:-grpcurl}"
GRPC_TARGET="${GRPC_TARGET:-grpc.svoefoto.ru:443}"
GRPC_TIMEOUT_SECONDS="${GRPC_TIMEOUT_SECONDS:-20}"
BASE_ARGS=(-max-time "$GRPC_TIMEOUT_SECONDS")

if ! command -v "$GRPCURL_BIN" >/dev/null 2>&1; then
  printf 'missing required command: %s\n' "$GRPCURL_BIN" >&2
  exit 127
fi

if is_truthy "${GRPC_PLAINTEXT:-}"; then
  BASE_ARGS+=(-plaintext)
fi
if is_truthy "${GRPC_INSECURE:-}"; then
  BASE_ARGS+=(-insecure)
fi
if [[ -n "${GRPC_AUTHORITY:-}" ]]; then
  BASE_ARGS+=(-authority "$GRPC_AUTHORITY")
fi

if list_output="$("$GRPCURL_BIN" "${BASE_ARGS[@]}" "$GRPC_TARGET" list 2>&1)"; then
  :
else
  status=$?
  printf 'failed to list reflected services for target %s\n' "$GRPC_TARGET" >&2
  printf '%s\n' "$list_output" >&2
  exit "$status"
fi

mapfile -t services < <(printf '%s\n' "$list_output" | sort)

declare -A allowed=(
  ["grpc.health.v1.Health"]=1
  ["grpc.reflection.v1.ServerReflection"]=1
  ["svf.platform.v1.ConfigService"]=1
  ["svf.auth.v1.AuthService"]=1
  ["svf.chat.v1.ChatService"]=1
  ["svf.orders.v1.OrderService"]=1
  ["svf.media.v1.MediaService"]=1
)

declare -A expected_methods=(
  ["grpc.health.v1.Health"]=$'grpc.health.v1.Health.Check\ngrpc.health.v1.Health.Watch'
  ["grpc.reflection.v1.ServerReflection"]=$'grpc.reflection.v1.ServerReflection.ServerReflectionInfo'
  ["svf.platform.v1.ConfigService"]=$'svf.platform.v1.ConfigService.GetAppConfig'
  ["svf.auth.v1.AuthService"]=$'svf.auth.v1.AuthService.GetMe\nsvf.auth.v1.AuthService.Logout\nsvf.auth.v1.AuthService.RefreshToken\nsvf.auth.v1.AuthService.SendOtp\nsvf.auth.v1.AuthService.Verify2FA\nsvf.auth.v1.AuthService.VerifyOtp'
  ["svf.chat.v1.ChatService"]=$'svf.chat.v1.ChatService.CompleteChatBundleUpload\nsvf.chat.v1.ChatService.CompleteChatUpload\nsvf.chat.v1.ChatService.GetCurrentSession\nsvf.chat.v1.ChatService.GetDeliveryStatuses\nsvf.chat.v1.ChatService.GetHistory\nsvf.chat.v1.ChatService.MarkRead\nsvf.chat.v1.ChatService.SendMessage\nsvf.chat.v1.ChatService.StartChatUpload'
  ["svf.orders.v1.OrderService"]=$'svf.orders.v1.OrderService.GetMyOrders\nsvf.orders.v1.OrderService.GetOrder'
  ["svf.media.v1.MediaService"]=$'svf.media.v1.MediaService.BatchGetSignedReadUrls\nsvf.media.v1.MediaService.GetSignedReadUrl\nsvf.media.v1.MediaService.GetSignedUploadUrl\nsvf.media.v1.MediaService.GetThumbnail'
)

failed=0

printf 'Target: %s\n' "$GRPC_TARGET"
printf 'Services:\n'
for service in "${services[@]}"; do
  printf '  %s\n' "$service"
  if [[ "$service" =~ ^svf\.(gateway|infra|print)\.v1\. ]]; then
    printf 'internal package leaked through reflection: %s\n' "$service" >&2
    failed=1
  elif [[ -z "${allowed[$service]:-}" ]]; then
    printf 'unexpected reflected service: %s\n' "$service" >&2
    failed=1
  fi
done

for service in "${!allowed[@]}"; do
  found=0
  for reflected in "${services[@]}"; do
    if [[ "$reflected" == "$service" ]]; then
      found=1
      break
    fi
  done
  if [[ "$found" -eq 0 ]]; then
    printf 'expected service missing from reflection: %s\n' "$service" >&2
    failed=1
  fi
done

for service in "${!expected_methods[@]}"; do
  if method_output="$("$GRPCURL_BIN" "${BASE_ARGS[@]}" "$GRPC_TARGET" list "$service" 2>&1)"; then
    :
  else
    status=$?
    printf 'failed to list reflected methods for service %s on target %s\n' "$service" "$GRPC_TARGET" >&2
    printf '%s\n' "$method_output" >&2
    exit "$status"
  fi

  reflected_methods="$(printf '%s\n' "$method_output" | sed '/^$/d' | sort)"
  expected_for_service="$(printf '%s\n' "${expected_methods[$service]}" | sort)"
  if [[ "$reflected_methods" != "$expected_for_service" ]]; then
    printf 'unexpected reflected methods for service: %s\n' "$service" >&2
    diff -u \
      <(printf '%s\n' "$expected_for_service") \
      <(printf '%s\n' "$reflected_methods") >&2 || true
    failed=1
  fi
done

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

printf 'Reflection surface ok\n'
