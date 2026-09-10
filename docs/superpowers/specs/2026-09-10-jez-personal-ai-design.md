# Jez — Personal AI Design

_Date: 2026-09-10 · Status: approved design, not implemented_

## 1. Purpose

Jez is a personal AI that grows more useful the more it is used, and that its
owner controls end to end: the corpus, the adapter, the gateway, and the
deployment.

It is **not** a model trained from scratch. Pretraining a competitive base model
costs $10M+ in compute and is out of reach. Jez starts from open pretrained
weights and owns everything above them.

The property that makes Jez "his own" is not the weights. It is:

- the **corpus** — every AI interaction, captured and retained;
- the **adapter** — a LoRA periodically trained on that corpus;
- the **gateway** — the code that routes, retrieves, and records;
- the **portability** — no component is locked to a vendor.

`docs/BRAIN_ARCHITECTURE.md` states that Taskman "does not build a new AI model"
and instead "uses the best available external intelligence and APIs." Jez does
not contradict that: Taskman's Brain decides *what* to ask, and Jez is *what it
asks through*. The Brain keeps choosing the best external model; Jez makes every
such call accumulate into an asset.

### Non-goals

- Pretraining a base model.
- Competing with frontier labs on general capability.
- Multi-tenancy. Jez is single-user.
- Using consumer AI subscriptions programmatically (see §3).

## 2. Constraints

| Constraint | Consequence |
|---|---|
| **Zero recurring cost** | Free tiers only, across every component. |
| **Cloud-hosted** | Not laptop-dependent; reachable from anywhere. |
| **Public URL, personal use** | Public endpoint, single-user allowlist auth. |
| **Encrypted at DB and table level** | Application-level AES-256-GCM; the DB provider cannot read content. |
| **Own private repo** | Separate blast radius from Taskman. |
| **Full scope recall every call** | A memory hierarchy with an always-injected Core + Scope block (§8). |

## 3. Rejected: subscriptions as a backend

Claude Pro/Max, ChatGPT Plus, and Gemini Advanced do not permit programmatic
access. Routing them through a gateway requires extracting browser session
tokens and impersonating the client app. This violates their terms, risks
account termination rather than rate-limiting, and breaks whenever the auth flow
changes.

Jez uses free **API** tiers instead, which are permitted and sufficient. The
owner continues using his subscriptions in their own apps; Jez captures API-key
traffic and its own calls.

## 4. Trust model

Retrieval requires plaintext. Similarity search over ciphertext is not
practical. Therefore something must hold the key, and the design names it
explicitly rather than claiming an "end-to-end" that does not exist.

| Posture | Who can read the corpus | Personalization |
|---|---|---|
| True E2E (key in browser) | Only the owner | Impossible |
| **App-holds-key (chosen)** | Only the gateway process | Works |
| Provider-managed at rest | Provider + anyone with DB creds | Works |

**Chosen: app-holds-key.** The database is a ciphertext store; Neon cannot read
prompts, responses, or embeddings. The gateway is the single trust boundary.

**Accepted residual risks**, stated so they are not discovered later:

1. Gateway compromise exposes the corpus. It holds the key by necessity.
2. Plaintext metadata (§6) leaks working hours, model choice, and spend.
3. Free-tier inference providers see prompt content in transit. Encryption
   protects storage, not the fact that a third party runs the model.

## 5. Architecture

```
      owner ──HTTPS──┐
   owner's tools ────┤
                     ▼
          ┌────────────────────────┐
          │   jez-gateway          │  ◄── sole holder of the decryption key
          │  wire · auth           │
          │  retrieve · route      │
          │  capture · crypto      │
          └───┬────────────┬───────┘
              │            │
     ┌────────▼──────┐  ┌──▼─────────────────┐
     │ free-tier     │  │ owner's API keys   │
     │ fallback chain│  │ (Anthropic/OpenAI) │
     └───────────────┘  └────────────────────┘
              │
     ┌────────▼────────┐      ┌────────────────┐
     │ Neon Postgres   │◄─────│ jez-trainer    │
     │ (ciphertext)    │      │ Kaggle, on demand│
     └─────────────────┘      └────────────────┘
              ▲
     ┌────────┴────────┐
     │    jez-ui       │  static SPA → gateway only
     └─────────────────┘
```

### Components

