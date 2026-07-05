#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  PHONE_AUTH_LIVE_PHONE=89890000000 scripts/phone-auth-live-e2e.sh request
  PHONE_AUTH_LIVE_PHONE=89890000000 PHONE_AUTH_LIVE_CODE=1234 scripts/phone-auth-live-e2e.sh verify
  PHONE_AUTH_LIVE_PHONE=89890000000 PHONE_AUTH_LIVE_CODE=0000 PHONE_AUTH_LIVE_EXPECT_CODE=PHONE_CODE_INVALID scripts/phone-auth-live-e2e.sh verify

Actions:
  request   solve the production ALTCHA challenge and request a real voice OTP call
  verify    verify the latest pending code for the same phone

Environment:
  PHONE_AUTH_LIVE_BASE          default: https://svoefoto.ru
  PHONE_AUTH_LIVE_PHONE         required; real phone number to test
  PHONE_AUTH_LIVE_CODE          required for verify
  PHONE_AUTH_LIVE_EXPECT_CODE   optional; treats a matching API error code as a successful expected-negative check
  PHONE_AUTH_LIVE_FINGERPRINT   default: codex-live-smoke-<utc date>
  PHONE_AUTH_LIVE_STAFF_ONLY    default: false; sends staffOnly=true on verify when true
  PHONE_AUTH_LIVE_TIMEOUT_MS    default: 20000
  PHONE_AUTH_LIVE_ARTIFACT_DIR  default: /tmp/phone-auth-live-e2e-<utc timestamp>

Notes:
  - request starts a real outbound voice OTP call.
  - verify may log in or auto-register the phone according to the production phone-auth flow.
  - auth tokens and user PII are redacted from console output and artifacts.
USAGE
}

ACTION="${1:-request}"
if [[ "$ACTION" == "-h" || "$ACTION" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$ACTION" != "request" && "$ACTION" != "verify" ]]; then
  printf 'unknown action: %s\n\n' "$ACTION" >&2
  usage >&2
  exit 2
fi

if [[ -z "${PHONE_AUTH_LIVE_PHONE:-}" ]]; then
  printf 'PHONE_AUTH_LIVE_PHONE is required\n\n' >&2
  usage >&2
  exit 2
fi

if [[ "$ACTION" == "verify" && -z "${PHONE_AUTH_LIVE_CODE:-}" ]]; then
  printf 'PHONE_AUTH_LIVE_CODE is required for verify\n\n' >&2
  usage >&2
  exit 2
fi

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

export PHONE_AUTH_LIVE_ACTION="$ACTION"
export PHONE_AUTH_LIVE_BASE="${PHONE_AUTH_LIVE_BASE:-https://svoefoto.ru}"
export PHONE_AUTH_LIVE_FINGERPRINT="${PHONE_AUTH_LIVE_FINGERPRINT:-codex-live-smoke-$(date -u +%Y-%m-%d)}"
export PHONE_AUTH_LIVE_STAFF_ONLY="${PHONE_AUTH_LIVE_STAFF_ONLY:-false}"
export PHONE_AUTH_LIVE_TIMEOUT_MS="${PHONE_AUTH_LIVE_TIMEOUT_MS:-20000}"
export PHONE_AUTH_LIVE_ARTIFACT_DIR="${PHONE_AUTH_LIVE_ARTIFACT_DIR:-/tmp/phone-auth-live-e2e-$(date -u +%Y%m%dT%H%M%SZ)}"

mkdir -p "$PHONE_AUTH_LIVE_ARTIFACT_DIR"

cd "$BACKEND_DIR"

node --input-type=module <<'NODE'
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { solveChallenge } from 'altcha-lib';
import { deriveKey as deriveAltchaKey } from 'altcha-lib/algorithms/pbkdf2';

const action = process.env.PHONE_AUTH_LIVE_ACTION;
const baseUrl = process.env.PHONE_AUTH_LIVE_BASE;
const phone = process.env.PHONE_AUTH_LIVE_PHONE;
const code = process.env.PHONE_AUTH_LIVE_CODE;
const expectedCode = process.env.PHONE_AUTH_LIVE_EXPECT_CODE;
const fingerprintVisitorId = process.env.PHONE_AUTH_LIVE_FINGERPRINT;
const staffOnly = process.env.PHONE_AUTH_LIVE_STAFF_ONLY === 'true';
const timeoutMs = Number.parseInt(process.env.PHONE_AUTH_LIVE_TIMEOUT_MS || '20000', 10);
const artifactDir = process.env.PHONE_AUTH_LIVE_ARTIFACT_DIR;

function maskPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length <= 4) {
    return digits;
  }
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function encodeAltchaPayload(challenge, solution) {
  return Buffer.from(JSON.stringify({
    challenge: {
      parameters: challenge.parameters,
      signature: challenge.signature,
    },
    solution,
  }), 'utf8').toString('base64');
}

function redactBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const copy = structuredClone(value);
  if (copy.data && typeof copy.data === 'object') {
    if ('accessToken' in copy.data) {
      copy.data.accessToken = '[redacted]';
    }
    if ('refreshToken' in copy.data) {
      copy.data.refreshToken = '[redacted]';
    }
    if (copy.data.user && typeof copy.data.user === 'object') {
      if ('id' in copy.data.user) {
        copy.data.user.id = '[redacted]';
      }
      if ('email' in copy.data.user) {
        copy.data.user.email = '[redacted]';
      }
      if ('displayName' in copy.data.user) {
        copy.data.user.displayName = '[redacted]';
      }
    }
  }
  return copy;
}

