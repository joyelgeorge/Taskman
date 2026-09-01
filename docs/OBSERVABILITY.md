# Taskman observability

Taskman emits OpenTelemetry-compatible span and metric records through a small,
dependency-free instrumentation boundary. The default is local/no-export mode:
telemetry failure can never fail, complete, or mutate domain work. A future OTLP
adapter can be registered with `configureTelemetryExporter()` without changing
workers or placing exporter credentials in the pipeline.

## Correlation

Scheduled and manually-triggered worker runs use the durable `run_key` as their
correlation ID. Nested Discover, Validate, Execute, queue-transition, and provider
spans share the trace ID. High-cardinality IDs exist only on traces; metrics use
bounded labels such as stage, provider, outcome, queue, and status class.

Default telemetry never accepts prompts, request bodies, external payloads,
authorization headers, cookies, email addresses, credentials, secrets, or API
keys. Attribute and metric-label allowlists enforce this boundary.

## Surfaces

- `GET /api/observability` — bounded process-local traces, metrics, and alerts.
- `GET /api/observability?traces=false` — metrics and alerts without trace IDs.
- `GET /api/observability/pipeline` — queue depth, oldest active age, terminal
  outcome counts, and verified money-event count.
- `GET /api/revenue/observability` — combined pipeline and telemetry view.

Opportunity estimates are never counted as revenue. `verifiedRevenueEvents`
counts only `MONEY_EVENT` outcomes with positive attributable value recorded by
the execution boundary.

## Metrics

- `scheduler_runs_total`, `scheduler_start_lag_ms`, `scheduler_run_duration_ms`
- `scheduler_lease_reclaims_total`
- `pipeline_stage_runs_total`, `pipeline_stage_duration_ms`
- `pipeline_queue_depth`, `pipeline_queue_oldest_age_seconds`
- `provider_requests_total`, `provider_latency_ms`
- `api_requests_total`, `api_request_duration_ms`
- `telemetry_export_failures_total`

## Retention and export

Local mode retains at most 500 spans in memory and resets on restart. Metrics are
process-local aggregates. An exporter receives only sanitized completed spans.
Exporter rejections are counted and swallowed. Production exporters should apply
their own retention and sampling policy; Taskman defaults to all local spans so
incident reproduction remains deterministic.

## Alerts and runbooks

Alerts are deterministic and testable without contacting an external service.

### Pipeline no progress

Default threshold: no successful pipeline span for 30 minutes after prior
progress. Check scheduler readiness, queue depth/age, provider status, and the
latest failed trace. Do not classify an empty, healthy queue as a failure.

### Provider error rate

Default threshold: errors are at least 50% of observed provider attempts. Check
timeouts, fallback outcomes, configured provider health, and run deadlines. Never
log or copy provider credentials during diagnosis.

### Aging queue

Default threshold: an active queue item is older than 60 minutes. Inspect its
trace and evidence status, then distinguish `NEEDS_EVIDENCE`, `SETUP_REQUIRED`,
worker failure, and an unavailable provider. Terminal outcomes are excluded from
stall depth.

## Deployment verification

Before production cutover, run the complete Node suite in memory and PostgreSQL
modes, trigger a zero-side-effect Discover run, query the observability endpoints,
and verify that no raw prompt, payload, credential, personal data, or estimated
opportunity value appears as verified revenue.