| # | Component | Host | Cost |
|---|---|---|---|
| 1 | `jez-gateway` — runtime: wire, auth, retrieval, routing, capture, crypto | Render free (scale-to-zero) | $0 |
| 2 | `jez-db` — corpus, ciphertext only | Neon free | $0 |
| 3 | `jez-ui` — single-user console | Firebase Hosting | $0 |
| 4 | `jez-brain` — inference via free-tier fallback chain | Gemini / Groq / Cerebras / OpenRouter / GitHub Models | $0 |
| 5 | `jez-trainer` — periodic LoRA job | Kaggle notebooks (~30 GPU hrs/week) | $0 |
| 6 | `jez-keys` — master key | Render secrets | $0 |
| 7 | `jez-distiller` — batched memory extraction | free tier, separate provider bucket | $0 |

**Total: $0/month.**

### Verified free-tier limits

_Checked 2026-09-10. Free tiers move; re-verify before build and quarterly after._

| Service | Verified limit | Consequence for Jez |
|---|---|---|
| **Gemini** (AI Studio) | Flash-Lite 15 RPM / 1,000 RPD; Flash 10 RPM / 250 RPD; **250k TPM shared**; Pro removed from free tier Apr 2026 | Highest token headroom → **primary for memory-heavy calls** |
| **Groq** | 30 RPM, **6k TPM**, 14,400 RPD (no card) | TPM is the binding limit → **short calls only** |
| **GitHub Models** | 10 RPM / 50 RPD high-tier, 150 RPD mini, **8k in / 4k out per request** | Hard context cap → **fallback, small contexts** |
| **OpenRouter** | 20 RPM; **50 RPD unfunded** (1,000 RPD after $10 lifetime) | Too thin to be primary → **last resort** |
| **Render** | Free web service, 750 instance-hrs/mo per workspace, spin-down at 15 min, ~1 min wake. **Free Postgres expires after 30 days** | Gateway host. **Never use Render Postgres** |
| **Neon** | **0.5 GB storage**, 100 CU-hrs/mo, scale-to-zero at 5 min | Storage is the real corpus ceiling (§6) |
| **Kaggle** | ~30 GPU-hrs/week, T4/P100, 12-hr sessions | Sufficient for LoRA runs |
| **Firebase Hosting** | Free tier | UI |

**Two traps found during verification:**

1. **Enabling billing on a Google Cloud project destroys its free tier.** Jez's
   Gemini project must stay billing-disabled, permanently.
2. **Render's free Postgres self-destructs at 30 days.** It is not a database,
   it is a demo. Neon holds the corpus.

**Rate limits are not uniform, so the router must be budget-aware.** A 1,500-token
memory block against Groq's 6k TPM allows roughly four calls per minute. The same
block against Gemini's 250k TPM is free of concern. Provider choice is therefore a
function of the request's token size, not just availability — see §8.

### Costs of "free", honestly

1. **Cold starts.** Scale-to-zero adds ~30–60s to the first call after idle,
   including corpus decrypt. Acceptable for personal use. Removable later with a
   keep-warm ping or ~$7/mo.
2. **Rate limits.** Free tiers cap requests per minute and per day. This is why
   the fallback router is Layer 1 rather than a later refinement — without it,
   Jez stops working when one provider says no.
3. **Free tiers change.** Limits and availability must be re-verified before
   build and periodically after.

## 6. Encryption

Node's built-in `crypto`. No new dependencies.

- **Cipher:** AES-256-GCM, random 96-bit IV per record.
- **Envelope:** a master key in Render secrets wraps per-table Data Encryption
  Keys. Master rotation rewraps DEKs without touching rows.
- **AAD** bound to `table_name || record_id`, so ciphertext moved between rows
  fails to decrypt.
- **`key_version`** column on every encrypted table for incremental rotation.
- The master key never appears in the repo, the database, or a log line.

**Encrypted:** `system`, `messages`, `response`, memory `text`, and `embedding`.

Embeddings are encrypted deliberately. Embedding-inversion research recovers
substantial source text from vectors alone; storing plaintext vectors beside
encrypted text would return most of what the encryption protects.

**Plaintext** (required for queries and cost analytics): `id`, `created_at`,
`source`, `backend`, `model`, `tokens_in`, `tokens_out`, `cost_usd`,
`latency_ms`, `status`, `key_version`.

### Consequence: no server-side vector index

Encrypted embeddings rule out pgvector. The gateway loads the corpus at boot,
decrypts once into RAM, and searches in-process.

- ~50k memories ≈ 150MB RAM, single-digit-ms cosine search. Acceptable.

**Correction from verification: RAM is not the binding ceiling — Neon's free
0.5 GB of storage is.** At roughly 4 KB of encrypted text plus ~3 KB for a
768-dimension float32 embedding, one exchange costs ~7 KB, so 0.5 GB is exhausted
near **70k exchanges** — well before the RAM limit is approached.

Three consequences, decided now rather than discovered at the wall:

