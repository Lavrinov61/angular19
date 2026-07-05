# mcp-soborny-admin

MCP server for bounded administration of the Soborny Windows PC over the existing SSH alias `soborny-pc`.

The server intentionally does not expose an arbitrary shell tool. Every tool runs a fixed PowerShell script with validated arguments. Destructive actions require explicit confirmation strings.

## Setup

```bash
cd /var/www/apimain/angular-dev/mcp-soborny-admin
npm install
npm run build
```

## Run

```bash
npm start
```

Optional environment variables:

- `SOBORNY_SSH_HOST` defaults to `soborny-pc`
- `SOBORNY_SSH_CONNECT_TIMEOUT_SECONDS` defaults to `10`
- `SOBORNY_SSH_COMMAND_TIMEOUT_MS` defaults to `120000`

## Tools

- `pc_ping`
- `pc_summary`
- `disk_report`
- `directory_usage`
- `large_files`
- `photoshop_status`
- `process_list`
- `service_status`
- `event_log_recent`
- `cleanup_recycle_bin`
- `set_hibernation`
- `windows_component_cleanup`
- `kill_process`

Dangerous tools use these confirmation strings:

- `CLEAR_RECYCLE_BIN`
- `SET_HIBERNATION`
- `START_COMPONENT_CLEANUP`
- `KILL_PROCESS`
