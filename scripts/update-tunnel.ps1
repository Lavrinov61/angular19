# Update SSH reverse tunnel to new Selectel server
# Run as Administrator on studio PC
# Usage: .\update-tunnel.ps1 -TunnelPort 10002
param(
    [Parameter(Mandatory=$true)]
    [int]$TunnelPort
)

$ServerIP = "svoefoto.ru"
$ServerPort = 2222
$TunnelUser = "tunnel"
$TunnelDir = "C:\SvoePhoto\tunnel"
$KeyFile = "$TunnelDir\tunnel_key"
$TaskName = "SvfReverseTunnel"

Write-Host "=== Updating SSH tunnel to $ServerIP`:$ServerPort ===" -ForegroundColor Cyan
Write-Host "Tunnel port: $TunnelPort" -ForegroundColor Cyan

# Create dir
if (!(Test-Path $TunnelDir)) { New-Item -ItemType Directory -Path $TunnelDir -Force | Out-Null }

# Write new private key
$keyContent = @"
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACBAmEs33fAnYypQlrXAdfUrfpi+O6Obghwfi2qtb3a+YQAAAJhGjstaRo7L
WgAAAAtzc2gtZWQyNTUxOQAAACBAmEs33fAnYypQlrXAdfUrfpi+O6Obghwfi2qtb3a+YQ
AAAEBxFCNckmLatqETh66k1zCTGHXclmvwfM/Yioy/HZ83SkCYSzfd8CdjKlCWtcB19St+
mL47o5uCHB+Laq1vdr5hAAAAEHR1bm5lbEBzdHVkaW8tcGMBAgMEBQ==
-----END OPENSSH PRIVATE KEY-----
"@
Set-Content -Path $KeyFile -Value $keyContent -NoNewline -Encoding ASCII
Write-Host "Key written to $KeyFile" -ForegroundColor Green

# Remove old scheduled task
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Old task removed" -ForegroundColor Yellow
}

# Build SSH command
$sshCmd = "ssh -N -R ${TunnelPort}:127.0.0.1:22 -i `"$KeyFile`" -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -p $ServerPort $TunnelUser@$ServerIP"

# Create batch wrapper for scheduled task
$batFile = "$TunnelDir\tunnel.bat"
@"
@echo off
:loop
$sshCmd >> "$TunnelDir\tunnel.log" 2>&1
echo [%date% %time%] Tunnel disconnected, reconnecting in 10s... >> "$TunnelDir\tunnel.log"
timeout /t 10 /nobreak >nul
goto loop
"@ | Set-Content -Path $batFile -Encoding ASCII

# Register scheduled task (run at startup, as SYSTEM)
$action = New-ScheduledTaskAction -Execute $batFile
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 365)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "SSH reverse tunnel to Selectel ($ServerIP`:$ServerPort -> localhost:$TunnelPort)"
Write-Host "Scheduled task created: $TaskName" -ForegroundColor Green

# Start immediately
Start-ScheduledTask -TaskName $TaskName
Write-Host ""
Write-Host "=== DONE ===" -ForegroundColor Green
Write-Host "Tunnel $TunnelPort -> $ServerIP`:$ServerPort started" -ForegroundColor Green
Write-Host "Log: $TunnelDir\tunnel.log" -ForegroundColor Gray
