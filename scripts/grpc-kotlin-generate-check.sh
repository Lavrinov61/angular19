#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/grpc-kotlin-generate-check.sh

Environment:
  BUF_BIN=buf                         override buf command
  BUF_NPM_VERSION=1.68.4              @bufbuild/buf version for npx fallback
  GRPC_JAVA_PLUGIN_VERSION=v1.76.0    buf.build/grpc/java plugin version
  GRPC_KOTLIN_PLUGIN_VERSION=v1.5.0   buf.build/grpc/kotlin plugin version

Generates Java, Kotlin, grpc-java, and grpc-kotlin code into a temporary
directory from the public mobile proto files only. Generated files are not
written to the repository.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

run_buf() {
  if [[ -n "${BUF_BIN:-}" ]]; then
    "$BUF_BIN" "$@"
  elif command -v buf >/dev/null 2>&1; then
    buf "$@"
  elif command -v npx >/dev/null 2>&1; then
    npx -y "@bufbuild/buf@${BUF_NPM_VERSION:-1.68.4}" "$@"
  else
    printf 'missing buf; install buf or npm/npx, or set BUF_BIN\n' >&2
    exit 127
  fi
}

public_proto_paths=(
  "proto/svf/common/v1/common.proto"
  "proto/svf/platform/v1/config.proto"
  "proto/svf/auth/v1/auth.proto"
  "proto/svf/chat/v1/chat.proto"
  "proto/svf/orders/v1/orders.proto"
  "proto/svf/media/v1/media.proto"
)

expected_stub_files=(
  "grpc-java/ru/svoefoto/proto/platform/v1/ConfigServiceGrpc.java"
  "grpc-java/ru/svoefoto/proto/auth/v1/AuthServiceGrpc.java"
  "grpc-java/ru/svoefoto/proto/chat/v1/ChatServiceGrpc.java"
  "grpc-java/ru/svoefoto/proto/orders/v1/OrderServiceGrpc.java"
  "grpc-java/ru/svoefoto/proto/media/v1/MediaServiceGrpc.java"
  "grpc-kotlin/ru/svoefoto/proto/platform/v1/ConfigGrpcKt.kt"
  "grpc-kotlin/ru/svoefoto/proto/auth/v1/AuthGrpcKt.kt"
  "grpc-kotlin/ru/svoefoto/proto/chat/v1/ChatGrpcKt.kt"
  "grpc-kotlin/ru/svoefoto/proto/orders/v1/OrdersGrpcKt.kt"
  "grpc-kotlin/ru/svoefoto/proto/media/v1/MediaGrpcKt.kt"
)

template="version: v2
plugins:
  - protoc_builtin: java
    out: java
  - protoc_builtin: kotlin
    out: kotlin
  - remote: buf.build/grpc/java:${GRPC_JAVA_PLUGIN_VERSION:-v1.76.0}
    out: grpc-java
  - remote: buf.build/grpc/kotlin:${GRPC_KOTLIN_PLUGIN_VERSION:-v1.5.0}
    out: grpc-kotlin
"

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

cd "$REPO_ROOT"

path_args=()
for proto_path in "${public_proto_paths[@]}"; do
  path_args+=(--path "$proto_path")
done

run_buf generate proto --template "$template" --output "$tmpdir" "${path_args[@]}"

for expected in "${expected_stub_files[@]}"; do
  if [[ ! -f "$tmpdir/$expected" ]]; then
    printf 'expected generated stub missing: %s\n' "$expected" >&2
    exit 1
  fi
done

if forbidden_files="$(find "$tmpdir" -type f | grep -E '/(gateway|infra|print)/|GatewayGrpc|InfraGrpc|PrintGrpc|AgentGatewayServiceGrpc|PosServiceGrpc' || true)" &&
  [[ -n "$forbidden_files" ]]; then
  printf 'internal generated stubs found in mobile Kotlin output:\n%s\n' "$forbidden_files" >&2
  exit 1
fi

file_count="$(find "$tmpdir" -type f | wc -l | tr -d '[:space:]')"
printf 'Kotlin/Java gRPC generation ok (%s files, temporary output)\n' "$file_count"
