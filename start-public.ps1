$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

$port = if ($env:PORT) { [int]$env:PORT } else { 3000 }
if (-not $env:TRUST_PROXY) { $env:TRUST_PROXY = '1' }
$localHealth = "http://127.0.0.1:$port/api/health"
$toolsDir = Join-Path $env:LOCALAPPDATA 'ElectionSystem'
$logDir = Join-Path $toolsDir 'logs'
$pidFile = Join-Path $toolsDir 'public-session.json'
$sessionId = [guid]::NewGuid().ToString()
New-Item -ItemType Directory -Force -Path $toolsDir, $logDir | Out-Null

function Test-AppHealth {
  try {
    $response = Invoke-RestMethod -Uri $localHealth -TimeoutSec 2
    return $response.ok -eq $true
  } catch {
    return $false
  }
}

function Show-LogTail($path) {
  if (Test-Path -LiteralPath $path) {
    Get-Content -LiteralPath $path -Tail 15 | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
  }
}

$cloudflared = $null
$installed = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
if ($installed) {
  $cloudflared = $installed.Source
} else {
  $cloudflared = Join-Path $toolsDir 'cloudflared.exe'
  if (-not (Test-Path -LiteralPath $cloudflared)) {
    Write-Host 'Downloading Cloudflare Tunnel...' -ForegroundColor Cyan
    $download = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $download -OutFile $cloudflared
    } catch {
      throw "Could not download Cloudflare Tunnel. Install it with: winget install --id Cloudflare.cloudflared -e"
    }
  }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is not installed or is not available on PATH.'
}

$serverProcess = $null
$tunnelProcess = $null

try {
  if (Test-AppHealth) {
    Write-Host 'Using the election server already running on port ' + $port + '.' -ForegroundColor Green
  } else {
    Write-Host 'Starting the election server...' -ForegroundColor Cyan
    $serverOut = Join-Path $logDir 'server.out.log'
    $serverErr = Join-Path $logDir 'server.err.log'
    Remove-Item -LiteralPath $serverOut, $serverErr -Force -ErrorAction SilentlyContinue
    $serverProcess = Start-Process -FilePath (Get-Command node).Source `
      -ArgumentList @('--no-warnings', 'server.js') `
      -WorkingDirectory $root `
      -RedirectStandardOutput $serverOut `
      -RedirectStandardError $serverErr `
      -WindowStyle Hidden `
      -PassThru

    for ($i = 0; $i -lt 40; $i++) {
      Start-Sleep -Milliseconds 500
      if ($serverProcess.HasExited) { break }
      if (Test-AppHealth) { break }
    }
    if (-not (Test-AppHealth)) {
      Show-LogTail $serverOut
      Show-LogTail $serverErr
      throw "The election server did not start. Check whether port $port is already in use."
    }
  }

  Write-Host 'Opening the public Cloudflare tunnel...' -ForegroundColor Cyan
  $tunnelOut = Join-Path $logDir 'tunnel.out.log'
  $tunnelErr = Join-Path $logDir 'tunnel.err.log'
  Remove-Item -LiteralPath $tunnelOut, $tunnelErr -Force -ErrorAction SilentlyContinue
  $tunnelProcess = Start-Process -FilePath $cloudflared `
    -ArgumentList @('tunnel', '--url', "http://127.0.0.1:$port", '--no-autoupdate') `
    -RedirectStandardOutput $tunnelOut `
    -RedirectStandardError $tunnelErr `
    -WindowStyle Hidden `
    -PassThru

  $publicUrl = $null
  $urlPattern = 'https://[a-z0-9-]+\.trycloudflare\.com'
  for ($i = 0; $i -lt 80 -and -not $publicUrl; $i++) {
    Start-Sleep -Milliseconds 500
    foreach ($log in @($tunnelOut, $tunnelErr)) {
      if (Test-Path -LiteralPath $log) {
        $content = Get-Content -LiteralPath $log -Raw -ErrorAction SilentlyContinue
        if ($content) {
          $match = [regex]::Match($content, $urlPattern)
          if ($match.Success) {
            $publicUrl = $match.Value
            break
          }
        }
      }
    }
    if ($tunnelProcess.HasExited) { break }
  }

  if (-not $publicUrl) {
    Show-LogTail $tunnelOut
    Show-LogTail $tunnelErr
    throw 'Cloudflare did not provide a public URL. Check your internet connection and try again.'
  }

  $session = [ordered]@{
    id = $sessionId
    server = if ($serverProcess) { $serverProcess.Id } else { 0 }
    tunnel = $tunnelProcess.Id
  }
  $session | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8

  try { Set-Clipboard -Value $publicUrl } catch { }
  Write-Host ''
  Write-Host 'PUBLIC LINK' -ForegroundColor Green
  Write-Host $publicUrl -ForegroundColor Yellow
  Write-Host ''
  Write-Host 'The link has been copied to your clipboard.' -ForegroundColor Green
  Write-Host 'Voters: register on the site and verify your email.'
  Write-Host 'Admin login: admin / Admin1234!'
  Write-Host ''
  Write-Host 'Cloudflare may take up to a minute to activate the link. Refresh it shortly.' -ForegroundColor DarkGray
  Write-Host 'Keep this window open. Press Ctrl+C to stop sharing.' -ForegroundColor Cyan
  Write-Host 'You can also run stop-public.cmd to stop the server and tunnel.' -ForegroundColor DarkGray
  Write-Host ''

  while (-not $tunnelProcess.HasExited) {
    Start-Sleep -Seconds 1
  }
} finally {
  if ($tunnelProcess -and -not $tunnelProcess.HasExited) {
    Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue
  }
  if ($serverProcess -and -not $serverProcess.HasExited) {
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $pidFile) {
    try {
      $saved = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
      if ($saved.id -eq $sessionId) {
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
      }
    } catch {
      Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    }
  }
}
