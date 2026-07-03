# House Hunt — ship via PR (same path as Cursor Cloud agents)
# commit → push cursor/* branch → open PR → auto-merge when Cloudflare Pages passes
param(
    [string]$Message = '',
    [string]$Description = '',
    [string]$PrTitle = '',
    [switch]$DryRun,
    [switch]$ForceSecrets
)

$ErrorActionPreference = 'Stop'
$MainBranch = 'main'
$BranchPrefix = 'cursor/'
$BranchSuffix = '-fb87'
$script:SubstMapped = $false
$script:SubstDrive = $null

function Write-Step([string]$Text) {
    Write-Host "`n==> $Text" -ForegroundColor Cyan
}

function Write-Ok([string]$Text) {
    Write-Host $Text -ForegroundColor Green
}

function Write-Err([string]$Text) {
    Write-Host "ERROR: $Text" -ForegroundColor Red
}

function Invoke-GitRead {
    param(
        [Parameter(Mandatory = $true, Position = 0)]
        [string[]]$GitArgs
    )
    $out = & git @GitArgs 2>&1
    return @{
        Ok     = ($LASTEXITCODE -eq 0)
        Output = if ($out) { ($out | Out-String).Trim() } else { '' }
    }
}

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true, Position = 0)]
        [string[]]$GitArgs
    )
    $line = 'git ' + ($GitArgs -join ' ')
    if ($DryRun) {
        Write-Host "[dry-run] $line" -ForegroundColor DarkGray
        return ''
    }
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
    $patterns = @(
        '\.env$',
        '\.env\.',
        'credentials\.json$',
        'secrets?\.(json|ya?ml|toml)$',
        '\.pem$',
        '\.key$',
        'id_rsa$'
    )
    $regex = '(' + ($patterns -join '|') + ')'
    return @($Paths | Where-Object { $_ -and ($_ -match $regex) })
}

function Get-DefaultCommitMessage {
    param([string]$Root)
    $configPath = Join-Path $Root 'js\config.js'
    if (Test-Path -LiteralPath $configPath) {
        $content = Get-Content -LiteralPath $configPath -Raw -ErrorAction SilentlyContinue
        if ($content -match "SPA_VERSION\s*=\s*'([^']+)'") {
            return "Ship $($Matches[1])"
        }
    }
    return "Ship $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
}

function Test-CursorShipBranch([string]$Branch) {
    return [bool]($Branch -match "^$([regex]::Escape($BranchPrefix)).+$([regex]::Escape($BranchSuffix))$")
}

function ConvertTo-BranchSlug([string]$Text) {
    $slug = ($Text -replace '[^a-zA-Z0-9]+', '-').Trim('-').ToLower()
    if ($slug.Length -gt 48) { $slug = $slug.Substring(0, 48).Trim('-') }
    if (-not $slug) { $slug = 'desktop-ship' }
    return $slug
}

function New-CursorBranchName([string]$DescriptionText) {
    $slug = ConvertTo-BranchSlug -Text $DescriptionText
    return "$BranchPrefix$slug$BranchSuffix"
}

