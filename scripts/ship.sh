#!/usr/bin/env bash
# House Hunt — ship via PR (Cloud / Linux; mirrors scripts/deploy.ps1)
# commit → push cursor/* branch → open PR (ready, not draft) → auto-merge when Cloudflare Pages passes
set -euo pipefail

MAIN_BRANCH=main
BRANCH_PREFIX=cursor/
GH="${GH:-gh}"
if [[ -x /exec-daemon/gh ]]; then GH=/exec-daemon/gh; fi

usage() {
  cat <<'EOF'
Usage: scripts/ship.sh [-m "commit message"] [-t "PR title"] [-b "PR body"]

Ships the current cursor/* branch: smoke check → commit (if dirty) → push → gh pr create → gh pr ready.
Do not run on main. Branch must match cursor/<description>-<suffix> (e.g. -288c, -fb87, -b2eb).
EOF
}

COMMIT_MSG=""
PR_TITLE=""
PR_BODY=""

while getopts "m:t:b:h" opt; do
  case "$opt" in
    m) COMMIT_MSG="$OPTARG" ;;
    t) PR_TITLE="$OPTARG" ;;
    b) PR_BODY="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

branch="$(git branch --show-current)"
if [[ -z "$branch" ]]; then
  echo "ERROR: detached HEAD — checkout a branch before shipping." >&2
  exit 1
fi

if [[ "$branch" == "$MAIN_BRANCH" ]]; then
  echo "ERROR: cannot ship from main. Create cursor/<description>-<suffix> first." >&2
  exit 1
fi

if [[ "$branch" != ${BRANCH_PREFIX}* ]]; then
  echo "ERROR: branch '$branch' must start with ${BRANCH_PREFIX}" >&2
  exit 1
fi

if ! [[ "$branch" =~ ^cursor/.+-[a-z0-9]+$ ]]; then
  echo "ERROR: branch '$branch' must match cursor/<description>-<suffix> (e.g. cursor/my-fix-288c or cursor/my-fix-fb87)." >&2
  exit 1
fi

echo "==> Smoke check"
bash "$repo_root/scripts/smoke-check.sh"

if [[ -n "$(git status --porcelain)" ]]; then
  if [[ -z "$COMMIT_MSG" ]]; then
    COMMIT_MSG="$(grep -oP "SPA_VERSION\s*=\s*'\K[^']+" js/config.js 2>/dev/null | head -1 || true)"
    COMMIT_MSG="${COMMIT_MSG:+Ship $COMMIT_MSG}"
    COMMIT_MSG="${COMMIT_MSG:-Ship $(date '+%Y-%m-%d %H:%M')}"
  fi
  echo "==> Committing: $COMMIT_MSG"
  git add -A
  git commit -m "$COMMIT_MSG"
else
  echo "No local changes to commit."
fi

echo "==> Syncing with origin/$MAIN_BRANCH"
git fetch origin "$MAIN_BRANCH"
git rebase "origin/$MAIN_BRANCH"

echo "==> Pushing $branch"
if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
  git push origin "$branch"
else
  git push -u origin "$branch"
fi

if ! command -v "$GH" >/dev/null 2>&1; then
  echo "WARNING: gh not found — push succeeded but PR was not created." >&2
  exit 0
fi

existing="$("$GH" pr list --head "$branch" --state open --json url --limit 1 2>/dev/null | sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 || true)"
if [[ -n "$existing" ]]; then
  echo "==> Open PR: $existing"
  "$GH" pr ready "$existing" 2>/dev/null || true
  echo "$existing"
  exit 0
fi

if [[ -z "$PR_TITLE" ]]; then
  PR_TITLE="$(git log -1 --pretty=%s)"
fi
if [[ -z "$PR_BODY" ]]; then
  PR_BODY="Shipped from Cursor Cloud using scripts/ship.sh (same PR pipeline as Desktop).

- Auto-merge runs when the **Cloudflare Pages** check passes.
- Do not merge or push to \`main\` manually."
fi

echo "==> Opening pull request"
set +e
pr_out="$("$GH" pr create --base "$MAIN_BRANCH" --head "$branch" --title "$PR_TITLE" --body "$PR_BODY" 2>&1)"
pr_rc=$?
set -e
if [[ $pr_rc -eq 0 ]]; then
  echo "    Created PR: $pr_out"
  "$GH" pr ready "$pr_out" 2>/dev/null || true
  echo "$pr_out"
else
  echo "    gh pr create unavailable: $pr_out"
  echo "    Push triggers .github/workflows/auto-open-cursor-pr.yml to open the PR."
  remote="$(git remote get-url origin)"
  repo_path="$(echo "$remote" | sed -E 's#.*github.com[:/](.+/.+)(\.git)?$#\1#')"
  echo "    Manual: https://github.com/${repo_path}/compare/main...${branch}?expand=1"
fi
