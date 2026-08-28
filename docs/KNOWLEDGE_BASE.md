# Taskman Knowledge Base

_Last consolidated: 2026-08-28_

This file is the durable project memory for Taskman. Future ChatGPT/Codex work should read this before proposing architecture changes.

## 1. Product intent

Taskman is not a new AI model. It is a lightweight orchestration layer that lets a user describe a task in plain language and then executes that task through external APIs.

Core promise:

> Define a task once. Taskman plans it, schedules it, chooses an eligible provider, executes it, falls back when needed, preserves context, records usage/cost, and shows the result plus the smartest next action.

The product should feel simple even when the backend is sophisticated.

## 2. User-facing requirements accumulated so far

- Very simple web UI; avoid clutter.
- Main interaction is a plain-language task box.
- Tasks may be manual, one-time, interval-based, cron-like, or continuous/conditional later.
- User should be able to see status, next run, latest result, and history.
- Full instruction history/context must remain associated with each task.
- Recurring runs should be able to use relevant previous outputs as context.
- Provider/model choice should normally be automatic.
- User may connect their own provider accounts/API credentials.
- Show which provider/model was actually used.
- Show token usage and estimated cost.
- Show fallbacks/retries when they happen, but keep them collapsed by default.
- Include a useful "smart next step" after a run.
- No local model requirement. Execution should remain API-based so the app stays light.
- Prefer free/cheap capacity where possible without making reliability dependent on one provider.
- Avoid exhausting one provider; rotate/fail over intelligently.
- The app should be able to grow by adding provider adapters/connectors rather than rewriting task definitions.

## 3. Architecture conclusions

### Current runnable POC

The GitHub repository currently contains a Node 20 zero-runtime-dependency POC. It demonstrates:

- task creation
- manual runs
- interval scheduling
- provider routing/fallback
- recent-output context reuse
- basic token counters
- minimal dashboard
- next-best-action output

This POC intentionally stores data in memory. Restarting it clears tasks and runs.

### Production direction

The more complete design baseline is a modular monolith:

- responsive web/PWA frontend
- backend orchestration API
- PostgreSQL persistence
- durable scheduler with restart recovery
- provider registry + health state
- quota/budget manager
- execution/run state machine
- connector registry
- notification service
- audit/usage/evaluation data

Earlier implementation/design work also validated a Java/Spring Boot state-machine approach with explicit task states, persisted transitions, retry/backoff, fallback, approval gates, logs, and a mock LLM client. That work is useful as implementation lineage, but the current GitHub POC is Node-based for fast experimentation.

Do not confuse the fast POC implementation choice with the long-term architecture decision.

## 4. State-machine findings

Reliable task execution should be deterministic around AI calls. Suggested durable states include:

- PENDING
- RUNNING
- RETRYING
- COMPLETED / SUCCEEDED
- NO_ACTION
- FAILED
- CRITICAL_ERROR
- PAUSED
- WAITING_APPROVAL (for side effects later)

Important conclusion: the LLM should not control basic reliability. Scheduling, retries, idempotency, state transitions, timeouts, and policy enforcement belong in normal code.

## 5. Provider research snapshot

Provider availability, pricing, rate limits, and free tiers change frequently. Never treat this section as permanent truth; refresh external facts before production decisions.

Research snapshot from August 2026 suggested the provider layer should be interchangeable and include multiple families such as:

- Alibaba Cloud Model Studio / Qwen: useful candidate for free-quota/low-cost capacity where available.
- DeepSeek API: inexpensive reasoning/API option, but do not assume an ongoing free tier.
- Google Gemini API: useful additional provider candidate; actual free-tier/rate-limit eligibility depends on the account/project.
- Regional providers such as GLM/Zhipu: possible backup adapters after verifying access, geography, quotas and policies.
- OpenAI-compatible endpoints are valuable because a reusable adapter can cover multiple vendors.

The current Node POC includes adapter examples for Gemini, Groq and OpenRouter. These are implementation examples, not hard product dependencies.

## 6. Key inferred product insight

The differentiator is not merely "run a prompt on a schedule." The stronger product is a policy-driven orchestration engine that separates:

1. user intent
2. task plan
3. capabilities required
4. provider selection
5. deterministic execution
6. context/history
7. usage economics
8. outcome evaluation
9. next action

