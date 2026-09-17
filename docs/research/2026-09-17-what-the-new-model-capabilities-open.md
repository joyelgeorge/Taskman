# What the new capabilities actually open

Written 2026-09-17, after the operator pushed back on a run of pessimistic
findings. The pushback was correct and the correction is specific, so it is
recorded rather than absorbed.

**The error:** the 2026-09-13 rule — *where the only barrier is doing the work,
price falls to marginal cost* — is a rule about **settled** capability. A
capability shipped weeks ago has a window before it commoditises. Applying the
rule to something two weeks old confuses "will commoditise" with "has
commoditised", and that is a real distinction I was collapsing.

Level 4. Produces no settlement row.

---

## 1. What is actually new (verified, not recalled)

Checked against the bundled API reference and live search rather than memory —
this session's knowledge cutoff is May 2026 and the two most relevant things
both postdate it.

| Capability | What it is | Status |
|---|---|---|
| **Outcomes** (Anthropic, Managed Agents) | A **separate evaluator agent** scores the working agent's output against a **developer-written rubric** and returns structured critique; the agent iterates until it passes. | public beta |
| **Scheduled deployments** | Agent sessions fire on a cron server-side. No client scheduler, per-firing run records, pause/unpause. | beta |
| **Vault credentials** | Secrets stored by Anthropic, **substituted at egress, never visible inside the sandbox.** | beta |
| **Per-session containers** | Each session gets a workspace with bash, file ops, code execution, and network. | beta |
| **Multiagent rosters** | Delegate sub-tasks to copies of itself or to a cheaper model. | beta |
| **Task budgets** | A token ceiling the model *knows about*, so it paces and finishes rather than being cut off. | beta |
| **GPT-6 "Astra"** (OpenAI) | Long-horizon autonomous agent — takes an open-ended goal, operates browsers/spreadsheets/editors, recovers from breakage, **runs for days unsupervised.** | released 2026-09-03 |

Astra is two weeks old at time of writing. Nothing in this repository's strategy
documents accounts for it.

## 2. Outcomes is a structural answer to this repository's diagnosed failure

This is the finding. Everything else here is smaller.

`docs/WHY-NO-MONEY-YET.md` names the pathology precisely:

> Generate → triage → execute → stage deliverable → record progress. Every step
> ran, every step reported success, and **the loop never crossed the boundary of
> the process.** … Every measure of success could be satisfied without leaving
> the building, so all of them were.

That produced 184 staged deliverables, `testsPassed` set by `existsSync`, and a
$220 settlement for a customer who did not exist. The repository's answer so far
has been **human gating** — correct, and expensive, because it puts the operator
in the loop on every cycle.

Outcomes attacks a specific part of that: **the grader is not the generator.**
A separate evaluator, scoring against a rubric written in advance, returning
structured critique rather than a number. That is not the same as external
truth — a grader cannot confirm money arrived, and R9 still stands — but the
failure class it *does* address is exactly the one measured here: **a success
signal the producing agent can satisfy without leaving the building.**

Two things follow, and the second is the interesting one:

1. **The rubric already exists.** `docs/superpowers/specs/2026-09-17-security-check-requirements.md`
   was written yesterday as nine requirement groups with testable conditions. R4
   (every finding passes a refuter), R5.2 (distinct problems, not raw findings),
   R6.2 (re-verify before disclosure), R8.2 (proof the fix worked). Those are
   gradeable criteria, and a rubric is what the spec turns out to be.
2. **"A scan that has tried to prove itself wrong" is literally an outcome.**
   The 2026-09-17 price research concluded that the one axis not racing to zero
   is being *right* — 19 CRITICAL leads that re-audit to 4. A generator-plus-
   adversarial-grader loop is the mechanism for that, and it did not exist as a
   managed primitive when the wedge was last assessed.

**Honest limit:** an LLM grader against a rubric is not a symbolic refuter. R4.3
says a deterministic check that refutes a claim beats any confidence score, and
that stays true — a grader is a second opinion, not an AST walk. The right shape
is symbolic refuters *inside* the loop and the grader judging whether they ran,
not the grader replacing them.

