# start-local.ps1
# Starts the Cloud SQL proxy, finance-api server, and agent runner in one go.
# Usage: .\start-local.ps1 -AnthropicKey "sk-..."

param(
    [Parameter(Mandatory=$true)]
    [string]$AnthropicKey
)

$project = "africanstn-research"
$instance = "africanstn-research:europe-west1:africastn-db"
$dir = $PSScriptRoot

Write-Host "Pulling secrets from GCP..." -ForegroundColor Yellow
$financeKey = gcloud secrets versions access latest --secret="finance-api-key" --project=$project
$dbPassword = gcloud secrets versions access latest --secret="db-password" --project=$project

if (-not $financeKey -or -not $dbPassword) {
    Write-Host "Failed to pull secrets. Run 'gcloud auth login --update-adc' first." -ForegroundColor Red
    exit 1
}

Write-Host "Starting Cloud SQL proxy on port 5433..." -ForegroundColor Yellow
$proxy = Start-Process -FilePath "cloud-sql-proxy" -ArgumentList "--port", "5433", $instance `
    -PassThru -NoNewWindow

Start-Sleep -Seconds 3

Write-Host "Starting finance-api server..." -ForegroundColor Yellow
$serverScript = @"
`$env:FINANCE_API_KEY = '$financeKey'
`$env:DB_PASSWORD = '$dbPassword'
`$env:DB_PORT = '5433'
Set-Location '$dir'
node server.js
"@
$server = Start-Process powershell -ArgumentList "-Command", $serverScript `
    -PassThru -NoNewWindow

Start-Sleep -Seconds 2

Write-Host "Starting agent runner..." -ForegroundColor Yellow
$runnerScript = @"
`$env:FINANCE_API_KEY = '$financeKey'
`$env:ANTHROPIC_API_KEY = '$AnthropicKey'
Set-Location '$dir'
node runner.js
"@
$runner = Start-Process powershell -ArgumentList "-Command", $runnerScript `
    -PassThru -NoNewWindow

Write-Host ""
Write-Host "All running:" -ForegroundColor Green
Write-Host "  Proxy:  PID $($proxy.Id)" -ForegroundColor Cyan
Write-Host "  Server: PID $($server.Id)" -ForegroundColor Cyan
Write-Host "  Runner: PID $($runner.Id)" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Ctrl+C or close this window to stop all." -ForegroundColor Yellow

try {
    while ($true) {
        if ($proxy.HasExited -or $server.HasExited -or $runner.HasExited) {
            Write-Host "A process has exited. Shutting down..." -ForegroundColor Red
            break
        }
        Start-Sleep -Seconds 2
    }
} finally {
    Write-Host "Stopping processes..." -ForegroundColor Yellow
    @($proxy, $server, $runner) | ForEach-Object {
        if ($_ -and -not $_.HasExited) {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
    }
    Write-Host "Done." -ForegroundColor Green
}
