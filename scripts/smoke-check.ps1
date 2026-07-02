# House Hunt pre-deploy smoke check (PowerShell)
param([string]$RepoRoot = '')

$ErrorActionPreference = 'Stop'
if (-not $RepoRoot) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

$markersPath = Join-Path $RepoRoot 'scripts\smoke-markers.txt'
if (-not (Test-Path -LiteralPath $markersPath)) {
    Write-Host "ERROR: missing $markersPath" -ForegroundColor Red
    exit 1
}

Write-Host "House Hunt smoke check (repo: $RepoRoot)"
$fail = $false

Get-Content -LiteralPath $markersPath | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $parts = $line -split '\|', 3
    if ($parts.Count -lt 2) { return }
    $file = $parts[0]
    $pattern = $parts[1]
    $desc = if ($parts.Count -ge 3) { $parts[2] } else { $pattern }
    $path = Join-Path $RepoRoot ($file -replace '/', [IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $path)) {
        Write-Host "FAIL: missing file $file ($desc)" -ForegroundColor Red
        $fail = $true
        return
    }
    $content = Get-Content -LiteralPath $path -Raw
    if ($content -notmatch [regex]::Escape($pattern)) {
        Write-Host "FAIL: $file missing pattern [$pattern] — $desc" -ForegroundColor Red
        $fail = $true
    }
}

$configPath = Join-Path $RepoRoot 'js\config.js'
$config = Get-Content -LiteralPath $configPath -Raw
if ($config -match "SPA_VERSION = '([^']+)'") {
    $spaVer = $Matches[1]
    $index = Get-Content -LiteralPath (Join-Path $RepoRoot 'index.html') -Raw
    $manifest = Get-Content -LiteralPath (Join-Path $RepoRoot 'extension\manifest.json') -Raw
    if ($index -notmatch [regex]::Escape("SPA $spaVer")) {
        Write-Host "FAIL: index.html header comment does not reference SPA $spaVer" -ForegroundColor Red
        $fail = $true
    }
    if ($manifest -notmatch [regex]::Escape($spaVer)) {
        Write-Host "FAIL: extension/manifest.json does not reference SPA $spaVer" -ForegroundColor Red
        $fail = $true
    }
} else {
    Write-Host 'FAIL: could not read SPA_VERSION from js/config.js' -ForegroundColor Red
    $fail = $true
}

if ((Get-Content -LiteralPath (Join-Path $RepoRoot 'index.html') -Raw) -notmatch 'syncGeoLayouts\(\)') {
    Write-Host 'FAIL: syncGeoLayouts() not found in index.html' -ForegroundColor Red
    $fail = $true
}

if ($fail) {
    Write-Host ''
    Write-Host 'Smoke check FAILED — fix regressions before deploy.' -ForegroundColor Red
    exit 1
}

Write-Host "Smoke check passed ($spaVer)." -ForegroundColor Green
exit 0
