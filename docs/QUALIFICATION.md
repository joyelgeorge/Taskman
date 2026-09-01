# Qualification contract

`src/qualification-engine.js` is the single qualification implementation used by
Discover, Validate, and `POST /api/qualification`.

Each canonical profile combines three independent decisions:

1. deterministic normalized metrics and hard gates;
2. profile-specific `gateEvidence` whose `evidenceRef` is bound to the
   candidate's evidence list;
3. current runtime capability state from the authoritative capability registry.

The profiles are `programmable_money_flow_v1`, `bounty_execution_v1`, and
`immediate_income_v1`. A high score or model confidence cannot replace missing
evidence. Missing evidence returns `NEEDS_EVIDENCE`; an evidence-backed failure
returns `REJECTED`; unavailable/unhealthy adapters return `BLOCKED`; reusable
one-time setup returns `SETUP_REQUIRED`.

Only fully evidenced and currently capable work can return `EXECUTABLE` or
`THRESHOLD_CROSSED`. Financial estimates and posted rewards remain separate
from verified economic outcomes.
