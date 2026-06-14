#!/usr/bin/env pwsh
# smoke.ps1 — launch GhostPR dashboard and smoke-test it
# Run from workspace root (D:\GhostPR) or any directory; script resolves root itself.
# Usage: pwsh .claude\skills\run-ghostpr\smoke.ps1 [-Port 3000] [-WaitSeconds 30]

param(
  [int]$Port = 3000,
  [int]$WaitSeconds = 30
)

$Root = "D:\GhostPR"
$env:PATH = "$Root;C:\Program Files\nodejs;" + $env:PATH
$env:NODE_OPTIONS = "--require $Root\pnpm-preload.js"
$env:DATABASE_PATH = "$Root\data\GhostPR.db"
$env:NODE_ENV = "development"

$LogOut = "$env:TEMP\ghostpr-dash.log"
$LogErr = "$env:TEMP\ghostpr-dash-err.log"

# Kill any leftover node processes (MCP server, prior dashboard runs)
# Be surgical: only kill if we started them
Write-Host "[smoke] Starting GhostPR dashboard on port $Port ..."

$proc = Start-Process -NoNewWindow -PassThru -FilePath "cmd.exe" `
  -ArgumentList "/c","node_modules\.bin\next.CMD","dev","-p","$Port" `
  -WorkingDirectory "$Root\apps\dashboard" `
  -RedirectStandardOutput $LogOut `
  -RedirectStandardError $LogErr

$base = "http://localhost:$Port"
$deadline = (Get-Date).AddSeconds($WaitSeconds)
$ready = $false

while ((Get-Date) -lt $deadline) {
  Start-Sleep 2
  try {
    $r = Invoke-WebRequest -Uri "$base" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
}

if (-not $ready) {
  Write-Host "[smoke] ERROR: dashboard not up after ${WaitSeconds}s"
  Write-Host "--- stdout (last 20) ---"
  Get-Content $LogOut -ErrorAction SilentlyContinue | Select-Object -Last 20
  Write-Host "--- stderr (last 10) ---"
  Get-Content $LogErr -ErrorAction SilentlyContinue | Select-Object -Last 10
  Stop-Process -Id $proc.Id -ErrorAction SilentlyContinue
  exit 1
}

Write-Host "[smoke] Dashboard ready at $base"
Write-Host ""

$pass = 0; $fail = 0

function Test-Endpoint([string]$Label, [string]$Url, [int]$ExpectedStatus = 200) {
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    if ($r.StatusCode -eq $ExpectedStatus) {
      Write-Host "  PASS  $Label  ($($r.StatusCode), $($r.Content.Length)b)"
      $script:pass++
    } else {
      Write-Host "  FAIL  $Label  (got $($r.StatusCode), want $ExpectedStatus)"
      $script:fail++
    }
  } catch {
    if ($ExpectedStatus -eq 404 -and $_ -match "404") {
      Write-Host "  PASS  $Label  (404 as expected)"
      $script:pass++
    } else {
      Write-Host "  FAIL  $Label  ($_)"
      $script:fail++
    }
  }
}

Test-Endpoint "homepage"                    "$base"
Test-Endpoint "GET /api/decisions"          "$base/api/decisions"
Test-Endpoint "GET /api/decisions?status=active" "$base/api/decisions?status=active"
Test-Endpoint "GET single decision (JWT)"   "$base/api/decisions/a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5"
Test-Endpoint "GET missing decision → 404"  "$base/api/decisions/00000000-0000-0000-0000-000000000000" -ExpectedStatus 404

Write-Host ""
Write-Host "[smoke] Results: $pass passed, $fail failed"
Write-Host "[smoke] Dashboard still running at $base (PID $($proc.Id)) — stop with: Stop-Process -Id $($proc.Id)"

if ($fail -gt 0) { exit 1 }
