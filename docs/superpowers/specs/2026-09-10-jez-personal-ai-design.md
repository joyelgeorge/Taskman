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

**Total: $0/month.**

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
- ~200k memories exceeds a free instance. At that point the search backend is
  replaced (encrypted local index, or a paid instance). **This ceiling is
  accepted, not solved, because reaching it is a year away and solving it now
  would be guesswork.**

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

### Fallback router (Layer 1)

An ordered provider chain with per-provider token buckets. On rate-limit or
failure, Jez advances to the next provider and records which one served the
call. Requests carrying the owner's own API keys bypass the chain.

Provider health and remaining quota are tracked per provider so the chain
degrades predictably rather than randomly.

### Retrieval (Layer 2)

Embed the latest user turn, cosine-search the decrypted corpus, inject the top-k
prior exchanges as a system-level `Relevant prior context` block.

**Retrieval and training are different mechanisms and must not be conflated.**
Fine-tuning teaches style, format, and behaviour; it does not reliably install
facts and degrades the base model if pushed to try. Facts live in retrieval,
which updates instantly on every call. This split is the single most important
correctness decision in the design.

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
| **2. Retrieve** | Embeddings, encrypted in-RAM search, context injection | Jez becomes personal |
| **3. UI** | Ask, Corpus, Spend | Inspect and correct what was captured |
| **4. Route** | Quality-aware routing to Jez's own model | Measure what Jez can already do |
| **5. Train** | LoRA, evals, adapter versioning | Requires accumulated data |
| **6. Growth** | Gap analysis | Requires eval history |

## 14. Open questions

1. **Free-tier limits must be verified before Layer 1.** Availability and quotas
   for Gemini, Groq, Cerebras, OpenRouter, GitHub Models, Render, Neon, and
   Kaggle change; the design assumes them but has not confirmed them.
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
