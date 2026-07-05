#!/usr/bin/env bash
# ============================================================================
# rollback.sh — экстренное отключение CRM IP-gate
# ----------------------------------------------------------------------------
# Usage:  sudo ./rollback.sh
#
# Что делает:
#   Заменяет содержимое /etc/nginx/snippets/crm-gate.conf на no-op
#   (`# gate disabled ...`) и делает nginx -s reload.
#
# Эффект:
#   Все location'ы, которые include'ят crm-gate.conf, перестают блокировать
#   IP — возвращается поведение ДО активации периметра.
#   Правки sites-enabled/ НЕ требуются — `include` уже на месте, просто
#   выполняет пустой snippet.
#
# Когда использовать:
#   - Администратор не может попасть в CRM из-за IP-allowlist.
#   - Ошибочно добавлен gate не в тот location.
#   - Инцидент — нужен быстрый возврат к open-state.
#
# Повторная активация:
#   git checkout ops/crm-perimeter/nginx/crm-gate.snippet.conf
#   cp ops/crm-perimeter/nginx/crm-gate.snippet.conf /etc/nginx/snippets/crm-gate.conf
#   nginx -t && nginx -s reload
# ============================================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "ERROR: скрипт должен запускаться от root (sudo)." >&2
    exit 1
fi

for cmd in nginx; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "ERROR: не найден бинарь '$cmd'." >&2
        exit 2
    fi
done

TARGET="/etc/nginx/snippets/crm-gate.conf"
BACKUP="${TARGET}.bak-$(date +%Y%m%d-%H%M%S)"

# Backup текущего snippet'а на случай повторной активации.
if [[ -f "$TARGET" ]]; then
    cp -a "$TARGET" "$BACKUP"
    echo "Backup: $BACKUP"
fi

# Atomic write через staging-файл.
STAGE="${TARGET}.new"
cat > "$STAGE" <<EOF
# ============================================================================
# crm-gate.conf — DISABLED by rollback.sh at $(date -Iseconds)
# ----------------------------------------------------------------------------
# Этот snippet намеренно пустой. include из location'ов выполняет no-op,
# IP-allowlist не применяется — CRM доступна отовсюду.
#
# Для повторной активации:
#   cp /var/www/apimain/angular-dev/ops/crm-perimeter/nginx/crm-gate.snippet.conf \\
#      /etc/nginx/snippets/crm-gate.conf
#   nginx -t && nginx -s reload
#
# Backup предыдущей версии: ${BACKUP}
# ============================================================================
EOF

mv "$STAGE" "$TARGET"

if ! nginx -t 2>&1; then
    echo "ERROR: nginx -t FAILED после rollback. Восстанавливаю backup." >&2
    if [[ -f "$BACKUP" ]]; then
        mv "$BACKUP" "$TARGET"
    fi
    exit 3
fi

if ! nginx -s reload; then
    echo "ERROR: nginx -s reload провалился." >&2
    exit 4
fi

echo "OK: CRM gate отключён. Все location'ы снова открыты."
echo "Проверка: curl -sI https://svoefoto.ru/employee/ → должно быть 200/302, не 403."