1. Store embeddings as **raw `bytea`**, never base64, which would add ~33%.
2. Use **truncated (Matryoshka) embeddings at 256 dimensions** where the model
   supports it, cutting embedding storage roughly threefold at minor recall cost.
3. Adopt a **retention policy at Layer 2**: archival exchanges age out to cold
   storage once distilled, since their extracted memory is what carries forward.
   Distillation is what makes deletion safe.

## 7. Data model

Numbered migrations. Dual storage (memory + Postgres) per Taskman convention,
verified by a schema-code agreement test.

**`jez_exchanges`** — one row per call.

| Column | Type | Encrypted |
|---|---|---|
| `id` | uuid pk | no |
| `created_at` | timestamptz | no |
| `source` | text — originating tool | no |
| `backend` | text — provider used | no |
| `model` | text | no |
| `system` | bytea | **yes** |
| `messages` | bytea (jsonb plaintext) | **yes** |
| `response` | bytea | **yes** |
| `tokens_in` / `tokens_out` | int | no |
| `cost_usd` | numeric | no |
| `latency_ms` | int | no |
| `status` | text | no |
| `redacted` | bool | no |
| `key_version` | int | no |

`cost_usd` is load-bearing: it is current spend now, and later the evidence of
what Jez saves once it serves calls itself.

**`jez_memories`** — one row per retrievable chunk.

| Column | Type | Encrypted |
|---|---|---|
| `id` | uuid pk | no |
| `exchange_id` | uuid fk | no |
| `text` | bytea | **yes** |
| `embedding` | bytea (float32 array) | **yes** |
| `tier` | text — core/scope/episodic/semantic | no |
| `valid_from` | timestamptz | no |
| `supersedes` | uuid null | no |
| `superseded_by` | uuid null | no |
| `provenance` | text | no |
| `created_at` | timestamptz | no |
| `key_version` | int | no |

**`jez_adapters`** — one row per trained LoRA: version, base model, corpus
cutoff, eval scores, artifact URI, active flag.

## 8. Gateway

### Wire compatibility

Two endpoints so existing tools work unchanged:

- `POST /v1/messages` — Anthropic-compatible (`ANTHROPIC_BASE_URL`)
- `POST /v1/chat/completions` — OpenAI-compatible (`OPENAI_BASE_URL`)

Both normalize into one neutral `Exchange` shape. Backends implement a single
`send(exchange, { stream })`, which is what makes provider migration a config
change.

### Request lifecycle

```
receive → retrieve → route → backend
                                ↓
   caller ← stream out ← tee ───┘
                          ↓
                    capture (async)
```

### Invariants

1. **Jez must never be the reason a call fails.** Every step except *route* and
   *backend* degrades to pass-through on error. Embedder down → retrieval
   skipped. Database down → capture spooled to disk and replayed. A gateway that
   adds a failure mode to the whole AI stack is worse than no gateway.
2. **Response bytes are never rewritten.** Jez modifies requests only. Rewriting
   responses breaks tool-use and streaming parsers in ways that are expensive to
   diagnose.
3. **Capture never blocks the response.** It runs after the stream closes.
4. **Every AI call is captured.** Capture scope is AI calls only; tool, file,
   and Taskman data events are explicitly out of scope for now.

### Fallback router (Layer 1)

An ordered provider chain with per-provider token buckets. On rate-limit or
failure, Jez advances to the next provider and records which one served the
call. Requests carrying the owner's own API keys bypass the chain.

**Selection is budget-aware, not merely ordered.** Verification showed the free
tiers differ by two orders of magnitude in tokens-per-minute (Groq 6k, Gemini
250k) and that GitHub Models refuses anything over 8k input tokens outright. The
router therefore estimates the request's token size — prompt plus injected
memory — and eliminates providers that cannot serve it *before* choosing. Sending
a memory-rich request to Groq is a guaranteed 429, not a fallback.

Provider health and remaining quota are tracked per provider so the chain
degrades predictably rather than randomly.

### Memory (Layer 2)

**Requirement:** every AI interaction is monitored and folded back into memory,
so that Jez holds the whole scope on every call rather than starting cold.

**Constraint that shapes it:** "whole scope" cannot mean "send everything."
A corpus of 50k exchanges is tens of millions of tokens; free-tier providers
have the smallest context windows and the tightest limits. It would also not
help if it were possible — long contexts lose their middle, and standing facts
get buried under irrelevant ones. Scope is achieved by **distillation**, not
volume.

Flat top-k similarity is therefore insufficient on its own. It finds exchanges
*resembling* the question, and so systematically misses standing facts that are
always relevant and never resemble anything.

#### Hierarchy

