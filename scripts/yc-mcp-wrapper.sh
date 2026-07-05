#!/bin/bash
# Wrapper for Yandex Cloud Toolkit MCP server
# Generates fresh IAM token on each startup (12h lifespan)

# Explicit paths — bash may run non-interactive (no .bashrc)
YC=/home/rostv/yandex-cloud/bin/yc
export PATH="/home/rostv/yandex-cloud/bin:$HOME/.local/share/nvm/versions/node/v22.22.0/bin:$PATH"

TOKEN=$($YC iam create-token 2>/dev/null)
CLOUD_ID=$($YC config get cloud-id 2>/dev/null)
FOLDER_ID=$($YC config get folder-id 2>/dev/null)

if [ -z "$TOKEN" ] || [ -z "$FOLDER_ID" ] || [ -z "$CLOUD_ID" ]; then
  echo "ERROR: Failed to get YC IAM token, cloud-id or folder-id. Run 'yc init' first." >&2
  exit 1
fi

exec npx -y mcp-remote \
  "https://toolkit.mcp.cloud.yandex.net/mcp" \
  --header "Authorization:Bearer $TOKEN" \
  --header "Cloud-Id:$CLOUD_ID" \
  --header "Folder-Id:$FOLDER_ID"
