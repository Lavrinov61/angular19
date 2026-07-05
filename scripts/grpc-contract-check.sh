#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/grpc-contract-check.sh

Environment:
  BUF_BIN=buf                         override buf command
  BUF_NPM_VERSION=1.68.4              @bufbuild/buf version for npx fallback
  GRPC_CONTRACT_BASELINE=...          run buf breaking against this baseline

Runs proto lint, optional breaking checks, and the svf-gateway reflection
descriptor boundary test. Also verifies Android/Kotlin gRPC generation in a
temporary directory.
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

cd "$REPO_ROOT"

run_buf lint proto

if [[ -n "${GRPC_CONTRACT_BASELINE:-}" ]]; then
  run_buf breaking proto --against "$GRPC_CONTRACT_BASELINE"
else
  printf 'GRPC_CONTRACT_BASELINE is not configured; skipping buf breaking until v1 is frozen.\n'
fi

cargo test --manifest-path svf-gateway/Cargo.toml \
  proto::tests::reflection_descriptor_exposes_mobile_bff_contract_only

scripts/grpc-kotlin-generate-check.sh