| Tier | Holds | Injected |
|---|---|---|
| **Core** | Identity, active projects, standing preferences, hard constraints | **Always** |
| **Scope** | Live state: open threads, recent decisions, current focus | **Always** |
| **Episodic** | Per-session summaries | On relevance |
| **Semantic** | Extracted facts, entities, relationships | On relevance |
| **Archival** | Full verbatim corpus | Retrieval only |

Core + Scope are what produce continuity: always present, so Jez never restarts
cold and never re-asks what it was told last week. The rest is fetched on demand.

#### Token budget

Injected memory becomes input tokens on the outbound call. Data that tunnelled
through Jez is free to *hold* — no second call is needed to fetch it — but it is
not free to *send*. On free tiers the binding constraint is tokens-per-minute
and requests-per-day, not money.

- **Core + Scope: ~800–1500 tokens, adaptive, hard-capped**, sized to the
  target model's window and the question.
- Retrieved tiers are added only up to a per-request ceiling.
- The budget is a rate-limit budget. Exceeding it costs no money and does not
  fail loudly; it throttles, which is worse.

#### Distiller

After an exchange closes, `jez-distiller` extracts durable facts, updates Scope,
and writes an episodic summary.

- **Batched and idle-triggered**, never per-call, and never on the response path.
- Runs on a **different free provider than the interactive chain**, so
  background memory work does not consume the quota being actively used.
- Embeddings use a **separate free endpoint** with its own quota, so retrieval
  does not compete with inference either.

#### Supersession

Memory entries are **superseded, not appended**. Each carries validity,
provenance, and a `supersedes` link. On conflict the newer fact wins and the
older is retained as history, not as truth.

This is not a refinement. Taskman's own `CLAUDE.md` records that the audit lane
moved from a flat $20 fee to 20% contingency, with the old PayPal `/20USD` link
explicitly marked as a leftover not to use. An append-only memory would hand a
future model both prices with equal confidence. Without supersession Jez becomes
less reliable the longer it runs, which inverts the purpose of the system.

#### Separation of mechanisms

**Retrieval and training are different and must not be conflated.** Fine-tuning
teaches style, format, and behaviour; it does not reliably install facts, and
degrades the base model when pushed to try. Facts live in memory, which updates
continuously. Style lives in the adapter, trained periodically. This split is
the single most important correctness decision in the design.

### Redaction

`policy.js` scrubs credential-shaped strings before any row is written; the
`redacted` flag records that it fired. The corpus must never contain a live key.

## 9. Auth

Public URL, single-user allowlist.

- **UI:** passkey (WebAuthn) or GitHub OAuth. No passwords — a public endpoint
  holding every prompt ever written is a credential-stuffing target from day one.
- **Programmatic:** API keys, stored hashed, prefix-searchable, revocable.
- Every request is authenticated. There is no anonymous path.

## 10. UI

Static SPA, four screens:

1. **Ask** — chat with Jez, showing which memories were retrieved and why.
   Visible retrieval is what makes the system trustworthy rather than magical.
2. **Corpus** — browse, search, correct, and delete captured exchanges. Deletion
   is the only way to remove something wrong or sensitive before it trains.
3. **Spend** — cost per model per day; share of calls Jez served itself and what
   that saved.
4. **Growth** — eval scores per adapter version, and the domains where Jez
   underperforms. This answers "which areas need to grow."

## 11. Training loop

Runs on demand, not continuously.

1. Export corpus slice since the last adapter's cutoff; decrypt locally.
2. Filter: drop failures, redacted rows, and low-signal exchanges.
3. Train a LoRA on the chosen open base model (Kaggle free GPU).
4. Evaluate against a held-out set **and** the previous adapter.
5. Publish only if it wins. Record the result in `jez_adapters` either way.

**A new adapter is never promoted on faith.** Regression is the normal outcome
of fine-tuning on small data, and the eval gate is what keeps Jez improving
rather than drifting.

## 12. Repository

New **private** GitHub repo, `jez` — separate from Taskman.

The reason is security, not taste: Jez is public-facing with its own attack
surface and secrets, while Taskman is the revenue engine. A shared repo and
pipeline means one compromise reaches both.

Conventions carried over from Taskman: ESM, `node:test`, dual memory/Postgres
storage, numbered migrations, minimal dependencies.

CI (GitHub Actions): tests → migration check → secret scan → deploy gateway to
Render and UI to Firebase.

## 13. Build order

Each layer is independently useful and depends only on the one before it.

