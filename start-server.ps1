#Requires -Version 5.1
<#
.SYNOPSIS
    Starts the local travel/games web server and opens it in the browser.

.DESCRIPTION
    Runs server.js with Node.js. If the requested port is busy, the next free
    port is used automatically. Press Ctrl+C to stop the server.

.PARAMETER Port
    Preferred port (default 3000).

.PARAMETER Root
    Folder to serve (default: the folder containing this script).

.PARAMETER NoBrowser
    Do not open the default browser.

.PARAMETER LocalOnly
    Listen on 127.0.0.1 only (no access from phones on the same Wi-Fi).

.EXAMPLE
    .\start-server.ps1

.EXAMPLE
    .\start-server.ps1 -Port 8080 -NoBrowser

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\start-server.ps1
#>
[CmdletBinding()]
param(
    [int]$Port = 3000,
    [string]$Root = '',
    [switch]$NoBrowser,
    [switch]$LocalOnly
)

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'Travel Server'

# Make Thai output from Node render correctly in older consoles.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
try { $null = chcp 65001 } catch { }

function Stop-WithMessage {
    param([string]$Message)
    Write-Host ''
    Write-Host "  $Message" -ForegroundColor Red
    Write-Host ''
    if ($Host.Name -eq 'ConsoleHost') {
        Read-Host 'Press Enter to close'
    }
    exit 1
}

# ---------------------------------------------------------------- prerequisites

$scriptPath = $PSScriptRoot
if (-not $scriptPath) { $scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $Root) { $Root = $scriptPath }
if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    Stop-WithMessage "Root folder not found: $Root"
}
$Root = (Resolve-Path -LiteralPath $Root).Path

$serverFile = Join-Path $scriptPath 'server.js'
if (-not (Test-Path -LiteralPath $serverFile -PathType Leaf)) {
    Stop-WithMessage "server.js not found next to this script: $serverFile"
}

$node = (Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $node) {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'),
        (Join-Path $env:ProgramFiles 'nodejs\node.exe')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }

    if ($candidates) {
        $node = @($candidates)[0]
    } else {
        Stop-WithMessage @'
Node.js is not installed (or not in PATH).
Download the LTS version from https://nodejs.org/ then run this script again.
'@
    }
}

# ---------------------------------------------------------------- port selection

function Test-PortFree {
    param([int]$Candidate)
    $listener = $null
    try {
        $address = if ($LocalOnly) { [System.Net.IPAddress]::Loopback } else { [System.Net.IPAddress]::Any }
        $listener = New-Object System.Net.Sockets.TcpListener($address, $Candidate)
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($listener) {
            try { $listener.Stop() } catch { }
        }
    }
}

$preferred = $Port
$port = $Port
$limit = $Port + 20
while (-not (Test-PortFree -Candidate $port)) {
    if ($port -ge $limit) {
        Stop-WithMessage "No free port found in range $preferred-$limit. Close the other server or pass -Port."
    }
    $port++
}
if ($port -ne $preferred) {
    Write-Host "  Port $preferred is busy; using $port instead." -ForegroundColor Yellow
}

# ---------------------------------------------------------------- run

$nodeArgs = @(
    $serverFile,
    '--port', "$port",
    '--root', $Root,
    '--host', $(if ($LocalOnly) { '127.0.0.1' } else { '0.0.0.0' })
)
if (-not $NoBrowser) { $nodeArgs += '--open' }

$nodeVersion = & $node --version
Write-Host ''
Write-Host '  Travel server starting...' -ForegroundColor Cyan
Write-Host "  Node $nodeVersion  |  serving $Root" -ForegroundColor DarkGray
Write-Host ''

try {
    & $node @nodeArgs
    $exitCode = $LASTEXITCODE
} finally {
    Write-Host '  Server stopped.' -ForegroundColor DarkGray
}

exit $exitCode
