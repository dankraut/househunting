# House Hunt — alias for deploy.ps1 (PR ship workflow; no direct push to main)
param(
    [string]$Message = '',
    [string]$Description = '',
    [string]$PrTitle = '',
    [switch]$DryRun,
    [switch]$ForceSecrets
)

Write-Host "push.ps1 uses the PR ship workflow (same as Cursor Cloud). Calling deploy.ps1..." -ForegroundColor DarkGray

& (Join-Path $PSScriptRoot 'deploy.ps1') @PSBoundParameters
exit $LASTEXITCODE
