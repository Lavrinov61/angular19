#!/usr/bin/env bash
# setup-bitrix-archive-bucket.sh
#
# Идемпотентный скрипт: создаёт и настраивает bucket MinIO для архивной копии
# фотографий с Bitrix24 Drive. Безопасно выполнять повторно.
#
# Требования:
#   - mc (MinIO Client) установлен
#   - alias local → MinIO :9000 настроен (`mc alias list | grep local`)
#
# Настройки:
#   - object-lock (Governance mode, retention 1 year) — WORM защита от удаления
#   - versioning enabled — автоматически с object-lock
#
# SSE-S3 (шифрование at-rest) НЕ включается:
#   MinIO требует настроенный KMS (KES) или статический `MINIO_KMS_SECRET_KEY`
#   в /etc/default/minio — это отдельная задача с downtime (рестарт MinIO).
#   См. follow-up: настройка MinIO KES.

set -euo pipefail

ALIAS="${MINIO_ALIAS:-local}"
BUCKET="${BITRIX_ARCHIVE_BUCKET:-svoefoto-archive-bitrix}"
RETENTION_MODE="${BITRIX_ARCHIVE_RETENTION_MODE:-GOVERNANCE}"
RETENTION_PERIOD="${BITRIX_ARCHIVE_RETENTION:-1y}"

echo "==> MinIO alias: $ALIAS"
echo "==> Bucket:       $BUCKET"
echo "==> Retention:    $RETENTION_MODE $RETENTION_PERIOD"
echo

if ! command -v mc >/dev/null; then
  echo "ERROR: mc not found in PATH" >&2
  exit 1
fi

if ! mc alias list "$ALIAS" >/dev/null 2>&1; then
  echo "ERROR: mc alias '$ALIAS' not configured" >&2
  exit 1
fi

# 1. Создать bucket с object-lock (если нет)
if mc ls "$ALIAS/$BUCKET" >/dev/null 2>&1; then
  echo "[1/3] bucket $BUCKET уже существует — пропускаю создание"
else
  echo "[1/3] создаю bucket с --with-lock"
  mc mb --with-lock "$ALIAS/$BUCKET"
fi

# 2. Установить default retention (Governance mode, 1 year)
echo "[2/3] retention $RETENTION_MODE $RETENTION_PERIOD"
mc retention set --default "$RETENTION_MODE" "$RETENTION_PERIOD" "$ALIAS/$BUCKET"

# 3. Убедиться что versioning включён
echo "[3/3] versioning"
mc version enable "$ALIAS/$BUCKET" || true

echo
echo "==> Готово. Проверка:"
mc retention info --default "$ALIAS/$BUCKET"
mc version info "$ALIAS/$BUCKET"
mc ls "$ALIAS/$BUCKET" 2>/dev/null || true
