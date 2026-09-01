# Taskman public error contract

Taskman API failures use RFC 9457-style `application/problem+json` responses. Every failure contains only a stable `code`, safe title, HTTP `status`, deterministic `retryable` flag, and correlation ID. The same ID is returned in `x-correlation-id` and written to restricted structured logs.

Raw exception messages, stack traces, provider/database response bodies, request URLs, SQL, prompts, credentials, and tokens are never public or stored as durable run errors.

## Stable codes

| Code | HTTP | Retryable |
| --- | ---: | :---: |
| `INVALID_REQUEST`, `INVALID_JSON`, `INVALID_INTERVAL_MINUTES` | 400 | No |
| `UNAUTHORIZED` | 401 | No |
| `FORBIDDEN` | 403 | No |
| `NOT_FOUND` | 404 | No |
| `CONFLICT`, `SETUP_REQUIRED` | 409 | No |
| `BODY_TOO_LARGE` | 413 | No |
| `RATE_LIMITED` | 429 | Yes |
| `PROVIDER_UNAVAILABLE` | 502 | Yes |
| `NO_PROVIDER_CONFIGURED`, `DATABASE_NOT_CONFIGURED` | 503 | No |
| `DATABASE_UNAVAILABLE`, `SHUTDOWN_IN_PROGRESS` | 503 | Yes |
| `PROVIDER_TIMEOUT`, `RUN_DEADLINE_EXCEEDED` | 504 | Yes |
| `INTERNAL_ERROR` | 500 | No |

Clients must branch on `code` and `retryable`, not parse message text. Success responses remain ordinary `application/json`. Unknown failures collapse to `INTERNAL_ERROR`.

Authorization, economic, funding, spend, and capability checks remain fail-closed. Error classification never grants authority or converts estimated value into verified revenue.