| Layer | Delivers | Why this order |
|---|---|---|
| **1. Capture** | Gateway, wire compat, auth, crypto, DB, fallback router | Nothing works without a corpus; the router is required for free tiers to function |
| **2. Memory** | Tiered memory, distiller, supersession, encrypted in-RAM search, Core+Scope injection | Jez holds the whole scope on every call |
| **3. UI** | Ask, Corpus, Spend | Inspect and correct what was captured |
| **4. Route** | Quality-aware routing to Jez's own model | Measure what Jez can already do |
| **5. Train** | LoRA, evals, adapter versioning | Requires accumulated data |
| **6. Growth** | Gap analysis | Requires eval history |

## 14. Open questions

1. ~~Free-tier limits must be verified.~~ **Resolved 2026-09-10** — see §5.
   All eight services confirmed viable. Four differed materially from the
   assumption and the design was corrected: Neon storage is the true corpus
   ceiling, Render's free Postgres expires, OpenRouter is too thin to be
   primary, and per-provider TPM spread forces a budget-aware router.
   Re-verify quarterly.
2. **Which tools will honour `ANTHROPIC_BASE_URL`?** Subscription-authenticated
   clients may refuse a third-party base URL. If most do, the corpus grows only
   from API-key traffic and Taskman's own calls, which materially weakens the
   plan. **Worth a half-day spike before building.**
3. **Base model choice** for the adapter — deferred until Layer 5, when eval
   data exists to decide it.

## 15. Success criteria

- **Layer 1:** every AI call routes through Jez and is stored encrypted; a
  rate-limited provider does not interrupt service.
- **Layer 2:** Jez answers with context the base model could not have known.
- **Layer 4:** a measurable share of calls served without a vendor.
- **Layer 5:** an adapter that beats the base model on a held-out set drawn from
  the owner's own work.
- **Throughout:** $0/month, and no vendor whose loss would cost more than an
  afternoon.

## 16. Capability roadmap

The six build layers (§13) deliver the *system*. This roadmap describes the
**capabilities** that system is a path toward, and — more importantly — the gate
each one has to pass before it is worth attempting.

Every gate is a measurement, not a date. A capability is attempted when its
predecessor produces evidence, not when it seems exciting.

| Stage | Capability | Requires | Gate |
|---|---|---|---|
| **C0** | Captured intelligence — every call recorded, encrypted, attributable | Layer 1 | Calls route through Jez without added failure |
| **C1** | Continuous recall — Jez holds the whole scope across tools and sessions | Layer 2 | Answers that depend on facts the base model could not know |
| **C2** | Transparent self — corpus visible, correctable, deletable | Layer 3 | Owner can find and fix a wrong memory in under a minute |
| **C3** | Economic routing — cheapest adequate model per request | Layer 4 | Measured share of calls served without a frontier vendor |
| **C4** | Acquired voice — a LoRA that answers in the owner's idiom | Layer 5 | Adapter beats base model on a held-out set of the owner's work |
| **C5** | Self-knowledge — Jez reports which domains it is weak in | Layer 6 | Gap report predicts real eval failures |
| **C6** | Tool use — Jez calls tools, not just text | C1 + C3 | Multi-step task completed unaided end to end |
| **C7** | Taskman operator — reads ledger and lanes, proposes next action | C6 | A proposal a human accepts without editing |
| **C8** | Distillation — frontier answers become adapter training data | C4 + C5 | Adapter closes a measured gap on a named domain |
| **C9** | Owned inference — the brain runs on infrastructure the owner controls | C8 + demand | Quality within tolerance of the free tiers it replaces |

### The specialization, restated

The original objective was an AI specialized in making money. That
specialization does **not** come from prompting a model to be
business-minded — it comes from **C7 and C8 together**: an AI whose
training data is the owner's own revenue work, wired to the ledger that
records whether the work paid.

Taskman already holds settlements, lanes, bounty triage, and outreach.
Jez's corpus adds the reasoning that produced them. An adapter trained on
both is specialized in a way no general model is, because no general model
has the data.

Per `taskman-verify`: **that specialization is a hypothesis until an eval
shows it, and revenue is zero until `settlements` has rows.** This roadmap
describes a path, not an outcome.

### What would end this project honestly

Written down now, while it is cheap to be objective:

- **Open Question 2 fails** — no tool will route through Jez, so the corpus
  grows too slowly for C4 to ever have training data.
- **C4 never passes its gate** — adapters keep losing to the base model,
  meaning the corpus is too small or too noisy to teach anything.
- **Free tiers close** — the $0 constraint breaks, and the project must be
  re-justified against a real monthly cost.

Reaching C3 alone would still be worth the build: a private, encrypted,
vendor-portable record of every AI interaction, with a router that keeps it
free. Everything past C3 is upside.
