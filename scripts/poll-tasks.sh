#!/usr/bin/env bash
# scripts/poll-tasks.sh
# Smart task poller for joyelgeorge/Taskman
#
# Logic:
#  1. Use `gh` CLI (already authenticated) — never curl unauthenticated.
#  2. Check PR #6 for new unresolved review requests → surface for fixing.
#  3. Check open issues for ONE eligible issue (dependency-ordered, no active branch).
#  4. Print the chosen issue body so the agent cron can implement it.
#  5. Never process an issue that already has a branch/PR in flight.
#  6. Never merge anything without explicit user approval.

set -euo pipefail

REPO="joyelgeorge/Taskman"
LOCAL_REPO="/Users/joyelgeorge/Documents/anti-grav/taskmen"

log() { echo "[poll-tasks] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

cd "$LOCAL_REPO"

# ── 0. Ensure gh is authenticated ────────────────────────────────────────────
if ! gh auth status --hostname github.com &>/dev/null; then
  log "ERROR: gh is not authenticated. Run: gh auth login"
  exit 1
fi
export GITHUB_TOKEN
GITHUB_TOKEN="$(gh auth token)"

# ── 1. PR reviews: check for CHANGES_REQUESTED ───────────────────────────────
log "Checking for open PRs with CHANGES_REQUESTED..."
PR6_DECISION=$(gh pr view 6 --repo "$REPO" --json reviewDecision \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('reviewDecision',''))" 2>/dev/null || echo "")

if [[ "$PR6_DECISION" == "CHANGES_REQUESTED" ]]; then
  log "PR #6 has CHANGES_REQUESTED — fetching comments..."
  gh pr view 6 --repo "$REPO" --comments --json comments \
    | python3 -c "
import sys, json
d = json.load(sys.stdin)
comments = d.get('comments', [])
# Print last 5 comments
for c in comments[-5:]:
    author = c.get('author', {}).get('login', 'unknown')
    body = c.get('body', '')[:500]
    print(f'  [{author}]: {body}')
    print()
"
  echo "POLL_RESULT: PR_CHANGES_REQUESTED"
else
  log "PR #6 review decision: '${PR6_DECISION:-none}' — no changes requested."
fi

# ── 2. Build eligibility data in Python (avoids bash 3.2 limitations) ─────────
log "Evaluating issue eligibility..."

EXISTING_BRANCHES=$(git branch -r 2>/dev/null | sed 's|.*origin/||' | tr '\n' ' ')
OPEN_PR_BRANCHES=$(gh pr list --repo "$REPO" --state open --json headRefName \
  | python3 -c "import sys,json; print(' '.join(p['headRefName'] for p in json.load(sys.stdin)))" 2>/dev/null || echo "")
CLOSED_ISSUES=$(gh issue list --repo "$REPO" --state closed --json number \
  | python3 -c "import sys,json; print(' '.join(str(i['number']) for i in json.load(sys.stdin)))" 2>/dev/null || echo "")
OPEN_ISSUES_JSON=$(gh issue list --repo "$REPO" --state open --json number,title,state 2>/dev/null || echo "[]")

python3 - <<PYEOF
import json, sys, re, os

# ── Config ─────────────────────────────────────────────────────────────────
# Issue dependency map: key must have all values closed before it is eligible
DEPS = {
    11: [],
    12: [11],
    13: [12],
    14: [12],
    15: [12],
    16: [13, 14, 15],
    17: [13, 14, 15],
    18: [16, 17],
    4:  [],
    5:  [],   # covered by PR #6
    7:  [],
    8:  [5],
    9:  [5],
    10: [5],
}

# Issues already handled — skip regardless of open state
ALREADY_IN_PROGRESS = {5}  # PR #6 covers issue #5

# Priority order (lower index = higher priority)
PRIORITY = [11, 12, 13, 14, 15, 16, 17, 18, 5, 7, 4, 8, 9, 10]

# ── Inputs from shell ───────────────────────────────────────────────────────
existing_branches = set("""$EXISTING_BRANCHES""".split())
open_pr_branches  = set("""$OPEN_PR_BRANCHES""".split())
closed_str        = """$CLOSED_ISSUES"""
closed_issues     = set(int(x) for x in closed_str.split() if x.strip().isdigit())
open_issues_raw   = json.loads("""$(echo "$OPEN_ISSUES_JSON" | sed 's/"/\\"/g' | tr -d '\n')""")

open_issue_map = {i['number']: i['title'] for i in open_issues_raw}

def has_branch(issue_num):
    patterns = [
        rf'issue[-_]?{issue_num}\b',
        rf'feat.*{issue_num}\b',
        rf'fix.*{issue_num}\b',
    ]
    all_branches = existing_branches | open_pr_branches
    for b in all_branches:
        for pat in patterns:
            if re.search(pat, b, re.IGNORECASE):
                return True
    return False

chosen = None
chosen_title = None
skip_log = []

for num in PRIORITY:
    if num not in open_issue_map:
        skip_log.append(f'  #{num}: SKIP (not open / already closed)')
        continue
    if num in ALREADY_IN_PROGRESS:
        skip_log.append(f'  #{num}: SKIP (covered by existing PR/branch)')
        continue
    if has_branch(num):
        skip_log.append(f'  #{num}: SKIP (branch already in flight)')
        continue
    prereqs = DEPS.get(num, [])
    unmet = [p for p in prereqs if p not in closed_issues]
    if unmet:
        skip_log.append(f'  #{num}: SKIP (waiting on #{", #".join(str(u) for u in unmet)})')
        continue
    # Eligible
    chosen = num
    chosen_title = open_issue_map[num]
    break

for line in skip_log:
    print(line)

if chosen:
    print(f'  #{chosen}: ELIGIBLE ✓ — {chosen_title}')
    print(f'POLL_RESULT: IMPLEMENT_ISSUE:{chosen}:{chosen_title}')
else:
    print('POLL_RESULT: NO_ELIGIBLE_ISSUE — all open issues are blocked by dependencies or have branches in flight')
PYEOF
