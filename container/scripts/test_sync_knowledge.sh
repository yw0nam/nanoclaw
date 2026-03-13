#!/usr/bin/env bash
# test_sync_knowledge.sh
# TDD tests for sync_knowledge.sh
# Run: bash test_sync_knowledge.sh
set -euo pipefail

SCRIPT="$(dirname "$0")/sync_knowledge.sh"
PASS=0
FAIL=0

assert_eq() {
  local expected="$1"
  local actual="$2"
  local msg="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "  ✓ $msg"
    ((PASS++)) || true
  else
    echo "  ✗ FAIL: $msg"
    echo "    expected: $expected"
    echo "    actual:   $actual"
    ((FAIL++)) || true
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local msg="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    echo "  ✓ $msg"
    ((PASS++)) || true
  else
    echo "  ✗ FAIL: $msg"
    echo "    haystack: ${haystack:0:300}"
    echo "    needle:   $needle"
    ((FAIL++)) || true
  fi
}

assert_exit() {
  local expected="$1"
  local actual="$2"
  local msg="$3"
  assert_eq "$expected" "$actual" "$msg (exit code)"
}

echo "=== TDD Tests for sync_knowledge.sh ==="
echo "Script under test: $SCRIPT"

# ── RED phase: script doesn't exist yet ──
echo ""
echo "── Pre-check: script exists and is executable ──"
if [[ -f "$SCRIPT" ]]; then
  echo "  ✓ sync_knowledge.sh exists"
  ((PASS++)) || true
else
  echo "  ✗ FAIL: sync_knowledge.sh does not exist"
  ((FAIL++)) || true
fi

if [[ -x "$SCRIPT" ]]; then
  echo "  ✓ sync_knowledge.sh is executable"
  ((PASS++)) || true
else
  echo "  ✗ FAIL: sync_knowledge.sh is not executable"
  ((FAIL++)) || true
fi

# ── Task 4a: Normal flow with isolated git repo ──
echo ""
echo "── Task 4a: Nothing to commit → exit 0 with message ──"
FAKE_KB="/tmp/sync-test-kb-$$"
mkdir -p "$FAKE_KB"
cd "$FAKE_KB"
git init -q
git config user.email "test@test.com"
git config user.name "Test"
# Create initial commit
echo "initial" > README.md
git add README.md
git commit -q -m "initial"
cd - > /dev/null

# Run with nothing new to commit
set +e
OUTPUT=$(KNOWLEDGE_BASE_PATH="$FAKE_KB" bash "$SCRIPT" "test: nothing" 2>&1)
EXIT_CODE=$?
set -e

assert_exit "0" "$EXIT_CODE" "nothing to commit: exit 0"
assert_contains "$OUTPUT" "nothing to commit" "nothing to commit: prints message"

# ── Task 4b: Has changes to commit (local only, no remote) ──
echo ""
echo "── Task 4b: Has new file, local-only repo ──"
echo "new content" > "$FAKE_KB/new-note.md"

# Without remote push should still commit
set +e
OUTPUT2=$(KNOWLEDGE_BASE_PATH="$FAKE_KB" bash "$SCRIPT" "test: add note" 2>&1)
EXIT_CODE2=$?
set -e

# Since there's no remote, git pull --rebase and git push will fail.
# The script should detect no remote and handle gracefully.
# For this test we accept exit 0 with a commit or exit 1 with a clear error.
# The key behavior: file gets committed (git log should show it)
cd "$FAKE_KB"
LOG=$(git log --oneline 2>&1)
cd - > /dev/null
assert_contains "$LOG" "test: add note" "has changes: commit created with message"

# Cleanup
rm -rf "$FAKE_KB"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
