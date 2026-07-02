# House Hunt — main-only deploy: commit (if needed) → push origin/main
# Cloudflare Pages auto-deploys when main updates on GitHub.
param(
    [string]$Message = '',
    [switch]$DryRun,
    [switch]$ForceSecrets
)

$ErrorActionPreference = 'Stop'
$MainBranch = 'main'
$script:SubstMapped = $false
$script:SubstDrive = $null

function Write-Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host $Text -ForegroundColor Green }
function Write-Err([string]$Text) { Write-Host "ERROR: $Text" -ForegroundColor Red }

function Invoke-GitRead {
    param([Parameter(Mandatory = $true, Position = 0)][string[]]$GitArgs)
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & git @GitArgs 2>&1
        $exitCode = $LASTEXITCODE
        $text = if ($out) {
            ($out | ForEach-Object {
                if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { "$_" }
            }) -join "`n"
        } else { '' }
        return @{ Ok = ($exitCode -eq 0); Output = $text.Trim() }
    } finally {
        $ErrorActionPreference = $prevEap
    }
}

function Invoke-Git {
    param([Parameter(Mandatory = $true, Position = 0)][string[]]$GitArgs)
    $line = 'git ' + ($GitArgs -join ' ')
    if ($DryRun) { Write-Host "[dry-run] $line" -ForegroundColor DarkGray; return '' }
    Write-Host "    $line" -ForegroundColor DarkGray
    $result = Invoke-GitRead -GitArgs $GitArgs
    if (-not $result.Ok) {
        if ($result.Output) { Write-Host $result.Output }
        throw "Command failed: $line"
    }
    return $result.Output
}

function Test-SensitivePaths {
    param([string[]]$Paths)
    $regex = '(\.env$|\.env\.|credentials\.json$|secrets?\.(json|ya?ml|toml)$|\.pem$|\.key$|id_rsa$)'
    return @($Paths | Where-Object { $_ -and ($_ -match $regex) })
}

function Get-DefaultCommitMessage {
    param([string]$Root)
    foreach ($rel in @('js\config.js', 'index.html')) {
        $path = Join-Path $Root $rel
        if (-not (Test-Path -LiteralPath $path)) { continue }
        $content = Get-Content -LiteralPath $path -Raw -ErrorAction SilentlyContinue
        if ($content -match "SPA_VERSION\s*=\s*'([^']+)'") { return "Deploy $($Matches[1])" }
    }
    return "Deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
}

function Initialize-SubstDrive {
    param([string]$Path)
    if ($Path -notmatch "'") { return $Path }
    $used = @(Get-PSDrive -PSProvider FileSystem).Name
    foreach ($letter in @('Z', 'Y', 'X', 'W', 'V', 'U', 'T', 'S')) {
        if ($letter -in $used) { continue }
        $drive = "${letter}:"
        $null = & subst $drive $Path 2>&1
        if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $drive)) {
            $script:SubstMapped = $true
            $script:SubstDrive = $drive
            Write-Host "    subst $drive -> $Path" -ForegroundColor DarkGray
            return $drive
        }
    }
    Write-Host "WARNING: Could not map subst drive; continuing with literal path." -ForegroundColor Yellow
    return $Path
}

function Remove-SubstDrive {
    if (-not $script:SubstMapped -or -not $script:SubstDrive) { return }
    $null = & subst $script:SubstDrive /d 2>&1
    $script:SubstMapped = $false
    $script:SubstDrive = $null
}

$repoRoot = $null
if ($PSScriptRoot) {
    Push-Location -LiteralPath $PSScriptRoot
    try {
        $rootResult = Invoke-GitRead @('rev-parse', '--show-toplevel')
        if (-not $rootResult.Ok) { throw 'not a git repo' }
        $repoRoot = $rootResult.Output.Trim()
    } catch {
        Pop-Location
        Write-Err 'Could not find git repository. Run from the househunting clone.'
        exit 1
    }
    Pop-Location
}

if (-not $repoRoot) { Write-Err 'Could not determine repository root.'; exit 1 }

