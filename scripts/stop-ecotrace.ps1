$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
docker compose stop app
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host 'EcoTrace stopped. The data volume is preserved.'
