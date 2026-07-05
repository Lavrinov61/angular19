#!/usr/bin/env bash
# ============================================================================
# wg-remove-peer.sh — удаление WireGuard peer'а из wg0
# ----------------------------------------------------------------------------
# Usage:  sudo ./wg-remove-peer.sh <peer_name>
# Example: sudo ./wg-remove-peer.sh rostov-laptop
#
# Что делает:
#   1. Ищет блок [Peer] с комментарием `# peer: <peer_name> ...` в wg0.conf.
#   2. Удаляет 5 строк блока (комментарий + [Peer] + PublicKey + PSK + AllowedIPs).
#   3. Сохраняет .bak копию wg0.conf.
#   4. `wg syncconf wg0 <(wg-quick strip wg0)` — hot-reload.
#
# Если несколько peer'ов с одинаковым peer_name — скрипт отказывается (ambiguity).
# ============================================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "ERROR: скрипт должен запускаться от root (sudo)." >&2
    exit 1
fi

if [[ $# -ne 1 ]]; then
    echo "Usage: $0 <peer_name>" >&2
    exit 2
fi

PEER_NAME="$1"

if [[ ! "$PEER_NAME" =~ ^[a-zA-Z0-9-]{3,32}$ ]]; then
    echo "ERROR: peer_name должен быть [a-zA-Z0-9-]{3,32}." >&2
    exit 3
fi

for cmd in wg wg-quick; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "ERROR: не найден бинарь '$cmd'." >&2
        exit 4
    fi
done

WG_CONF="/etc/wireguard/wg0.conf"
if [[ ! -f "$WG_CONF" ]]; then
    echo "ERROR: $WG_CONF не существует." >&2
    exit 5
fi

# ---- Найти номер строки комментария-маркера --------------------------------
# Ищем `# peer: <peer_name> ` (с пробелом после — исключает префикс-коллизии).
MARKER_PATTERN="^# peer: ${PEER_NAME} "
MATCHES=$(grep -n "$MARKER_PATTERN" "$WG_CONF" || true)

if [[ -z "$MATCHES" ]]; then
    echo "ERROR: peer '${PEER_NAME}' не найден в $WG_CONF." >&2
    exit 6
fi

MATCH_COUNT=$(wc -l <<< "$MATCHES")
if [[ "$MATCH_COUNT" -gt 1 ]]; then
    echo "ERROR: найдено несколько peer'ов с именем '${PEER_NAME}':" >&2
    echo "$MATCHES" >&2
    echo "Удалите вручную, чтобы избежать двусмысленности." >&2
    exit 7
fi

START_LINE=$(awk -F: '{print $1}' <<< "$MATCHES")

# Блок состоит из 5 строк: комментарий + [Peer] + PublicKey + PSK + AllowedIPs.
END_LINE=$((START_LINE + 4))

# ---- Backup + удаление -----------------------------------------------------
BACKUP="${WG_CONF}.bak-$(date +%Y%m%d-%H%M%S)"
cp -a "$WG_CONF" "$BACKUP"
echo "Backup: $BACKUP"

# sed -i '<start>,<end>d' — удаляет диапазон строк inplace.
sed -i "${START_LINE},${END_LINE}d" "$WG_CONF"

# Также убираем возможную пустую строку ПЕРЕД блоком (которую добавил add-peer).
# Это опционально — если предыдущая строка теперь пустая, удаляем её.
PREV=$((START_LINE - 1))
if [[ "$PREV" -ge 1 ]]; then
    PREV_CONTENT=$(sed -n "${PREV}p" "$WG_CONF" || true)
    if [[ -z "${PREV_CONTENT// }" ]]; then
        sed -i "${PREV}d" "$WG_CONF"
    fi
fi

# ---- Hot-reload ------------------------------------------------------------
if ! wg syncconf wg0 <(wg-quick strip wg0); then
    echo "ERROR: wg syncconf провалился. Восстановите $WG_CONF из $BACKUP." >&2
    exit 8
fi

echo "Peer '${PEER_NAME}' удалён. Строки ${START_LINE}-${END_LINE}."
echo "Backup: $BACKUP"
echo "Проверка: wg show wg0"
