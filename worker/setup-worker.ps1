# ActivateMe Worker - automated setup
# Run: .\setup-worker.cmd
param(
    [switch]$SkipLogin,
    [switch]$Deploy
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$NodeExe = "${env:ProgramFiles}\nodejs\node.exe"
$WranglerJs = Join-Path $PSScriptRoot "node_modules\wrangler\bin\wrangler.js"
$WorkDir = $PSScriptRoot

function Refresh-Path {
    $nodeDir = "${env:ProgramFiles}\nodejs"
    if (Test-Path $nodeDir) {
        $env:Path = "$nodeDir;" + $env:Path
    }
}

function Invoke-Wrangler {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Args,
        [int]$TimeoutSec = 90
    )

    if (-not (Test-Path $NodeExe)) { throw "Node.js not found at $NodeExe" }
    if (-not (Test-Path $WranglerJs)) { throw "Wrangler not found. Run: npm install" }

    $env:WRANGLER_SEND_METRICS = "false"

    $job = Start-Job -ScriptBlock {
        param($Node, $Wrangler, $WranglerArgs, $Dir)
        $env:WRANGLER_SEND_METRICS = "false"
        Set-Location -LiteralPath $Dir
        & $Node $Wrangler @WranglerArgs 2>&1 | Out-String
    } -ArgumentList $NodeExe, $WranglerJs, $Args, $WorkDir

    $done = Wait-Job $job -Timeout $TimeoutSec
    if (-not $done) {
        Stop-Job $job -ErrorAction SilentlyContinue
        Remove-Job $job -Force -ErrorAction SilentlyContinue
        return "TIMEOUT after ${TimeoutSec}s"
    }

    $result = Receive-Job $job
    Remove-Job $job -Force
    return $result
}

function Invoke-WranglerInteractive {
    param([Parameter(Mandatory = $true)][string[]]$Args)

    $env:WRANGLER_SEND_METRICS = "false"
    Set-Location -LiteralPath $WorkDir
    & $NodeExe $WranglerJs @Args
    return $LASTEXITCODE
}

Refresh-Path

Write-Host ""
Write-Host "=== ActivateMe Worker Setup ===" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path "node_modules\wrangler\bin\wrangler.js")) {
    Write-Host "[1/5] Installing npm packages..." -ForegroundColor Yellow
    & "${env:ProgramFiles}\nodejs\npm.cmd" install
    if ($LASTEXITCODE -ne 0) { exit 1 }
} else {
    Write-Host "[1/5] npm packages already installed." -ForegroundColor Green
}

Write-Host "[2/5] Checking Cloudflare login (max 90s)..." -ForegroundColor Yellow
$whoami = Invoke-Wrangler -Args @("whoami")

if ($whoami -eq "TIMEOUT after 90s") {
    Write-Host "Wrangler timed out. Run: .\wrangler.cmd whoami" -ForegroundColor Red
    exit 1
}

if ($whoami -match "not authenticated" -and -not $SkipLogin) {
    Write-Host "Not logged in. Opening Cloudflare login..." -ForegroundColor Cyan
    $code = Invoke-WranglerInteractive -Args @("login")
    if ($code -ne 0) { exit 1 }

    $whoami = Invoke-Wrangler -Args @("whoami")
    if ($whoami -match "not authenticated") {
        Write-Host "Login did not complete. Run: .\wrangler.cmd login" -ForegroundColor Red
        exit 1
    }
    Write-Host "Cloudflare login OK." -ForegroundColor Green
} elseif ($whoami -match "not authenticated") {
    Write-Host "Not logged in. Run: .\wrangler.cmd login" -ForegroundColor Red
    exit 1
} else {
    Write-Host "Already logged in to Cloudflare." -ForegroundColor Green
}

Write-Host "[3/5] Setting up KV namespace..." -ForegroundColor Yellow
$wranglerToml = Get-Content "wrangler.toml" -Raw
if ($wranglerToml -match "REPLACE_WITH_YOUR_KV_NAMESPACE_ID") {
    $kvOutput = Invoke-Wrangler -Args @("kv", "namespace", "create", "ACTIVATE_RATE_LIMIT") -TimeoutSec 120
    Write-Host $kvOutput

    $idMarker = 'id = "'
    $idStart = $kvOutput.IndexOf($idMarker)
    if ($idStart -ge 0) {
        $valueStart = $idStart + $idMarker.Length
        $valueEnd = $kvOutput.IndexOf('"', $valueStart)
        $kvId = $kvOutput.Substring($valueStart, $valueEnd - $valueStart)
        $wranglerToml = $wranglerToml -replace "REPLACE_WITH_YOUR_KV_NAMESPACE_ID", $kvId
        Set-Content "wrangler.toml" $wranglerToml -NoNewline
        Write-Host "KV namespace ID saved: $kvId" -ForegroundColor Green
    } else {
        Write-Host "Could not parse KV ID. Run: .\wrangler.cmd kv namespace create ACTIVATE_RATE_LIMIT" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "KV namespace already configured." -ForegroundColor Green
}

Write-Host "[4/5] Checking secrets file..." -ForegroundColor Yellow
$secretsFile = Join-Path $PSScriptRoot "secrets.local.env"
if (-not (Test-Path $secretsFile)) {
    Copy-Item "secrets.local.env.example" $secretsFile
    Write-Host "Created secrets.local.env - paste PAT tokens there." -ForegroundColor Yellow
    Start-Process notepad $secretsFile
    exit 0
}

$hasRealSecrets = $false
Get-Content $secretsFile | ForEach-Object {
    if ($_ -match "^(HAMMER_|VALVEOFF_|DISCORD_)" -and $_ -notmatch "PASTE_") {
        $hasRealSecrets = $true
    }
}

if (-not $hasRealSecrets) {
    Write-Host "secrets.local.env still has placeholders." -ForegroundColor Yellow
    Write-Host "Paste PAT tokens, save, then run: .\setup-worker.cmd -Deploy" -ForegroundColor Cyan
    Start-Process notepad $secretsFile
    exit 0
}

Write-Host "Applying secrets to Cloudflare..." -ForegroundColor Yellow
& "$PSScriptRoot\apply-secrets.ps1"
if ($LASTEXITCODE -ne 0) { exit 1 }

if ($Deploy) {
    Write-Host "[5/5] Deploying Worker..." -ForegroundColor Yellow
    $code = Invoke-WranglerInteractive -Args @("deploy")
    if ($code -ne 0) { exit 1 }

    Write-Host ""
    Write-Host "=== DEPLOYED ===" -ForegroundColor Green
    Write-Host "Copy the workers.dev URL above."
    Write-Host "Test: https://YOUR-WORKER-URL/api/v1/health"
} else {
    Write-Host "[5/5] Done. To deploy run: .\setup-worker.cmd -Deploy" -ForegroundColor Green
}
