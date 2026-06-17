# Reset all rate-limit counters in Cloudflare KV (for testing / unblocking)
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$NodeExe = "${env:ProgramFiles}\nodejs\node.exe"
$WranglerJs = Join-Path $PSScriptRoot "node_modules\wrangler\bin\wrangler.js"
$NsId = "4c388febb522466b8ae5cfec8893b264"

Write-Host "Listing rate-limit keys in KV..." -ForegroundColor Cyan

$env:WRANGLER_SEND_METRICS = "false"
$listJson = & $NodeExe $WranglerJs kv key list --namespace-id $NsId 2>&1 | Out-String

# Parse key names from wrangler table output (lines containing rl:)
$keys = [regex]::Matches($listJson, 'rl:[^\s"]+') | ForEach-Object { $_.Value } | Select-Object -Unique

if (-not $keys -or $keys.Count -eq 0) {
    Write-Host "No rate-limit keys found (already clear)." -ForegroundColor Green
    exit 0
}

Write-Host "Found $($keys.Count) key(s). Deleting..." -ForegroundColor Yellow

foreach ($key in $keys) {
    Write-Host "  delete: $key"
    & $NodeExe $WranglerJs kv key delete $key --namespace-id $NsId | Out-Null
}

Write-Host ""
Write-Host "Done! Rate limits cleared. You can test again now." -ForegroundColor Green
