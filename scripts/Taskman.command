#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")" 2>/dev/null || true

find_repo() {
  local candidates=(
    "$HOME/Documents/anti-grav/taskmen"
    "$HOME/Documents/anti-grav/taskman"
    "$HOME/Documents/Taskman"
    "$HOME/src/Taskman"
    "$(cd "$(dirname "$0")" && pwd)"
    "$(cd "$(dirname "$0")/.." && pwd)"
    "$(cd "$(dirname "$0")/../.." && pwd)"
  )
  local d
  for d in "${candidates[@]}"; do
    if [ -f "$d/package.json" ] && [ -f "$d/packages/web/server.js" ]; then
      echo "$d"
      return 0
    fi
  done
  return 1
}

REPO="$(find_repo || true)"
if [ -z "${REPO:-}" ]; then
  osascript -e 'display alert "Taskman" message "Could not find the Taskman repo. Put this file in the repo or keep the clone at ~/Documents/anti-grav/taskmen."' >/dev/null 2>&1 || true
  echo "Could not find the Taskman repo."
  read -r -p "Press Enter to close..."
  exit 1
fi

cd "$REPO"
echo "Repo: $REPO"

if [ -d .git ]; then
  git fetch origin --quiet || true
  git pull --ff-only || echo "git pull skipped (local changes or no ff)"
  echo "Branch: $(git branch --show-current 2>/dev/null || echo unknown)"
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  echo "Loaded .env from repo (values not printed)."
else
  echo "No .env in repo. API will run without Neon until you copy .env.example to .env."
fi

if [ -n "${DATABASE_URL:-}" ]; then
  echo "Neon/Postgres: DATABASE_URL is set."
else
  echo "Neon/Postgres: DATABASE_URL is not set. Ledger stays memory-only."
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node is not on PATH."
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing npm workspaces..."
  npm install
fi

API_PORT="${API_PORT:-3100}"
WEB_PORT="${WEB_PORT:-3200}"

lsof -ti tcp:"$API_PORT" | xargs kill 2>/dev/null || true
lsof -ti tcp:"$WEB_PORT" | xargs kill 2>/dev/null || true
sleep 0.4

echo "Starting packages/api on :$API_PORT"
node packages/api/server.js &
API_PID=$!

echo "Starting packages/web on :$WEB_PORT"
node packages/web/server.js &
WEB_PID=$!

cleanup() {
  kill "$API_PID" "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf "http://127.0.0.1:$WEB_PORT/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.3
done

open "http://127.0.0.1:${WEB_PORT}/" >/dev/null 2>&1 || true
echo
echo "UI  http://127.0.0.1:${WEB_PORT}/"
echo "API http://127.0.0.1:${API_PORT}/  (Connect uses this)"
echo "Leave this window open. Close it to stop Taskman."
wait
