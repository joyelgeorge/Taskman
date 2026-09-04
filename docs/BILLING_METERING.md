# Usage metering and entitlements

Taskman keeps four concepts deliberately separate:

1. **Measured usage** is an immutable meter event with an account, versioned metric, unit, quantity, source identity, timestamps, and bounded provenance.
2. **Calculated price** belongs to an effective-dated pricing version and is not a cash receipt.
3. **Economic value** is evidence that a Taskman action created or recovered value for a user.
4. **Verified revenue** requires separate payment evidence. Meter events never become revenue or money events automatically.

## Built-in metrics

- `ai_tokens:v1` (`token`)
- `successful_runs:v1` (`run`)
- `connector_calls:v1` (`call`)

Metric identity and units are immutable. A semantic change requires a new version.

## Enforcement

Before an AI task starts, Taskman checks the effective account plan for both the configured maximum token reservation and one successful-run unit. Unknown, inactive, expired, or exhausted entitlements fail closed before provider spend. Actual provider-reported tokens and the successful run are then recorded with deterministic source IDs, so replay cannot increment usage twice.

The seeded `local-default` / `development` plan exists only to preserve local POC behavior. Application code rejects it when `NODE_ENV=production`. Production must provision a real billing account, effective plan assignment, and entitlements, and set `TASKMAN_DEFAULT_ACCOUNT_ID` or provide an account when creating a task.

## API

`GET /api/usage` requires `accountId`, `from`, and `to` (ISO timestamps). It returns an explicit UTC window, per-metric totals, bounded event pages, an opaque cursor, and reconciliation status.

`GET /api/entitlements/check` requires `accountId` and `metricId`; optional `metricVersion` and `quantity` allow a no-side-effect preflight.

`GET /api/status` labels legacy provider totals `operational_non_billable`. They are never an invoice or revenue figure.

## Corrections and exports

Original meter events are immutable. Disputes and corrections use a negative compensating event linked to the original event. Billing-provider export is disabled by default and represented by an idempotent receipt ledger. The adapter boundary does not create charges or move money.

Meter provenance accepts only non-secret operational identifiers. Prompt text, task content, credentials, and personal data do not belong in meter payloads.