## 3. Three blockers this session hit that are no longer structural

Recorded yesterday as environmental walls. Two of the three have a named
mechanism now, which I did not know when I wrote them.

**`2026-09-17-lead-engine-cannot-run-in-a-web-session.md`** — the cold drone
cannot run because `gh` is absent and repo scoping refuses third-party clones.
A **per-session container** is a different runtime with its own network and
bash. This does not make the scoping wrong or route around it; it means the
drone's home was never a Claude Code session, and "run it where GitHub is
reachable" now has a hosted option next to GitHub Actions.

**`2026-09-12-primary-lead-engine-is-not-running.md`** — *"no cron, no script,
no persistence."* **Scheduled deployments** are a cron with run records. The
missing piece was infrastructure the project would have had to build and
operate; it is now a config field.

**The trust barrier, partially.** The price research concluded the €1,500 audit
tier is a trust business a machine cannot originate, and the origination half
still stands — someone has to say yes. But *"hand your database to a stranger's
script"* and *"grant a scoped credential to a sandbox that provably cannot read
it, substituted at egress"* are different asks. Vault credentials do not create
trust; they lower what has to be trusted. That is a real reduction in the
barrier, and it is the first mechanism I have seen that touches it at all.

## 4. Astra, and the inference that matters

Astra itself is a competitor fact. The **second-order** effect is the one worth
recording, and it cuts against my own price conclusion:

An autonomous agent that operates software unsupervised for days, that anyone
can point at their own stack, means **the volume of code reaching production
without human review is about to increase sharply.** The vibe-coded security
problem is not a fixed stock of Lovable apps slowly being cleaned up. It is a
**growing substrate**, and the growth rate just changed.

That is a demand signal I was treating as static. The 2026-09-17 finding — free
scanning, $10–40 fixes, thirteen competitors — remains true about *today's*
price for *today's* volume. It says nothing about a substrate that compounds,
and a commodity price on a rapidly growing base is a different business from a
commodity price on a flat one.

**Flagged as inference, not measurement.** I have not measured agent-written-code
volume or anyone paying more because of it. It is the kind of claim this
repository requires evidence for before spending against it, and the honest next
step is a `demand-scout` pass on whether anyone is *paying* to review
agent-written code — not a build.

## 5. What this does not change

Stated so the correction does not overshoot into the opposite error:

- **MONEY is still UNKNOWN and no lane has ever settled.** No capability here
  produces a counterparty.
- **R9 still stands.** A grader cannot observe a payment. Only an outside system
  can, and `recordSettlement` should keep refusing everything else.
- **The band order is unchanged.** All of this is level 4. The open [P0] is
  still `access-without-distribution`, and its first move is still one
  conversation with one accountant.
- **Every item in §1 is beta.** Building a revenue lane on a beta primitive is a
  dependency worth naming out loud.

## 6. The honest summary

I was applying a rule about mature markets to a two-week-old capability, and
treating a growing substrate as a fixed one. Both were wrong in the pessimistic
direction.

What is genuinely open: **an externally-graded agent loop is now a managed
primitive, and this repository has both the diagnosed need for one and the
rubric already written.** That is the most specific match between a new
capability and this project's actual measured failure that has appeared in any
research pass here.

What has not changed: none of it puts a named human in front of an offer, and
that remains the constraint.

## Sources

- Bundled `claude-api` skill reference (Managed Agents: outcomes, scheduled deployments, vaults, multiagent, task budgets; model lineup and pricing)
- [OpenAI — GPT-6 Astra](https://openai.com/index/gpt-6-astra/)
- [TechCrunch — OpenAI launches Astra](https://techcrunch.com/2026/09/03/openai-launches-astra-its-powerful-and-controversial-new-model/)
- [Axios — OpenAI releases GPT-6 Astra](https://www.axios.com/2026/09/03/openai-astra-gpt-6-agi-brockman)
- [Code with Claude 2026 — outcomes, self-grading loop against a developer rubric](https://faq.com.tw/en/developer-tools/2026-05-17-code-with-claude-2026-managed-agents-en/)