async function fetchJson(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 500);
    }

    return {
      body,
      ok: response.ok,
      status: response.status,
      xRequestId: response.headers.get('x-request-id'),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function writeArtifact(name, payload) {
  await writeFile(
    path.join(artifactDir, `${name}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
}

async function requestCode() {
  const challengeResult = await fetchJson(`${baseUrl}/api/auth/phone-captcha/challenge`, {
    headers: { accept: 'application/json' },
  });
  await writeArtifact('challenge-response', {
    ok: challengeResult.ok,
    status: challengeResult.status,
    xRequestId: challengeResult.xRequestId,
  });

  if (!challengeResult.ok) {
    return {
      ...challengeResult,
      action: 'request',
      step: 'challenge',
      phoneMasked: maskPhone(phone),
    };
  }

  const solution = await solveChallenge({
    challenge: challengeResult.body,
    deriveKey: deriveAltchaKey,
    timeout: timeoutMs,
  });

  if (!solution) {
    return {
      action: 'request',
      ok: false,
      phoneMasked: maskPhone(phone),
      step: 'solve',
      status: 0,
      body: { error: 'ALTCHA solve timed out' },
    };
  }

  const captchaToken = encodeAltchaPayload(challengeResult.body, solution);
  const result = await fetchJson(`${baseUrl}/api/auth/phone-code`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ phone, captchaToken, fingerprintVisitorId }),
  });

  return {
    ...result,
    action: 'request',
    body: redactBody(result.body),
    phoneMasked: maskPhone(phone),
    step: 'phone-code',
  };
}

async function verifyCode() {
  const result = await fetchJson(`${baseUrl}/api/auth/phone-verify`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ phone, code, staffOnly, fingerprintVisitorId }),
  });

  return {
    ...result,
    action: 'verify',
    body: redactBody(result.body),
    phoneMasked: maskPhone(phone),
    step: 'phone-verify',
  };
}

const result = action === 'verify' ? await verifyCode() : await requestCode();
const expectedNegativeMatched = Boolean(
  expectedCode
    && result.body
    && typeof result.body === 'object'
    && !Array.isArray(result.body)
    && result.body.code === expectedCode,
);
const passed = result.ok || expectedNegativeMatched;
await writeArtifact(`${result.action}-${result.step}`, result);
console.log(JSON.stringify({
  action: result.action,
  artifactDir,
  body: result.body,
  expectedCode: expectedCode || null,
  expectedNegativeMatched,
  ok: result.ok,
  passed,
  phoneMasked: result.phoneMasked,
  status: result.status,
  step: result.step,
  xRequestId: result.xRequestId,
}, null, 2));

process.exit(passed ? 0 : 1);
NODE
