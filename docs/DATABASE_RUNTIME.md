# PostgreSQL runtime budgets

Taskman applies bounded PostgreSQL settings at the pool and transaction levels so a
slow query, exhausted pool, abandoned transaction, or idle-client failure cannot
silently consume the service indefinitely.

The defaults are documented in `.env.example`. Invalid, fractional, zero, or
out-of-range values fail startup with `INVALID_DATABASE_RUNTIME_CONFIG`.

## Budgets

- Pool checkout: `PG_CONNECTION_TIMEOUT_MS`
- Idle connection retirement: `PG_IDLE_TIMEOUT_MS`
- Connection lifetime: `PG_POOL_MAX_LIFETIME_SECONDS`
- Server statement timeout: `PG_STATEMENT_TIMEOUT_MS`
- Client query timeout: `PG_QUERY_TIMEOUT_MS`
- Lock wait timeout: `PG_LOCK_TIMEOUT_MS`
- Idle transaction timeout: `PG_IDLE_TRANSACTION_TIMEOUT_MS`
- Separate migration statement/lock budgets: `PG_MIGRATION_*_TIMEOUT_MS`

The client query timeout must be at least the server statement timeout so
PostgreSQL gets the first opportunity to cancel and clean up work.

## Operations

`/api/status` exposes only counts for total, idle, and waiting pool clients plus
a sanitized last idle-client error code and timestamp. It never returns raw
database messages, SQL, connection strings, or credentials.

Tune limits from observed latency and saturation. Alert on sustained pool waiters,
connection errors, query cancellation (`57014`), or lock failures. Migration
budgets are intentionally larger than request budgets but remain finite.
