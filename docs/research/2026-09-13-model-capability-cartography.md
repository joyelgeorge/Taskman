# Mapping where a model is actually competent

Researched 2026-09-13, from a direction raised by the operator: that the real
opportunity is in the *tweaks and probes that reveal where a model's genuine
trained competence lies* — as against models "pretending to know everything,"
where everything sounds the same whether or not it is.

Verdict up front: **the core observation is correct and is now empirically
documented. It is not undiscovered — but the discovered version has been
packaged in the two least useful ways, and the useful packaging does not exist.**

Per `docs/READ-FIRST.md`: this document produces no settlement row. It is a
demand pass on a direction, before any of it is built.

---

## 1. The observation, and its standing in the literature

The operator's claim, stated precisely:

> A model's **fluency is uniform. Its competence is not.** Nothing in the output
> distinguishes the region where it is genuinely deep from the region where it is
> thinly generalising, because the prose is equally good in both.

This is correct, it is measured, and the mechanism is understood:

- Teams that ship without measuring calibration get **"a uniform high-confidence
  stream that fails silently at the top of the curve"** — the model says 95% sure
  and is wrong 30% of the time. A stated confidence is a generated token
  sequence, not an internal probability, and **RLHF rewards the
  confident-sounding sequence over the hedged one.** The flatness is trained in,
  not incidental.
- The competence underneath is measurably lumpy at fine grain: in medical QA,
  **inter-specialty calibration differences reach 0.10**, and the authors
  explicitly warn that evaluations "often treat medical knowledge as a uniform
  entity" when it is not.
- The failure survives expert-level aggregate performance: a model that **beats
  expert chemists on average still misses elementary safety and
  analytical-chemistry questions, and reports its wrong answers with the same
  confidence as its right ones.**

So the phenomenon is real. Prior art is substantial — ConfidenceBench, a
33-model atlas of domain-level metacognitive monitoring, an active calibration
literature with established method (logprob aggregation, semantic entropy across
paraphrase ensembles, Brier scoring against held-out labels).

**Correcting the premise where it needs correcting:** this cannot be approached
by asking the model how it was made. I have no privileged access to my own
training — no weights, no data mixture, no introspective channel. Anything a
model says about its own internals is inference from the same public material
available to anyone, delivered in the same confident register as everything else.
Which is, precisely, the problem under discussion. The method therefore has to be
**black-box and empirical: probe behaviour, measure, do not ask.** That is not a
setback. It removes the dependency on information nobody outside the lab has.

## 2. Where the actual gap is

The phenomenon is known. Follow who has done what with it:

**Academia publishes the aggregate.** Papers score *models* across *benchmark
domains*. A builder deciding whether to trust a model on one narrow task cannot
read off an answer; "GPT-class models are overconfident on distractors" does not
tell them whether their extraction pipeline is in deep water.

**Vendors sell the laboratory.** The eval tooling market is real, funded and
consolidating — LangSmith, Arize and Braintrust have "pulled away from the pack."
Braintrust Pro is **$249/month** (5 GB, 50k scores, overage $3/GB + $1.50/1k
scores); LangSmith Plus is **$39/seat** with 10k traces, overage $2.50 per 1k.

But note precisely what that money buys: **a laboratory, not a result.** You
bring your own task, your own labelled data, your own judgement about what to
measure, and you run the experiment yourself. The pricing is metered on *your
experiments running* — traces and scores — which is the tell.

So: academia sells the aggregate nobody can act on. Vendors sell the apparatus
to derive your own answer at your own cost. **Nobody sells the answer.**

That is the gap, and it is the same shape as the finding in
`2026-09-13-data-api-directions-verdict.md`: the scarce good is the **verdict**,
not the capability to produce one. This direction is not a tenth idea. It is a
concrete instantiation of the abstract one — a capability map *is* a verdict
asset: expensive to derive, cheap to copy once derived, and valuable chiefly
when it is **negative** ("do not trust it here"), which is exactly the class of
knowledge that currently gets thrown away.

## 3. The properties that make it better than A–D

Scored on the test that killed the data/API directions — *what is the barrier,
and is it code or is it access?*

| | Data/API ideas (A–D) | Capability cartography |
|---|---|---|
| Barrier | Code — now ~free | Partly code, partly **cost-to-derive** |
| Freshness | Data refreshes; product doesn't decay | **Every model release invalidates the map** |
| Revenue shape | One-shot per call, racing to $0.005 | **Recurring — the map must be re-run** |
| Negative results | Worthless | **The main product** |

