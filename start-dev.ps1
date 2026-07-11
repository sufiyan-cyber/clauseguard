# ClauseGuard — start the full local stack.
#   powershell -ExecutionPolicy Bypass -File .\start-dev.ps1
# Starts local Qdrant only if agent/.env points at localhost (cloud needs nothing).
$root = $PSScriptRoot

$envFile = Get-Content "$root\agent\.env" -ErrorAction SilentlyContinue
$usesLocalQdrant = $envFile | Where-Object { $_ -match '^QDRANT_URL=.*localhost' }

if ($usesLocalQdrant) {
    Write-Host "QDRANT_URL is localhost -> starting local Qdrant" -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\qdrant-local'; .\qdrant.exe" -WindowStyle Minimized
    Start-Sleep -Seconds 3
} else {
    Write-Host "QDRANT_URL is a cloud cluster -> skipping local Qdrant" -ForegroundColor Green
}

Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\agent'; npm run dev"
Start-Sleep -Seconds 5
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\web'; npm run dev"

Write-Host ""
Write-Host "ClauseGuard starting:" -ForegroundColor Green
if ($usesLocalQdrant) { Write-Host "  Qdrant          http://localhost:6333/dashboard" }
Write-Host "  Agent + Studio  http://localhost:4111"
Write-Host "  Web app         http://localhost:3000"
