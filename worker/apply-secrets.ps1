# Applies secrets from secrets.local.env to Cloudflare Worker
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$NodeExe = "${env:ProgramFiles}\nodejs\node.exe"
$WranglerJs = Join-Path $PSScriptRoot "node_modules\wrangler\bin\wrangler.js"

$secretsFile = Join-Path $PSScriptRoot "secrets.local.env"
if (-not (Test-Path $secretsFile)) {
    Write-Host "ERROR: secrets.local.env not found." -ForegroundColor Red
    exit 1
}

$allowed = @(
    "HAMMER_KEYS_PAT",
    "HAMMER_HWID_PAT",
    "VALVEOFF_KEYS_PAT",
    "VALVEOFF_HWID_PAT",
    "DISCORD_WEBHOOK_URL"
)

Write-Host "Reading secrets.local.env ..." -ForegroundColor Cyan

$applied = 0
Get-Content $secretsFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -match "^\s*#" -or $line -eq "") { return }
    if ($line -notmatch "=") { return }

    $parts = $line.Split("=", 2)
    $name = $parts[0].Trim()
    $value = $parts[1].Trim()

    if ($name -notin $allowed) { return }
    if ([string]::IsNullOrWhiteSpace($value)) { return }
    if ($value -match "PASTE_") {
        Write-Host "SKIP $name (still placeholder)" -ForegroundColor Yellow
        return
    }

    Write-Host "Setting secret: $name" -ForegroundColor Green
    $env:WRANGLER_SEND_METRICS = "false"
    $value | & $NodeExe $WranglerJs secret put $name
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to set $name. Run .\wrangler.cmd login first." -ForegroundColor Red
        exit 1
    }
    $script:applied++
}

Write-Host ""
if ($applied -eq 0) {
    Write-Host "No secrets applied. Fill secrets.local.env first." -ForegroundColor Yellow
    exit 1
}

Write-Host "Done! Applied $applied secret(s)." -ForegroundColor Green
