$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
docker compose ps
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
try { Invoke-RestMethod -Uri 'http://localhost:8092/api/health' | ConvertTo-Json -Compress }
catch { Write-Host 'Health endpoint is not available.'; exit 1 }
