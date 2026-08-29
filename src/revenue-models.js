import { normalizeCandidate, qualifyCandidate, missingCapabilities } from "./qualification-engine.js";
import { capabilitySnapshot } from "./orchestration-profiles.js";

/**
 * Alternative revenue models to the current money-flow leader
 * (cloud support-plan right-sizing). Do not revive rejected IDs.
 */
const EXCLUDED = new Set([
  "cloud-support-plan-right-sizing-engine",
  "authorization-validity-batch-close-timing-optimizer",
  "generic-prepaid-cloud-api-credit-refund-expiry-sentinel",
  "generic-music-royalty-reconciliation-recovery",
  "card-authorization-integrity-fee-prevention-engine",
]);

const CATALOG = [
  {
    id: "kseb-tod-demand-charge-right-sizing",
    title: "KSEB ToD / demand-charge right-sizing",
    family: "programmable_money_flow",
    profile: "programmable_money_flow_v1",
    sourceType: "structural_money_flow",
    moneyFlow: "Kerala industrial and workshop electricity: demand charges + time-of-day slabs on every monthly bill.",
    trigger: "Monthly bill PDF/email or smart-meter register. Recompute cheapest sanctioned load / ToD shift.",
    intervention: "Read bill + load profile; recommend KEEP / reduce sanctioned demand / shift process hours. No KSEB portal write.",
    monetization: "Share of verified demand-charge or ToD delta, or a small accepted-change fee.",
    whyNow: "No exact MSME product in Kerala that turns a bill into a signed kW/ToD decision. Energy consultants are annual, not monthly.",
    nextValidation: "Pull 12 months of KSEB industrial bills and measure how often the cheapest demand/ToD option actually changes.",
    requiredCapabilities: ["web.read"],
    metrics: {
      flowScale: 0.58,
      recurrence: 0.78,
      triggerIndependence: 0.62,
      permission: 0.82,
      deltaMeasurability: 0.84,
      monetization: 0.64,
      executionAutonomy: 0.56,
      competitiveWhitespace: 0.72,
      setupBurden: 0.38,
      timeToMoney: 0.55,
    },
  },
  {
    id: "gst-einvoice-gstr1-mismatch-recovery",
    title: "GST e-invoice vs GSTR-1 mismatch recovery",
    family: "programmable_money_flow",
    profile: "programmable_money_flow_v1",
    sourceType: "structural_money_flow",
    moneyFlow: "Indian GST: interest and late fee on mismatched e-invoices vs GSTR-1, plus blocked ITC.",
    trigger: "GSTN JSON + GSTR-1 due calendar.",
    intervention: "Diff IRN vs return lines; output exact tax/interest at risk. Filing still a CA.",
    monetization: "Per-mismatch fee or share of avoided interest — fights ClearTax/IRIS flat SaaS.",
    whyNow: "Money flow is real. Whitespace is weak: compliance suites already ingest GSTN.",
    nextValidation: "Check whether ClearTax/GSTHero already auto-flag IRN↔GSTR-1 diffs for MSME workshops.",
    requiredCapabilities: ["web.read"],
    metrics: {
      flowScale: 0.86,
      recurrence: 0.74,
      triggerIndependence: 0.76,
      permission: 0.58,
      deltaMeasurability: 0.88,
      monetization: 0.52,
      executionAutonomy: 0.42,
      competitiveWhitespace: 0.34,
      setupBurden: 0.62,
      timeToMoney: 0.48,
    },
  },
  {
    id: "whatsapp-template-block-spend-recovery",
    title: "WhatsApp template-block spend recovery",
    family: "programmable_money_flow",
    profile: "programmable_money_flow_v1",
    sourceType: "structural_money_flow",
    moneyFlow: "WABA conversation + template fees. A rejected/paused template silently kills booked campaign spend.",
    trigger: "Meta Cloud API webhook: template status, quality, pause.",
    intervention: "Detect block, compute missed conversations, rewrite template to policy, resubmit. No message blast.",
    monetization: "Fixed recovery fee per unblocked template plus optional share of restored conversation volume.",
    whyNow: "Agencies notice days late. First-party alerts exist but do not compute rupee damage or rewrite copy.",
    nextValidation: "Confirm Meta webhooks expose template pause with enough payload to compute missed sends without Ads Manager login.",
    requiredCapabilities: ["web.read"],
    metrics: {
      flowScale: 0.66,
      recurrence: 0.7,
      triggerIndependence: 0.8,
      permission: 0.64,
      deltaMeasurability: 0.68,
      monetization: 0.58,
      executionAutonomy: 0.6,
      competitiveWhitespace: 0.57,
      setupBurden: 0.48,
      timeToMoney: 0.52,
    },
  },
  {
    id: "upi-b2b-collect-retry-sentinel",
    title: "UPI B2B collect-request retry sentinel",
    family: "programmable_money_flow",
    profile: "programmable_money_flow_v1",
    sourceType: "structural_money_flow",
    moneyFlow: "Expired/ignored UPI collect requests on invoices. Money already earned, not collected.",
    trigger: "Collect-request expiry webhook or poll.",
    intervention: "Re-issue collect with a new expiry; never touch settlement rails.",
    monetization: "Tiny per-successful-retry fee.",
    whyNow: "Same leak Taskman Ledger pointed at. Razorpay/Cashfree dunning likely absorbs this.",
    nextValidation: "Check Razorpay Payment Links + Smart Collect retry. Reject if first-party already retries expiry.",
    requiredCapabilities: ["web.read"],
    metrics: {
      flowScale: 0.74,
      recurrence: 0.8,
      triggerIndependence: 0.68,
      permission: 0.6,
      deltaMeasurability: 0.78,
      monetization: 0.5,
      executionAutonomy: 0.38,
      competitiveWhitespace: 0.28,
      setupBurden: 0.55,
      timeToMoney: 0.6,
    },
  },
  {
    id: "unused-saas-seat-true-up",
    title: "Unused SaaS seat true-up",
    family: "programmable_money_flow",
    profile: "programmable_money_flow_v1",
    sourceType: "structural_money_flow",
    moneyFlow: "Monthly per-seat SaaS vs last-30-day SSO/activity.",
    trigger: "IdP last-login + vendor invoice lines.",
    intervention: "Recommend downsize; do not call vendor APIs to cancel.",
    monetization: "Share of verified unused-seat savings.",
    whyNow: "Zylo, Torii, Productiv, and vendor-native unused-license reports already exist.",
    nextValidation: "Do not pursue unless a vendor family has no idle-seat report and no FinOps tool coverage.",
    requiredCapabilities: ["web.read"],
    metrics: {
      flowScale: 0.8,
      recurrence: 0.76,
      triggerIndependence: 0.7,
      permission: 0.5,
      deltaMeasurability: 0.82,
      monetization: 0.55,
      executionAutonomy: 0.5,
      competitiveWhitespace: 0.22,
      setupBurden: 0.65,
      timeToMoney: 0.45,
    },
  },
  {
    id: "moltjobs-bounty-rail",
    title: "MoltJobs / Clawlancer bounty rail",
    family: "bounty_execution",
    profile: "bounty_execution_v1",
    sourceType: "bounty",
    moneyFlow: "Prefunded USDC bounties claimed and delivered through Taskman's existing rail.",
    trigger: "Open bounty list + escrow state.",
    intervention: "Claim, deliver, settle to wallet. One-time API key + wallet.",
    monetization: "Keep bounty payout; optional Taskman take-rate later.",
    whyNow: "Rail is coded. Last known blocker is platform escrow signer underfunded — not product whitespace.",
    nextValidation: "Re-probe Clawlancer escrow signer balance. Only EXECUTE if claim creates on-chain escrow.",
    requiredCapabilities: ["moltjobs.read", "moltjobs.authenticated", "wallet.sign"],
    metrics: {
      payoutCertainty: 0.38,
      acceptanceClarity: 0.72,
      executionAutonomy: 0.78,
      reusableRail: 0.92,
      setupBurden: 0.35,
      timeToMoney: 0.7,
      competitionRisk: 0.45,
    },
  },
  {
    id: "contractor-unbilled-work-capture",
    title: "Contractor unbilled-work capture",
    family: "immediate_income",
    profile: "immediate_income_v1",
    sourceType: "immediate_income",
    moneyFlow: "Finished workshop/agency jobs that never became an invoice or UPI collect.",
    trigger: "Job marked done with no invoice_id.",
    intervention: "Raise invoice, copy UPI, mark paid. Human still confirms the rupees landed.",
    monetization: "SaaS on the ledger, or take-rate on collected invoices.",
    whyNow: "Payer exists (the contractor's client). Submission path is UPI. Not a global wedge — a local capture product.",
    nextValidation: "Pilot with 3 Kozhikode workshops: unbilled rupees in week 1 vs collected in week 2.",
    requiredCapabilities: ["taskman.queue.write"],
    metrics: {
      payerExists: 0.84,
      payoutCertainty: 0.62,
      submissionPath: 0.8,
      executionAutonomy: 0.55,
      reusableRail: 0.7,
      setupBurden: 0.4,
      timeToMoney: 0.72,
    },
  },
];