$exitCode = 0
try {
    $workRoot = Initialize-SubstDrive -Path $repoRoot
    Set-Location -LiteralPath $workRoot
    Write-Step "Repository: $repoRoot"
    Write-Host "    origin: $((Invoke-GitRead @('remote', 'get-url', 'origin')).Output)"

    $branch = (Invoke-GitRead @('branch', '--show-current')).Output.Trim()
    if (-not $branch) { throw 'Detached HEAD — checkout main before deploying.' }
    if ($branch -ne $MainBranch) {
        Write-Host "    switching: $branch -> $MainBranch" -ForegroundColor DarkGray
        Invoke-Git @('checkout', $MainBranch) | Out-Null
    }

    Write-Step 'Smoke check'
    $smokePs1 = Join-Path $PSScriptRoot 'smoke-check.ps1'
    if (Test-Path -LiteralPath $smokePs1) {
        & $smokePs1 -RepoRoot $repoRoot
        if ($LASTEXITCODE -ne 0) { throw 'Smoke check failed — fix regressions before deploy.' }
    } else {
        $smokeSh = Join-Path $PSScriptRoot 'smoke-check.sh'
        if (Test-Path -LiteralPath $smokeSh) {
            & bash $smokeSh
            if ($LASTEXITCODE -ne 0) { throw 'Smoke check failed — fix regressions before deploy.' }
        } else {
            Write-Host 'WARNING: smoke-check script not found; skipping.' -ForegroundColor Yellow
        }
    }

    $porcelain = (Invoke-GitRead @('status', '--porcelain')).Output
    if ($porcelain -and $porcelain.Trim()) {
        Write-Step 'Staging changes'
        $allChanged = @(
            $(if ((Invoke-GitRead @('diff', '--name-only')).Output) { ((Invoke-GitRead @('diff', '--name-only')).Output) -split "`n" }),
            $(if ((Invoke-GitRead @('diff', '--cached', '--name-only')).Output) { ((Invoke-GitRead @('diff', '--cached', '--name-only')).Output) -split "`n" }),
            $(if ((Invoke-GitRead @('ls-files', '--others', '--exclude-standard')).Output) { ((Invoke-GitRead @('ls-files', '--others', '--exclude-standard')).Output) -split "`n" })
        ) | Where-Object { $_ } | Select-Object -Unique

        $sensitive = Test-SensitivePaths -Paths $allChanged
        if ($sensitive.Count -gt 0 -and -not $ForceSecrets) {
            Write-Err 'Refusing to commit — potentially sensitive files detected:'
            $sensitive | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
            throw 'Sensitive files blocked commit.'
        }

        Invoke-Git @('add', '-A') | Out-Null
        if (-not $Message) { $Message = Get-DefaultCommitMessage -Root $repoRoot }
        Write-Step "Committing: $Message"
        Invoke-Git @('commit', '-m', $Message) | Out-Null
    } else {
        Write-Host 'No local changes to commit.' -ForegroundColor DarkGray
    }

    Write-Step 'Pushing to GitHub'
    Invoke-Git @('fetch', 'origin') | Out-Null
    $behind = [int]((Invoke-GitRead @('rev-list', '--count', "HEAD..origin/$MainBranch")).Output.Trim() -replace '\D', '0')
    $ahead = [int]((Invoke-GitRead @('rev-list', '--count', "origin/$MainBranch..HEAD")).Output.Trim() -replace '\D', '0')
    if ($behind -gt 0) {
        if ($ahead -gt 0) {
            throw "main diverged from origin/main (ahead $ahead, behind $behind). Resolve manually, then push again."
        }
        Invoke-Git @('pull', '--ff-only', 'origin', $MainBranch) | Out-Null
    }
    Invoke-Git @('push', 'origin', $MainBranch) | Out-Null

    Write-Host ''
    Write-Ok 'Deploy complete.'
    Write-Host '  main is on GitHub — Cloudflare Pages will deploy to https://househunt.pages.dev'
    Write-Host '  (usually within 1-2 minutes)'
    if ($DryRun) { Write-Host '  [dry-run] No git changes were made.' -ForegroundColor DarkGray }
} catch {
    Write-Err $_.Exception.Message
    $exitCode = 1
} finally {
    Remove-SubstDrive
}
exit $exitCode
