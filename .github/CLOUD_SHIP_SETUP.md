# Cloud agent auto-ship setup

Cloud agents push `cursor/*` branches automatically. Opening the PR requires **one** of the following (one-time setup):

## Option A — GitHub Actions (recommended)

1. Open [Repository Actions settings](https://github.com/dankraut/househunting/settings/actions).
2. Under **Workflow permissions**, select **Read and write permissions**.
3. Enable **Allow GitHub Actions to create and approve pull requests**.
4. Save.

After this, every push to `cursor/*` runs `.github/workflows/auto-open-cursor-pr.yml` and opens a **ready** PR. `auto-merge-cursor.yml` squash-merges when Cloudflare Pages is green.

To open a PR for an already-pushed branch: **Actions → Auto-open cursor agent PRs → Run workflow** → branch `cursor/your-branch-b2eb`.

## Option B — PAT secret (if Option A is blocked by org policy)

1. Create a fine-grained or classic PAT with **Contents** and **Pull requests** (read/write) on this repo.
2. Add repository secret **`GH_PAT`** (Settings → Secrets and variables → Actions).
3. Re-run **Auto-open cursor agent PRs** or push the branch again.

## Cloud agent ship command

```bash
bash scripts/ship.sh
```

Smoke check → commit (if dirty) → push → `gh pr create` when the Cloud token allows it, else the Actions workflow above.

## Cursor Cloud PR tool

If the agent reports “PR registered for user approval”, enable **automatic PR creation** for Cloud Agents in Cursor settings so `ManagePullRequest` does not require manual approval each turn.
