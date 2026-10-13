param([switch]$Build)
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
if (-not (Test-Path -LiteralPath '.env')) {
    Write-Host 'Create a private .env from .env.example and set three role passwords before starting.'
    exit 1
}
if ($Build) { docker compose up -d --build } else { docker compose up -d }
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
docker compose ps
Write-Host 'Open http://localhost:8092'
