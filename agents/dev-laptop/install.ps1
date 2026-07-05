# SvoePhoto Agents — Установка на Dev Laptop (Windows 11)
# Запустить от имени администратора: Right-click → Run as Administrator

$ErrorActionPreference = "Stop"
$BaseDir = "C:\ProgramData\SvoePhoto"

Write-Host "=== SvoePhoto Agents Installer ===" -ForegroundColor Cyan

# 1. Создать директории
$agents = @("print-agent", "pos-agent", "monitor-agent", "guard-agent")
foreach ($agent in $agents) {
    $dir = "$BaseDir\$agent"
    if (!(Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        New-Item -ItemType Directory -Path "$dir\temp" -Force | Out-Null
        Write-Host "  Created: $dir" -ForegroundColor Green
    }
}
New-Item -ItemType Directory -Path "$BaseDir\print-agent\icc" -Force | Out-Null

# 2. Скопировать конфиги
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Copy-Item "$scriptDir\print-agent.toml"   "$BaseDir\print-agent\config.toml"   -Force
Copy-Item "$scriptDir\pos-agent.toml"     "$BaseDir\pos-agent\config.toml"     -Force
Copy-Item "$scriptDir\monitor-agent.toml" "$BaseDir\monitor-agent\config.toml" -Force
Copy-Item "$scriptDir\guard-agent.toml"   "$BaseDir\guard-agent\config.toml"   -Force
Write-Host "  Configs copied" -ForegroundColor Green

# 3. Скопировать exe (если есть рядом)
$exeNames = @{
    "print-agent"   = "svf-print-agent.exe"
    "pos-agent"     = "svf-pos-agent.exe"
    "monitor-agent" = "svf-monitor-agent.exe"
    "guard-agent"   = "svf-guard-agent.exe"
}
foreach ($agent in $exeNames.Keys) {
    $exe = "$scriptDir\$($exeNames[$agent])"
    if (Test-Path $exe) {
        Copy-Item $exe "$BaseDir\$agent\$($exeNames[$agent])" -Force
        Write-Host "  Copied: $($exeNames[$agent])" -ForegroundColor Green
    } else {
        Write-Host "  SKIP: $($exeNames[$agent]) not found (build with: cargo build --release)" -ForegroundColor Yellow
    }
}

# 4. Добавить в PATH (опционально)
# $env:Path += ";$BaseDir\print-agent"

Write-Host ""
Write-Host "=== Установка завершена ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Для запуска агентов:" -ForegroundColor White
Write-Host "  cd $BaseDir\print-agent && .\svf-print-agent.exe" -ForegroundColor Gray
Write-Host "  cd $BaseDir\pos-agent && .\svf-pos-agent.exe" -ForegroundColor Gray
Write-Host "  cd $BaseDir\monitor-agent && .\svf-monitor-agent.exe" -ForegroundColor Gray
Write-Host "  cd $BaseDir\guard-agent && .\svf-guard-agent.exe" -ForegroundColor Gray
Write-Host ""
Write-Host "Для сборки (на сервере или cross-compile):" -ForegroundColor White
Write-Host "  cargo build --release --target x86_64-pc-windows-msvc" -ForegroundColor Gray
