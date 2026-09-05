# Taskman Comprehensive Engineering Roadmap & Execution Plan

Date: September 4, 2026  
Status: Authoritative In-Repo Plan & Execution Ledger  
Tracking Core Milestones: P0, P1, and P2 Tracks

---

## 1. Executive Summary

Taskman has evolved from an experimental opportunity scanner into a hardened, deterministic, settlement-verified commercial engine. This document establishes the authoritative execution plan for all engineering initiatives, architecture invariants, completed milestones, and upcoming sprint phases across the repository.

---

## 2. Completed Milestones (P0 & P1 Tracks)

Every P0 and P1 issue has been implemented, validated with regression tests, committed, reviewed, and squash-merged into `main`:

### Phase 1: Core Governance & Execution Guardrails (P0)
- **#83 (PR #103)**: Usage metering, quota enforcement, and tier entitlements.
- **#121 (PR #140)**: Ingest live GitHub issues and PR state into actionable work queue.
- **#122 (PR #141)**: Dispatch eligible repo work to coding-agent adapter with automated PR ingestion.
- **#127 (PR #142)**: Self-improvement merge train with test-gated auto-merge and rollback.
- **#119 (PR #143)**: Decouple strategic AI/human supervision from execution (`src/supervision.js`).
- **#115 (PR #144)**: Relevance-first Context Compiler over durable memory (`src/context-compiler.js`).
- **#116 (PR #145)**: Evidence and reasoning cache with freshness tracking and invalidation.
- **#117 (PR #146)**: Economic model tiers and deterministic tier escalation (`src/model-router.js`).
- **#104 (PR #147)**: Fiverr bookkeeping and settlement reconciliation wedge.
- **#105 (PR #148)**: First paying customer profile and buying triggers definition.
- **#107 (PR #149)**: Freeze minimum customer stack; defer unbacked speculative rails.
- **#108 (PR #150)**: Customer onboarding UX and value-delivery dashboard.
- **#110 (PR #151)**: Value-linked billing rules engine (`src/value-billing.js`).
- **#111 (PR #152)**: Reusable customer template architecture (`src/customer-template.js`).
- **#112 (PR #153)**: Repeatable customer acquisition channel framework.

### Phase 2: Commercial Truth, Durability & Action Registry (P0 Batch 2)
- **#154 (PR #161)**: Repaired critical economic truth defect (platform fees are expense deductions, not recovered cash); implemented customer outcome confirmation flow and 7-level economic taxonomy.
- **#155 (PR #162)**: Durable customer persistence (`023_durable_customer_instances.sql`) and official CSV parsers (`src/fiverr-csv-parser.js`) with statement upload endpoints.
- **#156 (PR #163)**: 8-stage customer acquisition/activation funnel with automated CAC, payback period, and objection tracking (`src/acquisition-funnel.js`).
- **#158 (PR #164)**: Named action registry (`src/action-registry.js`), crash-consistent transactional outbox with idempotency (`RECONCILE_REQUIRED`), and expiring human approval gates (`SEND_CUSTOMER_INVOICE`).
- **#160 (PR #165)**: Authoritative revenue-first execution roadmap standard (`docs/REVENUE_FIRST_ROADMAP.md`).

### Phase 3: Fast Activation, Specialist Workers & Extensibility (P1)
- **#123 (PR #166)**: Instant read-only audit preview and time-to-value tracking (`src/instant-activation.js`).
- **#118 (PR #167)**: Benchmarked specialist and local model evaluation harness with automatic quality downgrades and fail-closed fallbacks (`src/specialist-workers.js`).
- **#124 (PR #168)**: Versioned, immutable Taskman Skill Packs for narrow domains with scoped context extraction (`src/skill-packs.js`).
- **#125 (PR #169)**: Multi-actor contribution records (Human, AI, Deterministic, External) and secret-sanitizing shareable verified outcome pages (`src/contribution-proof.js`).
- **#130 (PR #170)**: Leads and campaigns schema with probation budgets and epoch windowing (`packages/db/migrations/015_leads_and_campaigns.sql`, `packages/core/marketing/store.js`).
- **#131 (PR #171)**: Outreach-draft transform with deterministic safety gates (no fabricated numbers, no false authority, required sourcing disclosure and opt-out paths; `src/transforms/outreach-draft.js`).
- **#137 (PR #172)**: FX-aware settlement conversion in the finance report using ECB reference rates (`packages/core/finance/fx.js`, `packages/core/finance/report.js`).
- **#157 (PR #173)**: Generalized payout-leakage platform across marketplaces and payment gateways (`src/payout-leakage-platform.js`).
- **#159 (PR #174)**: B2B accounting-firm white-label and multi-tenant API platform (`src/firm-whitelabel-platform.js`).
- **#85 (PR #175)**: Deployment compatibility, release schema compatibility manifest, and rollback safety (`src/deployment-compatibility.js`).
- **#129**: Growth epic completed and closed.