This separation makes the system adaptable without changing every saved task when providers/models change.

## 7. Capability vocabulary

Tasks and steps should request capabilities rather than specific model names. Useful capability labels include:

- text_fast
- reasoning
- long_context
- structured_json
- tool_calling
- coding
- vision
- web_research
- extraction
- summarization
- classification

Provider/model selection occurs after capabilities are known.

## 8. Reliability findings

Recommended failover sequence:

1. choose highest-ranked eligible endpoint
2. retry once for a clearly transient failure
3. put unhealthy endpoint into cooldown when appropriate
4. move to next compatible endpoint
5. continue until eligible options are exhausted
6. return a terminal failure with a clear reason

Do not endlessly retry permanent errors such as invalid credentials or unsupported input.

Use exponential backoff with jitter for transient 429/5xx/network failures.

Never cross a policy boundary just to complete a run. Example: if paid usage is disabled, fallback must not silently use a paid provider.

## 9. Context/history findings

Each task needs two forms of memory:

### Immutable instruction history

Keep versioned task definitions so the exact instruction used for a run can be reconstructed.

### Execution context

Store previous outputs, structured findings, external observations, and relevant run summaries so recurring work can build on what it already learned.

Do not simply append unlimited raw history to every prompt. Future production logic should retrieve/select relevant context and summarize old history when needed.

## 10. Usage and economics

Track at minimum:

- provider
- model
- input tokens
- output tokens
- estimated cost
- latency
- success/failure
- retry/fallback chain
- quota/budget state at selection time

Free capacity should be treated as a finite resource, not as an assumption of unlimited availability.

Paid fallback should be explicit and policy-controlled. A provider must not exceed configured hard limits.

## 11. Security conclusions

- Never commit raw API keys.
- Never store secrets inside task JSON or browser local storage.
- Environment variables are acceptable for the POC.
- Production should store credential references, ideally backed by a managed secret store or encrypted store.
- Redact authorization headers and secrets from logs.
- Add authentication before exposing a production orchestration API.
- External side effects such as sending email, spending money, deleting data, or publishing should have explicit permissions and optional approval gates.
- Validate AI-generated tool arguments against schemas before executing them.
- Generic HTTP connectors need SSRF protections.

## 12. UI conclusion: visibility without clutter

Default task view should show only:

- title
- status
- next run
- latest result
- Run / Pause controls

Expandable advanced views may show:

- generated plan
- provider/model route
- fallback reasons
- step timeline
- token/cost usage
- provider health
- raw structured output

The user should not have to select a model for normal task creation.

## 13. Continuous-improvement findings

Taskman may safely learn operational statistics such as:

- provider success rate by capability/task type
- latency percentiles
- transient failure rates
- schema-valid response rate
- token/cost averages
- which fallback sequences work best
- user-visible outcome signals

Safe automatic behavior may include:

- reordering eligible providers
- temporarily cooling down unstable endpoints
- reducing traffic to a provider near quota reserve
- re-enabling after successful health checks
- proposing workflow improvements

Do not allow V1 to autonomously rewrite/deploy arbitrary production code, increase spending limits, weaken security, or silently alter the user's objective.

## 14. Data quality rules

Every learned datum should be tagged conceptually as one of:

- FACT: directly observed from execution/API/system state
- USER_REQUIREMENT: explicitly requested by the user
- RESEARCH_SNAPSHOT: externally researched and date-sensitive
- INFERENCE: reasoned conclusion from observations
- HYPOTHESIS: unvalidated idea worth testing
- DECISION: currently chosen product/architecture direction
- REJECTED: evaluated and deliberately not selected

Future agents must not promote an inference or research snapshot to a permanent fact without validation.

## 15. Current gaps

The current POC still needs:

- persistent database
- durable scheduling across restarts
- versioned task definitions
- structured planner schema
- provider health/cooldown persistence
- quota/budget policies
- cost tables/catalog refresh
- authentication
- secure credential management
- connectors (search, HTTP, email, notifications)
- structured run-step timeline
- approval gates for side effects
- context retrieval/summarization instead of simple recent-output concatenation
- tests/failure injection

These gaps should guide the next implementation milestones rather than restarting ideation from zero.
