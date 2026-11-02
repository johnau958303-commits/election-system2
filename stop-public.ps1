$ErrorActionPreference = 'Stop'
$toolsDir = Join-Path $env:LOCALAPPDATA 'ElectionSystem'
$pidFile = Join-Path $toolsDir 'public-session.json'

if (-not (Test-Path -LiteralPath $pidFile)) {
  Write-Host 'No public sharing session is recorded.' -ForegroundColor Yellow
  exit 0
}

try {
  $session = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
} catch {
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host 'The saved sharing session was invalid and has been cleared.' -ForegroundColor Yellow
  exit 0
}

foreach ($entry in @(
  @{ Id = [int]$session.tunnel; Name = 'cloudflared' },
  @{ Id = [int]$session.server; Name = 'node' }
)) {
  if ($entry.Id -le 0) { continue }
  $process = Get-Process -Id $entry.Id -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -eq $entry.Name) {
    Stop-Process -Id $entry.Id -Force -ErrorAction Stop
    Write-Host "Stopped $($entry.Name) process $($entry.Id)." -ForegroundColor Green
  }
}

Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
Write-Host 'Public sharing has stopped.' -ForegroundColor Green