---

## 3. Next Execution Track: High-Impact P2 Enhancements

The next sprint focuses on data durability, automated cold archiving, lead drones, and operational analytics:

### Task Group A: Data & Optimization Track (P2)
1. **Issue #139**: Replace hand-set signal thresholds with measured base rates across data collection series.
2. **Issue #138**: Cold archive to Git — automated compaction and export of rolled-up observation data to Git repository storage for free unlimited historical archiving.

### Task Group B: Growth & Outreach Operations Track (P2)
3. **Issue #134**: Finance report snapshot cron for historical trend analysis and dashboard charting (`finance_report_history`).
4. **Issue #133**: Human-gated outreach review and send-tracking dashboard for reviewable drafts.
5. **Issue #132**: Lead drones implementation connecting public data collectors to `leads` table.

### Task Group C: Distribution & Platform Track (P2)
6. **Issue #126**: Embed Taskman actions into native workflow tools (Slack, GitHub Actions, email triggers).

---

## 4. Phase 4: "Mean Money-Making Machine" (MMM) Commercial Expansion Track

The core platform has proven capabilities in identifying and executing specific financial retrieval tasks. The next evolution scales these into fully autonomous pipelines based on proven real-world business models.

### Task Group D: The AI SDR / Autonomous Outreach (B2B Expansion)
Inspired by Apollo.io, Artisan AI, and 11x.ai. B2B automated lead generation and personalized outreach campaigns, functioning as an autonomous outbound agency.
7. **Issue #161**: Introduce automated data enrichment capability (Clearbit/LinkedIn) for raw lead profiles.
8. **Issue #162**: Implement a fully autonomous, self-optimizing multi-step email drip sequencer.
9. **Issue #163**: Auto-schedule meetings and generate per-meeting commission billing models.

### Task Group E: E-Commerce / Marketplace Fee Recovery (Retail Arbitrage)
Inspired by Getida, Share a Refund. Expanding beyond Fiverr into massive E-Commerce hubs.
10. **Issue #164**: Amazon FBA / Shopify fulfillment fee statement ingester and dimension/weight cross-referencing.
11. **Issue #165**: Automated dispute case filing engine and case-status tracking dashboard.

### Task Group F: Corporate Grants & R&D Tax Recovery
Inspired by NeoTax, MainStreet. Capitalizing on complex, document-heavy bureaucratic recovery processes.
12. **Issue #166**: R&D tax credit eligibility screener over GitHub commits, Jira tickets, and payroll structures.
13. **Issue #167**: Automated compliance and filing document generation for standard government portals.

---

## 4. Technical Guardrails & Quality Gates

All future pull requests must strictly adhere to the following invariants:
1. **7-Level Economic Taxonomy**:
   - `identified_discrepancy_cents`
   - `reconciled_amount_cents`
   - `estimated_savings_cents`
   - `customer_confirmed_savings_cents`
   - `verified_cash_recovered_cents`
   - `invoiceable_amount_cents`
   - `cash_collected_cents`
2. **Zero Inline Styles or Scripts**: Strictly maintain CSP compliance in `public/` assets (`test/http-security.test.js`).
3. **Deterministic Failure Gating**: Models never validate themselves; post-conditions and schemas are deterministic.
4. **Isolated Tenant Memory**: Firm and customer instances must never leak cross-tenant records.
5. **Test Pass Rate**: Complete suite must pass cleanly (444 tests across all suites) before merging.