function Ensure-CleanMerge {
    param([string]$Context)
    $conflicts = (Invoke-GitRead @('diff', '--name-only', '--diff-filter=U')).Output
    if ($conflicts) {
        throw @(
            "Merge conflict during $Context.",
            'Resolve conflicts, then run deploy again.',
            'Or abort with: git rebase --abort'
        ) -join ' '
    }
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

function Test-GhAvailable {
    $gh = Get-Command gh -ErrorAction SilentlyContinue
    return [bool]$gh
}

function Get-OpenPullRequestUrl {
    param([string]$Branch)
    if (-not (Test-GhAvailable)) { return $null }
    if ($DryRun) { return 'https://github.com/example/pull/0' }
    $json = & gh pr list --head $Branch --state open --json url --limit 1 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
    $rows = $json | ConvertFrom-Json
    if ($rows -and $rows.Count -gt 0) { return $rows[0].url }
    return $null
}

function Open-PullRequest {
    param(
        [string]$Branch,
        [string]$Title,
        [string]$Body
    )
    if (-not (Test-GhAvailable)) {
        Write-Host "WARNING: GitHub CLI (gh) not found — push succeeded but PR was not created." -ForegroundColor Yellow
        Write-Host "  Install gh, then run: gh pr create --base main --head $Branch --title `"$Title`"" -ForegroundColor Yellow
        return $null
    }

    $existing = Get-OpenPullRequestUrl -Branch $Branch
    if ($existing) {
        Write-Host "    Open PR: $existing" -ForegroundColor DarkGray
        if (-not $DryRun) {
            & gh pr ready $existing 2>$null | Out-Null
        }
        return $existing
    }

    if ($DryRun) {
        Write-Host "[dry-run] gh pr create --base main --head $Branch --title `"$Title`"" -ForegroundColor DarkGray
        return "https://github.com/example/pull/0"
    }

    $createArgs = @(
        'pr', 'create',
        '--base', $MainBranch,
        '--head', $Branch,
        '--title', $Title,
        '--body', $Body
    )
    $url = (& gh @createArgs 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "gh pr create failed: $url"
    }
    Write-Host "    Created PR: $url" -ForegroundColor DarkGray
    return $url
}

# Resolve repo root from script location (avoids hardcoding paths with apostrophes).
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

if (-not $repoRoot) {
    Write-Err 'Could not determine repository root.'
    exit 1
}

$workRoot = Initialize-SubstDrive -Path $repoRoot
$exitCode = 0
try {
    Set-Location -LiteralPath $workRoot
    Write-Step "Repository: $repoRoot"

    $originUrl = (Invoke-GitRead @('remote', 'get-url', 'origin')).Output
    Write-Host "    origin: $originUrl"

    $currentBranch = (Invoke-GitRead @('branch', '--show-current')).Output.Trim()
    if (-not $currentBranch) {
        throw 'Detached HEAD — checkout a branch before shipping.'
    }
    Write-Host "    branch: $currentBranch"

    Write-Step 'Fetching origin'
    Invoke-Git @('fetch', 'origin') | Out-Null

    Write-Step 'Smoke check'
    $smokePs1 = Join-Path $PSScriptRoot 'smoke-check.ps1'
    if (Test-Path -LiteralPath $smokePs1) {
        & $smokePs1 -RepoRoot $repoRoot
        if ($LASTEXITCODE -ne 0) { throw 'Smoke check failed — fix regressions before ship.' }
    } else {
        $smokeSh = Join-Path $PSScriptRoot 'smoke-check.sh'
        if (Test-Path -LiteralPath $smokeSh) {
            & bash $smokeSh
            if ($LASTEXITCODE -ne 0) { throw 'Smoke check failed — fix regressions before ship.' }
        } else {
            Write-Host 'WARNING: smoke-check script not found; skipping.' -ForegroundColor Yellow
        }
    }

    $porcelain = (Invoke-GitRead @('status', '--porcelain')).Output
    $hasChanges = [bool]($porcelain -and $porcelain.Trim())

    if ($hasChanges) {
        Write-Step 'Staging changes'
        $tracked = (Invoke-GitRead @('diff', '--name-only')).Output
        $staged = (Invoke-GitRead @('diff', '--cached', '--name-only')).Output
        $untracked = (Invoke-GitRead @('ls-files', '--others', '--exclude-standard')).Output
        $allChanged = @(
            $(if ($tracked) { $tracked -split "`n" }),
            $(if ($staged) { $staged -split "`n" }),
            $(if ($untracked) { $untracked -split "`n" })
        ) | Where-Object { $_ } | Select-Object -Unique

        $sensitive = Test-SensitivePaths -Paths $allChanged
        if ($sensitive.Count -gt 0 -and -not $ForceSecrets) {
            Write-Err "Refusing to commit — potentially sensitive files detected:"
            $sensitive | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
            Write-Host "Remove them from the commit, add to .gitignore, or re-run with -ForceSecrets if intentional." -ForegroundColor Yellow
            throw 'Sensitive files blocked commit.'
        }
        if ($sensitive.Count -gt 0) {
            Write-Host "WARNING: committing sensitive-looking files (ForceSecrets set):" -ForegroundColor Yellow
            $sensitive | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
        }

        Invoke-Git @('add', '-A') | Out-Null

        if (-not $Message) {
            $Message = Get-DefaultCommitMessage -Root $repoRoot
        }
        Write-Step "Committing: $Message"
        Invoke-Git @('commit', '-m', $Message) | Out-Null
    } else {
        Write-Host 'No local changes to commit.' -ForegroundColor DarkGray
    }

    $aheadOfMain = [int]((Invoke-GitRead @('rev-list', '--count', "origin/$MainBranch..HEAD")).Output.Trim() -replace '\D', '0')
    if ($currentBranch -eq $MainBranch) {
        if ($aheadOfMain -eq 0 -and -not $hasChanges) {
            Write-Ok "main is clean and synced with origin/main."
            Write-Host "  Production only updates when a cursor/* PR merges to main."
            Write-Host "  Work on a branch like cursor/my-feature-fb87, then run deploy again."
            exit 0
        }

        if (-not $Description) {
            if ($Message) {
                $Description = $Message
            } else {
                throw @(
                    "Cannot ship directly from main (branch protection blocks direct push).",
                    "Pass -Description 'my-feature' to create cursor/my-feature-fb87,",
                    "or checkout an existing cursor/*-fb87 branch first."
                ) -join ' '
            }
        }

        $shipBranch = New-CursorBranchName -DescriptionText $Description
        Write-Step "Creating ship branch '$shipBranch' from main"
        Invoke-Git @('checkout', '-b', $shipBranch) | Out-Null
        $currentBranch = $shipBranch
    } elseif (-not (Test-CursorShipBranch $currentBranch)) {
        throw @(
            "Branch '$currentBranch' will not auto-merge.",
            "Rename to cursor/<description>-fb87 (cloud agent convention), or",
            "checkout main and re-run with -Description 'my-feature'."
        ) -join ' '
    }

    Write-Step "Syncing '$currentBranch' with origin/$MainBranch"
    $upstream = (Invoke-GitRead @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')).Output
    $hasUpstream = [bool]$upstream
    try {
        Invoke-Git @('rebase', "origin/$MainBranch") | Out-Null
    } catch {
        Ensure-CleanMerge -Context "rebase onto origin/$MainBranch"
        throw "Rebase failed on '$currentBranch'. Run: git rebase --abort, fix conflicts, then deploy again."
    }
    Ensure-CleanMerge -Context "rebase onto origin/$MainBranch"

    $pushArgs = @('push', '-u', 'origin', $currentBranch)
    if ($hasUpstream) { $pushArgs = @('push', 'origin', $currentBranch) }
    Write-Step "Pushing '$currentBranch' (not main)"
    Invoke-Git $pushArgs | Out-Null

    if (-not $PrTitle) {
        $PrTitle = if ($Message) { $Message } else { "Ship $currentBranch" }
    }
    $prBody = @(
        'Shipped from Cursor Desktop using the same PR pipeline as Cloud agents.',
        '',
        '- Auto-merge runs when the **Cloudflare Pages** check passes.',
        '- Do not merge or push to `main` manually.',
        '',
        'After merge:',
        '1. GitHub Desktop → Pull `main`',
        '2. Hard-refresh the SPA at https://househunt.pages.dev',
        '3. If `extension/` changed: pull and Reload the unpacked extension in Chrome'
    ) -join "`n"

    Write-Step 'Opening pull request'
    $prUrl = Open-PullRequest -Branch $currentBranch -Title $PrTitle -Body $prBody

    Write-Host ''
    Write-Ok 'Ship initiated (PR workflow — same as Cursor Cloud).'
    Write-Host "  Branch: $currentBranch"
    if ($prUrl) { Write-Host "  PR:     $prUrl" }
    Write-Host '  Next:   GitHub auto-merge merges to main when Cloudflare Pages succeeds.'
    Write-Host '  Then:   Pull main locally; refresh SPA; reload extension if extension/ changed.'
    if ($DryRun) {
        Write-Host '  [dry-run] No git changes were made.' -ForegroundColor DarkGray
    }
} catch {
    Write-Err $_.Exception.Message
    $exitCode = 1
} finally {
    Remove-SubstDrive
}
exit $exitCode
