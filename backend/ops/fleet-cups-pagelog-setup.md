# Fleet Management — CUPS PageLog Setup

One-time server enablement so that `backend/src/services/fleet/cups-page-log-parser.service.ts` has a `/var/log/cups/page_log` to tail.

Applies to any CUPS host that prints via Linux queues (Соборный — Canon-C3226i + 2× Epson L8050; Баррикадная — Canon-MF655CDw + Epson L8050). The SC-F100 on Windows does NOT go through CUPS and is intentionally out of scope here (it comes into `print_jobs` via the existing Rust print-api / MQTT path).

## What the parser expects

A PageLog file at `/var/log/cups/page_log` written in the custom format below, one line per page-event emitted by CUPS (not one per job — one per page). Each line matches this regex:

```
/^(\S+)\s+(\S+)\s+(\d+)\s+\[([^\]]+)\]\s+(\d+)\s+(\d+)\s+(\d+|-)\s+(\d+|-)\s+(?:"([^"]*)"|\S+)\s+(\S+)\s+(\S+)\s*$/
```

Group order: `printer_name username job_id [timestamp] page_num copies impressions-completed media-sheets-completed "job-name" media sides`.

## Directives to add to `/etc/cups/cupsd.conf`

```
PageLog /var/log/cups/page_log
PageLogFormat "%p %u %j %T %P %C %{job-impressions-completed} %{job-media-sheets-completed} %{job-name} %{media} %{sides}"
```

Notes:
- A fresh Ubuntu CUPS ships with `PageLogFormat` set to *empty* (no value) — that disables page logging entirely. Our directive replaces it with the custom format above.
- `PageLog /var/log/cups/page_log` is also declared in `cups-files.conf` by default (line 63 on Ubuntu 24.04). The directive in `cupsd.conf` is harmless but makes the Fleet dependency explicit.

## Apply (idempotent)

```bash
sudo cp /etc/cups/cupsd.conf /etc/cups/cupsd.conf.bak.fleet.$(date +%Y%m%d%H%M%S)

# Strip any existing PageLog/PageLogFormat lines, then append our canonical pair
sudo awk 'BEGIN{p=1}
  /^[[:space:]]*PageLog([[:space:]]|$)/{next}
  /^[[:space:]]*PageLogFormat([[:space:]]|$)/{next}
  {print}' /etc/cups/cupsd.conf > /tmp/cupsd.conf.fleet

sudo bash -c 'cat >> /tmp/cupsd.conf.fleet <<EOF

# Fleet Management: CUPS PageLog (see backend/ops/fleet-cups-pagelog-setup.md)
PageLog /var/log/cups/page_log
PageLogFormat "%p %u %j %T %P %C %{job-impressions-completed} %{job-media-sheets-completed} %{job-name} %{media} %{sides}"
EOF'

sudo install -o root -g lp -m 0640 /tmp/cupsd.conf.fleet /etc/cups/cupsd.conf
sudo rm /tmp/cupsd.conf.fleet
```

Reload / restart CUPS — `systemctl reload` is not supported by the cups.service unit on Ubuntu 24.04, use `restart`:

```bash
sudo systemctl restart cups
sudo systemctl is-active cups   # → active
```

## File / permission grants

The backend PM2 process runs as user `rostv`. The PageLog file is created by CUPS as `root:adm 640` (group defined by `LogFileGroup adm` in `/etc/cups/cups-files.conf`). Grant the backend user read access by adding it to `adm`:

```bash
sudo usermod -a -G adm rostv
# For redundancy with CUPS setups where LogFileGroup is `lp`:
sudo usermod -a -G lp rostv

# PM2 must be restarted for the new supplementary group to take effect inside node
pm2 restart magnus-photo-api --update-env
```

If the file does not exist yet (no page has been printed since the config was applied), create an empty placeholder so the parser's `fs.watchFile` has something to attach to:

```bash
sudo touch /var/log/cups/page_log
sudo chown root:adm /var/log/cups/page_log
sudo chmod 640 /var/log/cups/page_log
```

## Verify

```bash
# 1. The directives are present
sudo grep -E '^(PageLog|PageLogFormat)' /etc/cups/cupsd.conf

# 2. CUPS is running
systemctl is-active cups

# 3. Trigger a test print — actual page_log entry only appears once the job
#    finishes printing (CUPS writes one line per completed page, not per submit).
echo "fleet pagelog test $(date -Is)" > /tmp/test.txt
lp -d Canon-C3226i-Soborny /tmp/test.txt

# 4. Once the printer is done, verify the line was appended
sudo tail -n 5 /var/log/cups/page_log
```

Expected line shape (example):

```
Canon-C3226i-Soborny rostv 12 [21/Apr/2026:21:22:59 +0300] 1 1 1 1 "test.txt" A4 one-sided
```

## Log rotation

Ubuntu's default `/etc/logrotate.d/cups-daemon` already covers `page_log`. No additional rotation config needed. The parser persists its byte offset in Redis (`fleet:cups:pagelog:offset`) and detects truncation: if the stat size goes below the previously recorded offset, the offset is reset to 0 so the rotated file is re-tailed from the beginning.

## Applied on svoefoto.ru prod (2026-04-21)

- Backup: `/etc/cups/cupsd.conf.bak.fleet.20260421212*`
- Directives appended at lines 138-139 of `cupsd.conf`.
- `sudo systemctl restart cups` — active after restart.
- `rostv` added to groups `adm`, `lp`.
- `/var/log/cups/page_log` created (`root:adm 640`).
- Test print `lp -d Canon-C3226i-Soborny` accepted (job 12) — real line will appear after the remote printer finishes the job (the queue had a backlog of old jobs that never finished — unrelated to this change).
