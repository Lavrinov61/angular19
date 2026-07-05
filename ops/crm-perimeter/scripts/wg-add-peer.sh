#!/usr/bin/env bash
# ============================================================================
# wg-add-peer.sh — добавление WireGuard peer'а в wg0
# ----------------------------------------------------------------------------
# Usage:  sudo ./wg-add-peer.sh <peer_name> <email>
# Example: sudo ./wg-add-peer.sh rostov-laptop rostov@svoefoto.ru
#
# Что делает:
#   1. Генерирует приватный/публичный ключ + PSK.
#   2. Находит свободный IP в 10.200.0.4-254 (1=server, 2-3 зарезервированы).
#   3. Добавляет [Peer] блок в /etc/wireguard/wg0.conf с комментарием-маркером
#      `# peer: <peer_name> <email> <date>`.
#   4. `wg syncconf wg0 <(wg-quick strip wg0)` — hot-reload без разрыва.
#   5. Печатает client.conf + QR-код (qrencode -t ansiutf8).
#
# Требования:
#   - Запуск от root (sudo)
#   - wireguard-tools (wg, wg-quick)
#   - qrencode
#
# Безопасность:
#   - Client.conf печатается в stdout ОДИН РАЗ — сохрани сразу.
#   - Приватный ключ сервера НЕ трогаем.
# ============================================================================
set -euo pipefail

# ---- Preconditions ---------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
    echo "ERROR: скрипт должен запускаться от root (sudo)." >&2
    exit 1
fi

if [[ $# -ne 2 ]]; then
    echo "Usage: $0 <peer_name> <email>" >&2
    echo "Example: $0 rostov-laptop rostov@svoefoto.ru" >&2
    exit 2
fi

PEER_NAME="$1"
PEER_EMAIL="$2"

# Валидация peer_name (буквы/цифры/дефис, 3-32 символа)
if [[ ! "$PEER_NAME" =~ ^[a-zA-Z0-9-]{3,32}$ ]]; then
    echo "ERROR: peer_name должен быть [a-zA-Z0-9-]{3,32}." >&2
    exit 3
fi

for cmd in wg wg-quick qrencode ip; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "ERROR: не найден бинарь '$cmd'. Установите: apt install wireguard-tools qrencode" >&2
        exit 4
    fi
done

WG_CONF="/etc/wireguard/wg0.conf"
if [[ ! -f "$WG_CONF" ]]; then
    echo "ERROR: $WG_CONF не существует. Сначала настройте WireGuard-сервер." >&2
    exit 5
fi

# ---- Конфигурация сервера --------------------------------------------------
# Публичный ключ сервера берём из wg0.conf (или wg show).
SERVER_PUBKEY=$(wg show wg0 public-key)
if [[ -z "$SERVER_PUBKEY" ]]; then
    echo "ERROR: не удалось получить публичный ключ wg0. Сервер запущен?" >&2
    exit 6
fi

# Endpoint (внешний IP + порт сервера) — берём из переменной окружения
# или fallback на известный свой IP.
SERVER_ENDPOINT="${WG_SERVER_ENDPOINT:-84.38.189.58:51820}"
SERVER_NETWORK="10.200.0.0/24"
DNS="${WG_DNS:-1.1.1.1,8.8.8.8}"

# ---- Найти свободный IP в 10.200.0.4-254 -----------------------------------
# Забираем список уже занятых IP из [Peer]-блоков wg0.conf.
USED_IPS=$(grep -E "^AllowedIPs\s*=" "$WG_CONF" | awk -F'=' '{print $2}' | tr ',' '\n' | grep -oE '10\.200\.0\.[0-9]+' || true)

NEXT_IP=""
for i in $(seq 4 254); do
    CAND="10.200.0.$i"
    if ! grep -qxF "$CAND" <<< "$USED_IPS"; then
        NEXT_IP="$CAND"
        break
    fi
done

if [[ -z "$NEXT_IP" ]]; then
    echo "ERROR: нет свободных IP в 10.200.0.4-254 (всего 251 слот занят)." >&2
    exit 7
fi

# ---- Генерация ключей ------------------------------------------------------
PRIV=$(wg genkey)
PUB=$(wg pubkey <<< "$PRIV")
PSK=$(wg genpsk)

DATE=$(date -Iseconds)

# ---- Добавить [Peer] в /etc/wireguard/wg0.conf -----------------------------
# Комментарий-маркер нужен для wg-remove-peer.sh (поиск блока).
cat >> "$WG_CONF" <<EOF

# peer: ${PEER_NAME} ${PEER_EMAIL} ${DATE}
[Peer]
PublicKey = ${PUB}
PresharedKey = ${PSK}
AllowedIPs = ${NEXT_IP}/32
EOF

# ---- Hot-reload через syncconf (без разрыва существующих пиров) ------------
# wg-quick strip — убирает PostUp/PostDown/Address и отдаёт чистый wg-формат.
if ! wg syncconf wg0 <(wg-quick strip wg0); then
    echo "ERROR: wg syncconf wg0 провалился. Проверьте $WG_CONF вручную." >&2
    exit 8
fi

# ---- Сгенерировать клиентский конфиг ---------------------------------------
# AllowedIPs = 10.200.0.0/24 → туннелируем только CRM-трафик (split-tunnel),
# остальной интернет идёт напрямую с клиента.
CLIENT_CONF=$(cat <<EOF
# WireGuard client config — ${PEER_NAME} (${PEER_EMAIL})
# Добавлено: ${DATE}
# Сервер: ${SERVER_ENDPOINT}

[Interface]
PrivateKey = ${PRIV}
Address = ${NEXT_IP}/24
DNS = ${DNS}

[Peer]
PublicKey = ${SERVER_PUBKEY}
PresharedKey = ${PSK}
Endpoint = ${SERVER_ENDPOINT}
AllowedIPs = ${SERVER_NETWORK}
PersistentKeepalive = 25
EOF
)

# ---- Вывод -----------------------------------------------------------------
echo "============================================================"
echo "WireGuard peer добавлен: ${PEER_NAME} → ${NEXT_IP}"
echo "============================================================"
echo ""
echo "Client config (СОХРАНИ — выводится один раз):"
echo "------------------------------------------------------------"
echo "${CLIENT_CONF}"
echo "------------------------------------------------------------"
echo ""
echo "QR-код (сканировать в мобильном приложении WireGuard):"
echo ""
echo "${CLIENT_CONF}" | qrencode -t ansiutf8
echo ""
echo "Проверка: wg show wg0 | grep -A3 ${PUB}"
