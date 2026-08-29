import { QUALIFICATION_PROFILES } from "./orchestration-profiles.js";
import { qualifyCandidate, normalizeCandidate } from "./qualification-engine.js";
import { exploreRevenueModels } from "./revenue-models.js";

const ID = "contractor-unbilled-work-capture";

function contribution(metrics, weights) {
  const rows = [];
  let weighted = 0;
  let positiveWeight = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const value = Number(metrics[key] || 0);
    const part = value * weight;
    weighted += part;
    if (weight > 0) positiveWeight += weight;
    rows.push({
      key,
      value,
      weight,
      weighted: Number(part.toFixed(3)),
      hardGate: false,
    });
  }
  const score = positiveWeight > 0 ? (weighted / positiveWeight) * 10 : 0;
  return { rows, weighted, positiveWeight, score: Number(score.toFixed(2)) };
}

function withHardGates(rows, hardGates) {
  const set = new Set(hardGates);
  return rows.map((r) => ({ ...r, hardGate: set.has(r.key) }));
}

function simulate(base, patch, profileName) {
  const metrics = { ...base, ...patch };
  const q = qualifyCandidate(normalizeCandidate({ metrics }), profileName);
  return {
    patch,
    score: q.score,
    passes: q.passes,
    hardGateFailures: q.hardGateFailures,
  };
}

export function analyzeUnbilledCapture() {
  const explored = exploreRevenueModels();
  const model = [...explored.survivors, ...explored.contenders, ...explored.blocked].find((m) => m.id === ID);
  if (!model) throw new Error("unbilled capture model missing");

  const profile = QUALIFICATION_PROFILES[model.profile];
  const parts = contribution(model.metrics, profile.weights);
  parts.rows = withHardGates(parts.rows, profile.hardGates);
  const gap = Number((profile.threshold - model.qualification.score).toFixed(2));

  const sensitivities = [
    simulate(model.metrics, { payoutCertainty: 0.85 }, model.profile),
    simulate(model.metrics, { executionAutonomy: 0.8 }, model.profile),
    simulate(model.metrics, { payoutCertainty: 0.8, executionAutonomy: 0.75 }, model.profile),
    simulate(model.metrics, { setupBurden: 0.2, timeToMoney: 0.85 }, model.profile),
  ].map((s, i) => ({
    label: [
      "Raise payoutCertainty to 0.85 (UPI collect + bank confirmation)",
      "Raise executionAutonomy to 0.80 (invoice+collect without a human)",
      "Both: auto-collect and less human (freeze path)",
      "Lower setup + faster first rupee only",
    ][i],
    ...s,
  }));

  return {
    id: ID,
    title: model.title,
    profile: model.profile,
    decision: model.decision,
    score: model.qualification.score,
    threshold: profile.threshold,
    gap,
    verdict:
      "Do not freeze-build as a global money-flow wedge. Treat as a local capture product: it converts work already done into a UPI collect. Hard gates pass. Weighted score is 0.56 below immediate_income_v1 freeze.",
    stateTransition:
      "open job (WIP) → mark done (unbilled rupees) → raise invoice + UPI collect → mark paid (collected). The home number is unbilled, not a to-do count.",
    moneyAlreadyEarned:
      "The leakage is finished work sitting in the contractor's head or WhatsApp, not future demand. That is why payerExists scores high: the client already accepted the job.",
    gates: parts.rows,
    weakest: [
      {
        key: "executionAutonomy",
        value: 0.55,
        note: "A person still confirms rupees landed. Taskman cannot mark paid from the bank. This is the structural ceiling unless a PSP webhook exists.",
      },
      {
        key: "payoutCertainty",
        value: 0.62,
        note: "Invoice ≠ money. Kerala workshop clients delay, pay partial, or pay cash. UPI intent does not settle itself.",
      },
      {
        key: "setupBurden",
        value: 0.4,
        note: "Negative weight: every extra field (GSTIN, items, e-invoice) makes this Vyapar. Keep one number and one action.",
      },
    ],
    freezePath: {
      needed: "Score ≥ 7.2 with no hard-gate failure.",
      whatWorks: sensitivities.filter((s) => s.passes),
      whatFails: sensitivities.filter((s) => !s.passes),
      implication:
        "Only auto-collect (payoutCertainty) plus less human confirmation (executionAutonomy) crosses freeze. A prettier invoice screen does not.",
    },
    unitEconomics: {
      example: "Kozhikode AC / fabrication workshop, 8–20 jobs/month.",
      conservativeUnbilled: "₹40,000–₹1,20,000 sitting done-not-billed at any time.",
      captureRate: "Pilot success = ≥30% of that unbilled becomes a UPI collect in 14 days.",
      taskmanTake: [
        "₹299–₹799/month SaaS if the unbilled number is the daily habit.",
        "Or 1–2% of collected invoices if they already have a PSP.",
        "Do not take a % of unbilled — that taxes work, not money.",
      ],
    },
    competitive: {
      notTheEnemy: "Tally/Busy/Zoho Books — they start at GST compliance.",
      realEnemy: "WhatsApp: 'Sir, payment pending' plus a handwritten chit. That is the current system of record.",
      whitespace:
        "Home screen = unbilled rupees. One tap = invoice + UPI. No inventory, no GST filing, no payroll. The moment we add those, whitespace dies.",
    },
    killIf: [
      "In a 14-day pilot, 'unbilled' is mostly jobs waiting for client approval — not forgotten work.",
      "Collection rate does not beat their WhatsApp follow-up by a clear margin.",
      "They already live in Vyapar daily and will not leave it for a second book.",
      "They refuse to put a UPI ID in settings — then there is no submission path.",
    ],
    smallestIntervention:
      "One workshop. Load real jobs for the last 30 days. Show unbilled. Raise invoices. Count rupees that land. No features beyond that.",
    nextValidation: model.nextValidation,
    sensitivities,
    captureFit: explored.capture.find((c) => c.id === "ledger-saas") || null,
  };
}
