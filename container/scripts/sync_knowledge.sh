#!/usr/bin/env bash
# sync_knowledge.sh
# git add/commit/pull-rebase/push with conflict recovery
set -euo pipefail

COMMIT_MSG="${1:-knowledge: auto-sync}"

if [[ -z "${KNOWLEDGE_BASE_PATH:-}" ]]; then
  echo "ERROR: KNOWLEDGE_BASE_PATH is not set" >&2
  exit 1
fi

cd "$KNOWLEDGE_BASE_PATH"

git add .

if ! git commit -m "$COMMIT_MSG"; then
  echo "nothing to commit"
  exit 0
fi

# Check if remote 'origin' exists
if ! git remote get-url origin > /dev/null 2>&1; then
  echo "No remote 'origin' configured — skipping pull/push"
  exit 0
fi

if ! git pull --rebase origin main; then
  git rebase --abort 2>/dev/null || true
  git reset --soft HEAD~1
  echo "SYNC_CONFLICT: rebase failed — manual resolution required" >&2
  exit 1
fi

git push origin main