const CAPTURE = [
  {
    id: "research-retainer",
    title: "Search retainer",
    how: "Charge for the scout loop itself: weekly ranked wedges + rejection log. No execution.",
    when: "Before any wedge crosses the freeze threshold. Matches current SEARCH mode.",
  },
  {
    id: "accepted-change-fee",
    title: "Accepted-change fee",
    how: "When a surviving wedge is executed (plan change, template unblock, demand-charge cut), take a small fee on the verified delta.",
    when: "Only after VALIDATE. This is the preferred Taskman take.",
  },
  {
    id: "bounty-keep",
    title: "Keep bounty payouts",
    how: "Run the MoltJobs rail; Taskman (or you) is the worker. First rupee is the bounty, not a SaaS invoice.",
    when: "The moment platform escrow is funded. Fastest path to a money event.",
  },
  {
    id: "ledger-saas",
    title: "Ledger SaaS for workshops",
    how: "Sell the unbilled-work book to contractors. Recurring INR, UPI. Not a global money-flow wedge.",
    when: "If bounty + wedge freeze both stall. Local demand in Kozhikode is the test.",
  },
];

export function exploreRevenueModels() {
  const capabilities = capabilitySnapshot();
  const models = CATALOG.filter((row) => !EXCLUDED.has(row.id)).map((row) => {
    const candidate = normalizeCandidate(row);
    const qualification = qualifyCandidate(candidate, row.profile);
    return {
      ...row,
      qualification,
      missingCapabilities: missingCapabilities(candidate, capabilities),
      decision: qualification.passes ? "SURVIVES" : "BLOCKED",
    };
  });

  models.sort((a, b) => b.qualification.score - a.qualification.score);
  const survivors = models.filter((m) => m.qualification.passes);
  const contenders = models.filter((m) => !m.qualification.passes && m.qualification.hardGateFailures.length === 0);
  const blocked = models.filter((m) => m.qualification.hardGateFailures.length > 0);

  for (const m of models) {
    m.decision = m.qualification.passes
      ? "SURVIVES"
      : m.qualification.hardGateFailures.length
        ? "BLOCKED"
        : "BELOW_THRESHOLD";
  }

  return {
    generatedAt: new Date().toISOString(),
    excludedLeader: "cloud-support-plan-right-sizing-engine",
    pipeline: ["DISCOVER", "VALIDATE", "EXECUTE", "LEARN"],
    note: "Scored with Taskman's qualification engine. Nothing here beats the freeze threshold. Closest models have no hard-gate failures but sit under 7.4 / 7.2.",
    survivors,
    contenders,
    blocked,
    capture: CAPTURE,
    counts: {
      explored: models.length,
      survivors: survivors.length,
      contenders: contenders.length,
      blocked: blocked.length,
    },
  };
}
