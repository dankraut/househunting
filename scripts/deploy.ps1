# House Hunt  -  single-command deploy: commit → sync → merge to main → push
# Cloudflare Pages auto-deploys when main is updated on GitHub.
param(
    [string]$Message = '',
    [switch]$DryRun,
    [switch]$NoReturnToBranch,
    [switch]$ForceSecrets
)

$ErrorActionPreference = 'Stop'
$MainBranch = 'main'
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
            return "Deploy $($Matches[1])"
        }
    }
    $indexPath = Join-Path $Root 'index.html'
    if (Test-Path -LiteralPath $indexPath) {
        $content = Get-Content -LiteralPath $indexPath -Raw -ErrorAction SilentlyContinue
        if ($content -match "SPA_VERSION\s*=\s*'([^']+)'") {
            return "Deploy $($Matches[1])"
        }
    }
    return "Deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
}

function Ensure-CleanMerge {
    param([string]$Context)
    $conflicts = (Invoke-GitRead @('diff', '--name-only', '--diff-filter=U')).Output
    if ($conflicts) {
        throw @(
            "Merge conflict during $Context.",
            'Resolve conflicts, then run: git add -A && git commit',
            'Or abort with: git merge --abort / git rebase --abort'
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
        throw 'Detached HEAD  -  checkout a branch before deploying.'
    }
    Write-Host "    branch: $currentBranch"

    Write-Step 'Fetching origin'
    Invoke-Git @('fetch', 'origin') | Out-Null

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
            Write-Err "Refusing to commit  -  potentially sensitive files detected:"
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

    function Sync-Branch {
        param(
            [string]$Branch,
            [switch]$SetUpstream
        )
        Write-Step "Syncing branch '$Branch' with origin"
        $localExists = (Invoke-GitRead @('rev-parse', '--verify', $Branch)).Ok
        $onBranch = (Invoke-GitRead @('branch', '--show-current')).Output.Trim()
        if ($onBranch -ne $Branch) {
            if (-not $localExists) {
                Invoke-Git @('checkout', '-b', $Branch, "origin/$Branch") | Out-Null
            } else {
                Invoke-Git @('checkout', $Branch) | Out-Null
            }
        } else {
            Write-Host "    already on '$Branch'" -ForegroundColor DarkGray
        }

        $upstream = (Invoke-GitRead @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')).Output
        $hasUpstream = [bool]$upstream
        if ($hasUpstream) {
            try {
                Invoke-Git @('pull', '--rebase', 'origin', $Branch) | Out-Null
            } catch {
                throw "Rebase failed on '$Branch'. Run: git rebase --abort, fix, then deploy again."
            }
            Ensure-CleanMerge -Context "rebase on $Branch"
        } elseif (Test-Path -LiteralPath ".git/refs/remotes/origin/$Branch") {
            Write-Host "    No upstream  -  will push with -u" -ForegroundColor DarkGray
        }

        $pushArgs = @('push', 'origin', $Branch)
        if ($SetUpstream -or -not $hasUpstream) { $pushArgs = @('push', '-u', 'origin', $Branch) }
        Invoke-Git $pushArgs | Out-Null
    }

    if ($currentBranch -eq $MainBranch) {
        Sync-Branch -Branch $MainBranch
    } else {
        Sync-Branch -Branch $currentBranch -SetUpstream
        Sync-Branch -Branch $MainBranch

        Write-Step "Merging '$currentBranch' into $MainBranch"
        try {
            Invoke-Git @('merge', $currentBranch, '--no-edit') | Out-Null
        } catch {
            Ensure-CleanMerge -Context "merge $currentBranch into $MainBranch"
            throw
        }
        Ensure-CleanMerge -Context "merge $currentBranch into $MainBranch"

        Invoke-Git @('push', 'origin', $MainBranch) | Out-Null

        if (-not $NoReturnToBranch) {
            Write-Step "Returning to '$currentBranch'"
            Invoke-Git @('checkout', $currentBranch) | Out-Null
        }
    }

    Write-Host ''
    Write-Ok 'Deploy complete.'
    Write-Host "  main is on GitHub  -  Cloudflare Pages will deploy to https://househunt.pages.dev"
    Write-Host "  (usually within 1-2 minutes; check the Cloudflare dashboard for build status)"
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