The decay property is the interesting one, and it is unusual. Most information
products rot into commodities — the HN dataset died precisely because the
publisher archives it free forever. A capability map has the opposite dynamic:
it is **wrong within months by construction**, because the frontier ships. That
converts what is normally a weakness into the basis for a subscription, and it
means a competitor's year-old map is not competition.

The cost-to-derive is a genuine, if modest, barrier: probing many models across
many task-shapes with paraphrase ensembles is inference spend. It is not an RBI
licence, but it is not zero either, and it is the kind of barrier that rises with
the rigour of the map rather than falling.

## 4. The honest case against

- **The observation is not proprietary.** It is in published papers. Anyone
  reading the same literature reaches it. The edge, if any, is in execution and
  packaging, not in the insight.
- **The tooling market is funded and consolidating.** Three players have pulled
  away. Selling *tools* into that is a losing fight for a solo builder — which
  is fine, because the proposal is explicitly to sell results instead, but the
  adjacency means the incumbents can move into results whenever they choose.
- **Selling verdicts remains unvalidated.** Nobody has been shown to pay for a
  capability map. Braintrust's $249/month proves people pay to *run* evals; it
  does not prove they will pay for someone else's conclusions, and there are
  respectable reasons they might not (their task is idiosyncratic; trust in an
  outside map is itself a rights-and-trust problem).
- **It is dangerously easy to build supply here.** Probing models is fun,
  endless, and produces impressive artefacts that no one has asked for. This is
  the exact failure mode documented in `docs/WHY-NO-MONEY-YET.md` — a loop that
  closes inside the machine and reports success at every step. If this direction
  is taken up, the counterparty must be required *before* the map is built, not
  after.

## 5. Cheapest real test

Do not build a general capability atlas. That is the supply trap wearing a new
hat.

Instead, **map one narrow task-shape where being wrong is expensive and the
ground truth is checkable**, and offer the finished verdict to people already
building on it. The measurement to take is not "is the map interesting" — it is
whether anyone pays for a conclusion they did not derive.

The first probe subject is available at zero cost and zero permission: **this
repository's own decisions.** Thirteen lanes died (see
`2026-09-13-every-lane-that-died.md`), several of them because a confident model
assertion went unchecked — `escrow: true` and `pSuccess: 0.95` asserted on
opportunities with no source; a territory held ACTIVE while its own note recorded
a measurement of zero. Those are not abstract calibration failures. They are
logged instances of uniform confidence over non-uniform competence, with the cost
attached in commits.

That makes a defensible first artefact: not "here is a model atlas," but **"here
is what flat confidence cost one autonomous system, measured in its own git
history, and here is where the model was reliably right versus reliably
plausible."** It is derived from evidence already held, it is the kind of
negative result nobody publishes, and producing it costs a day rather than a
quarter.

## Sources

- [Future AGI — evaluating LLM confidence and uncertainty, 2026](https://futureagi.com/blog/evaluating-llm-confidence-uncertainty-2026/)
- [Domain-level metacognitive monitoring in frontier LLMs: a 33-model atlas](https://arxiv.org/pdf/2605.06673)
- [ConfidenceBench — evaluating confidence calibration in LLMs](https://arxiv.org/html/2607.20526)
- [Mind the confidence gap: overconfidence, calibration and distractor effects](https://arxiv.org/pdf/2502.11028)
- [Calibration of self-reported confidence and accuracy in medical QA](https://pmc.ncbi.nlm.nih.gov/articles/PMC13309378/)
- [Kili — domain-specific LLM benchmarks, 2026 vertical AI map](https://kili-technology.com/blog/domain-specific-llm-benchmarks-guide)
- [Openlayer — LLM-as-judge evaluation guide](https://www.openlayer.com/blog/llm-as-judge-evaluation-guide)
- [Braintrust vs LangSmith, 2026 pricing math](https://dev.to/bean_bean/braintrust-vs-langsmith-is-249mo-worth-it-the-may-2026-math-2i2a)
- [LangSmith vs Arize vs Braintrust, 2026 comparison](https://anudeepsri.medium.com/langsmith-vs-arize-vs-braintrust-e397e4728a76)
