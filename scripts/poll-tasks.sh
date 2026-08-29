#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/.." && pwd)"

cd "$repo_dir"
export TASKMAN_PRIORITY_ISSUES="${TASKMAN_PRIORITY_ISSUES:-22,23,24}"
exec node scripts/poll-tasks.mjs
