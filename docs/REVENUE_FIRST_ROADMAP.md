# Taskman Revenue-First Execution Roadmap (Authoritative)

Updated: September 4, 2026  
Status: Authoritative Coordination Standard (Issue #160)

## Executive Summary
Taskman has transitioned beyond early discovery/scheduling experiments into a hardened, settlement-verified commercial platform. With the completion of the core revenue foundations, Taskman must not expand into speculative or generic AI agent domains until the primary commercial loop collects verified cash from real customers.

## Authoritative Execution Sequence
```text
P0-1  #154  Economic truth + first real customer cash proof (COMPLETED & MERGED, PR #161)
          ↓
P0-2  #155  Durable self-serve customer product & official CSV parsers (COMPLETED & MERGED, PR #162)
          ↓
P0-3  #156  First-10-customer acquisition/activation engine (COMPLETED & MERGED, PR #163)
          ↓
P0-4  #158  Authorized real external action + settlement proof (COMPLETED & MERGED, PR #164)
          ↓
P1-5  #157  Generalize successful payout-leakage rail (COMPLETED & MERGED, PR #173)
          ↓
P1-6  #159  API / accounting-firm / white-label scale (COMPLETED & MERGED, PR #174)
```

## Secondary Track Deliverables (All Completed & Merged)
- **#123 (PR #166)**: Instant read-only audit preview and time-to-value tracking (`src/instant-activation.js`).
- **#118 (PR #167)**: Benchmarked specialist and local worker models evaluation harness (`src/specialist-workers.js`).
- **#124 (PR #168)**: Versioned Taskman Skill Packs for narrow domains (`src/skill-packs.js`).
- **#125 (PR #169)**: Multi-actor contribution records and shareable verified outcome pages (`src/contribution-proof.js`).
- **#130 (PR #170)**: Leads & campaigns schema with probation budgets and epoch windowing (`packages/core/marketing/store.js`).
- **#131 (PR #171)**: Outreach-draft transform with deterministic safety gates (`src/transforms/outreach-draft.js`).
- **#137 (PR #172)**: FX-aware settlement conversion in finance report (`packages/core/finance/report.js`).
- **#85 (PR #175)**: Deployment compatibility, release schema manifest, and rollback safety (`src/deployment-compatibility.js`).

## Next Sprint Execution Priorities (P2 Enhancements)
1. **#139**: Replace hand-set signal thresholds with measured base rates across data collection series.
2. **#138**: Cold archive to Git — automated compaction and export of rolled-up observation data to Git repository storage.
3. **#134**: Finance report snapshot cron for historical trend analysis and dashboard charting (`finance_report_history`).
4. **#133**: Human-gated outreach review and send-tracking dashboard for reviewable drafts.
5. **#132**: Lead drones connecting public data collectors to `leads` table.
6. **#126**: Embed Taskman actions into native workflow tools (Slack, GitHub Actions, email triggers).

## Strategic Guardrails (What is Frozen)
Freeze unless new customer cash evidence dictates otherwise:
- Generic chatbot or unbounded coding-assistant interfaces
- Unbacked cryptocurrency/web3 micro-payment rails without clear customer demand
- Speculative bounty scrapers with zero verified settlement history
- Generic accounting features commoditized by incumbents (Dext, A2X, Ramp)
- Large workflow DAG abstractions prior to customer necessity

## Core Operating Rules for Autonomous Agents
Before taking on any task, every autonomous agent operating in Taskman must verify:
1. **Does this change increase the probability of real cash within the current roadmap?**
2. **Does it eliminate a concrete blocker to customer activation, execution, settlement, or collection?**
3. **Is the capability already implemented in the repository?**
4. **Is the outcome measured with settlement-cleared economic evidence rather than model confidence or estimate?**
5. **Does it preserve the strict 7-level economic truth taxonomy?**

If the answer to any of these is no, defer or reject the work.
