#!/bin/bash
#
# Put a web session on the runtime this repository actually pins, with
# dependencies installed and a database ready.
#
# This exists because of a measured failure. A container shipped Node 22 while
# .node-version pins 24, and the suite reported four permanent failures that
# were not bugs at all — test/runtime-policy.test.js asserting the Node major,
# plus three shutdown tests tripping on an event-loop difference between the
# majors. Hours went into treating them as a pre-existing defect. On Node 24
# they pass untouched. See docs/tasks/2026-09-14-test-resets-do-not-reset-postgresql.md.
#
# The trap is that nvm reads .nvmrc and ignores .node-version, so `nvm use` in a
# fresh container finds nothing, says so quietly, and leaves the wrong Node in
# place. Everything then runs and mostly works, which is the worst outcome.
set -euo pipefail

# Web sessions only. A local checkout has its own toolchain and should not have
# its PATH or database rearranged underneath it.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:?CLAUDE_PROJECT_DIR is not set}"

# Append to the session environment only if it is not already there, so resume
# and compact do not stack duplicate PATH entries.
persist() {
  [ -n "${CLAUDE_ENV_FILE:-}" ] || return 0
  grep -qxF "$1" "$CLAUDE_ENV_FILE" 2>/dev/null || echo "$1" >> "$CLAUDE_ENV_FILE"
}

# ---------------------------------------------------------------- node
export NVM_DIR="${NVM_DIR:-/root/.nvm}"
for candidate in "$NVM_DIR/nvm.sh" /opt/nvm/nvm.sh /usr/local/nvm/nvm.sh; do
  # shellcheck disable=SC1090
  [ -s "$candidate" ] && . "$candidate" && break
done

if command -v nvm >/dev/null 2>&1; then
  nvm install >/dev/null 2>&1 || true   # no argument: reads .nvmrc
  nvm use >/dev/null 2>&1 || true
fi

want="$(tr -d '[:space:]' < .nvmrc)"
have="$(node -v 2>/dev/null | sed 's/^v//')"
if [ "$have" != "$want" ]; then
  echo "session-start: need Node $want (.nvmrc), got ${have:-none}." >&2
  echo "session-start: refusing to continue — a suite run on the wrong major reports failures that are not real." >&2
  exit 1
fi
persist "export NVM_DIR=\"$NVM_DIR\""
persist "export PATH=\"$(dirname "$(command -v node)"):\$PATH\""
echo "session-start: node $(node -v)"

# ---------------------------------------------------------------- dependencies
# install rather than ci: the container image is cached after this hook, and
# install reuses what is already unpacked.
npm install --no-audit --no-fund >/dev/null
echo "session-start: dependencies installed"

# ---------------------------------------------------------------- postgresql
# Best effort. `npm test` runs in memory mode and does not need this, so a
# database that will not start must not stop the session. It is set up because
# CI runs the suite in BOTH modes and memory mode demonstrably certifies code
# that PostgreSQL rejects — CLAUDE.md rule 4, and every dual-storage bug found
# on 2026-09-14.
#
# Credentials deliberately match .github/workflows/test.yml so a local run and
# a CI run mean the same thing.
setup_postgres() {
  command -v pg_isready >/dev/null 2>&1 || return 1
  pg_isready -q 2>/dev/null || service postgresql start >/dev/null 2>&1 || return 1
  for _ in 1 2 3 4 5 6 7 8 9 10; do pg_isready -q 2>/dev/null && break; sleep 1; done
  pg_isready -q 2>/dev/null || return 1

  su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='taskman'\"" 2>/dev/null | grep -q 1 \
    || su postgres -c "psql -q -c \"CREATE ROLE taskman LOGIN PASSWORD 'taskman' SUPERUSER\"" >/dev/null 2>&1 \
    || return 1
  su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='taskman_test'\"" 2>/dev/null | grep -q 1 \
    || su postgres -c "createdb -O taskman taskman_test" >/dev/null 2>&1 \
    || return 1

  DATABASE_URL='postgresql://taskman:taskman@localhost:5432/taskman_test' \
    PGSSL=disable NODE_ENV=test npm run migrate:all >/dev/null 2>&1 || return 1
}

# DATABASE_URL is intentionally NOT exported. Setting it would silently turn
# every `npm test` into a PostgreSQL run; CI keeps the two modes as separate
# jobs and so should this. The database is prepared, not imposed.
if setup_postgres; then
  echo "session-start: postgres ready — for the PostgreSQL suite, run"
  echo "  DATABASE_URL=postgresql://taskman:taskman@localhost:5432/taskman_test PGSSL=disable NODE_ENV=test npm test -- --test-concurrency=1"
else
  echo "session-start: postgres unavailable; memory-mode tests still work. PostgreSQL-only defects will not be visible." >&2
fi
