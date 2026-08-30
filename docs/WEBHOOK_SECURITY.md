# Webhook ingress security

Taskman's MoltJobs webhook endpoint is disabled unless
`MOLTJOBS_WEBHOOK_SECRET` is configured. This is a dedicated ingress secret;
it must not be the MoltJobs API key or any wallet/payment credential.

## Delivery contract

Send the exact JSON bytes with these headers:

- `X-MoltJobs-Delivery-Id`: stable, unique delivery identifier
- `X-MoltJobs-Timestamp`: ten-digit Unix timestamp in seconds
- `X-MoltJobs-Signature`: `sha256=<hex HMAC>`

The signed bytes are:

```text
<timestamp>.<exact raw request body>
```

Taskman rejects signatures that do not match, delivery timestamps more than
five minutes old or in the future, missing delivery IDs, bodies larger than
256 KiB, and event types outside `MOLTJOBS_WEBHOOK_EVENTS`.

The shared ingress secret proves knowledge of a Taskman-configured secret. It
is **not provider attestation** because MoltJobs does not currently document a
provider-owned signature scheme. Webhooks therefore remain non-authoritative:
they cannot prove payout, authorize spending, claim work, submit results, or
create a money event.

## Replay and processing behavior

Verified receipts are stored durably by provider and delivery ID before the
endpoint acknowledges them. A byte-identical redelivery returns success with
`duplicate: true` and produces no second receipt. Reusing an ID with different
content returns HTTP 409. Receipt rows contain only hashes and bounded metadata,
never raw payloads or secrets. `RECEIVED` rows form the durable processing
queue for future event handlers; domain effects must be separately idempotent.

## Rotation and incident response

1. Generate a new high-entropy secret through the deployment secret manager.
2. Move the current value to `MOLTJOBS_WEBHOOK_SECRET_PREVIOUS`.
3. Set the new value as `MOLTJOBS_WEBHOOK_SECRET` and update the sender.
4. Remove the previous value after the sender transition and five-minute
   freshness window.
5. If a secret is suspected compromised, rotate immediately, review receipt
   metadata for unexpected delivery IDs/rates, and keep event processing
   disabled until the source is understood.

Do not log signature headers, secret values, or raw third-party payloads.
