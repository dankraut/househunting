# Cloud agent auto-ship setup

Cloud agents push `cursor/<description>-<suffix>` branches (suffix examples: `288c`, `fb87`, `b2eb`). Opening the PR requires **one** of the following (one-time setup):

## Option A — GitHub Actions (recommended)

1. Open [Repository Actions settings](https://github.com/dankraut/househunting/settings/actions).
2. Under **Workflow permissions**, select **Read and write permissions**.
3. Enable **Allow GitHub Actions to create and approve pull requests**.
4. Save.

After this, every push to `cursor/*` runs `.github/workflows/auto-open-cursor-pr.yml` and opens a **ready** PR. `auto-merge-cursor.yml` squash-merges when Cloudflare Pages is green.

## Option B — PAT secret (if Option A is blocked by org policy)

1. Create a fine-grained or classic PAT with **Contents** and **Pull requests** (read/write) on this repo.
2. Add repository secret **`GH_PAT`** (Settings → Secrets and variables → Actions).
3. Re-run **Auto-open cursor agent PRs** or push the branch again.

## End-to-end pipeline (Cursor → production)

```mermaid
flowchart LR
  A[Cursor agent edits] --> B[smoke-check.sh]
  B --> C[commit + push cursor/*]
  C --> D[auto-open-cursor-pr.yml]
  D --> E[Cloudflare Pages preview]
  E --> F[auto-merge-cursor.yml]
  F --> G[main]
  G --> H[househunt.pages.dev]
```

| Step | What runs |
|------|-----------|
| 1 | Agent edits on `cursor/<task>-<suffix>` |
| 2 | `bash scripts/smoke-check.sh` (or `ship.sh` which runs it) |
| 3 | `git push origin cursor/...` |
| 4 | **Auto-open cursor agent PRs** — rebases onto `main`, then opens/updates PR (not draft); re-opens after merge if new commits land on the branch |
| 5 | **Cloudflare Pages** — preview deploy check |
| 6 | **Auto-merge cursor agent PRs** — waits **8 minutes** after the latest push, then squash-merge when green |
| 7 | Cloudflare Pages production deploy from `main` |

**Stuck PRs:** **Actions → Cleanup stale cursor PRs → Run workflow** (optionally check *Close all conflicting*). This closes conflicting/stale `cursor/*` PRs and deletes merged branches.

**Manual recovery:** Actions → **Auto-merge cursor agent PRs** → Run workflow → optional `pr_number` → check **force_merge** to skip the settle wait.

### Settle period (prevents premature merge)

Auto-merge waits **8 minutes** after the **latest push** to a PR branch before merging (configurable via `AUTOMERGE_SETTLE_MINUTES` in `auto-merge-cursor.yml`). This gives Cloud agents time to push follow-up commits in the same turn. **Each new push resets the timer.**

If a PR merged before a follow-up commit landed, push the remaining commits to the same `cursor/*` branch — **auto-open** rebases onto `main` and creates a follow-up PR instead of leaving a conflicted PR.

**Conflicted follow-up PRs:** Usually caused by pushing without rebasing after an earlier squash-merge on the same branch. Push again (CI rebases) or locally: `git fetch origin main && git rebase origin/main && git push --force-with-lease`.

## Cloud agent ship command

```bash
bash scripts/ship.sh
```

Smoke check → commit (if dirty) → rebase on `main` → push → `gh pr create` when the Cloud token allows it, else the Actions workflow above.

## Cursor Cloud PR tool

If the agent reports “PR registered for user approval”, enable **automatic PR creation** for Cloud Agents in Cursor settings so `ManagePullRequest` does not require manual approval each turn.

## Branch naming

All of these work with auto-open and auto-merge:

- `cursor/map-filter-fix-288c` (Cloud agent default)
- `cursor/map-filter-fix-fb87` (Desktop `deploy.ps1` default)
- `cursor/map-filter-fix-b2eb` (legacy Cloud)

Pattern: `cursor/<description>-<suffix>` where suffix is lowercase alphanumeric.
