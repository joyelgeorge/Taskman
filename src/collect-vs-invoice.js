import { normalizeCandidate, qualifyCandidate } from "./qualification-engine.js";

const PROFILE = "immediate_income_v1";

const PATHS = [
  {
    id: "invoice-only",
    title: "Invoice only",
    what: "PDF or GST tax invoice sent on WhatsApp. Creates a receivable. Does not move rupees.",
    when: "Registered GST dealer, ITC-claiming B2B client, or any job that must exist in the books.",
    moneyEvent: "None until the client separately pays.",
    metrics: {
      payerExists: 0.84,
      payoutCertainty: 0.45,
      submissionPath: 0.7,
      executionAutonomy: 0.48,
      reusableRail: 0.62,
      setupBurden: 0.58,
      timeToMoney: 0.38,
    },
    strengths: [
      "Legal claim and GST input credit.",
      "Client accounts payable can process it.",
      "Survives if UPI ID is missing.",
    ],
    weaknesses: [
      "Invoice is a document, not a payment.",
      "Kerala workshops already delay 15–45 days on paper bills.",
      "Setup (GSTIN, HSN, tax) is how this becomes Vyapar.",
    ],
  },
  {
    id: "upi-collect-only",
    title: "UPI collect only",
    what: "Collect request, payment link, or upi://pay intent. Client approves in GPay/PhonePe. Money moves.",
    when: "Unregistered or composition dealer, repeat local client, job under the GST threshold, cash-today culture.",
    moneyEvent: "UPI credit. No tax invoice unless they ask later.",
    metrics: {
      payerExists: 0.84,
      payoutCertainty: 0.72,
      submissionPath: 0.88,
      executionAutonomy: 0.62,
      reusableRail: 0.78,
      setupBurden: 0.22,
      timeToMoney: 0.84,
    },
    strengths: [
      "Shortest path from done-work to rupees.",
      "One-time setup is a VPA.",
      "Beats WhatsApp 'Sir payment' because the pay button is in the same message.",
    ],
    weaknesses: [
      "Collect requests expire and can be rejected.",
      "Not a GST document — ITC clients will ignore it.",
      "Without a PSP webhook, Taskman still does not know it landed.",
    ],
  },
  {
    id: "invoice-plus-upi",
    title: "Invoice + UPI on one tap",
    what: "Same action raises the bill and attaches a collect/link. Books and money in one step.",
    when: "Default for the unbilled-capture product. Invoice satisfies the client who needs paper; UPI is the actual collect.",
    moneyEvent: "UPI credit is the event. Invoice is evidence, not the event.",
    metrics: {
      payerExists: 0.84,
      payoutCertainty: 0.62,
      submissionPath: 0.8,
      executionAutonomy: 0.55,
      reusableRail: 0.7,
      setupBurden: 0.4,
      timeToMoney: 0.72,
    },
    strengths: [
      "Does not force GST theatre on day one.",
      "Client who needs a bill still gets one.",
      "Matches the freeze-path: later swap mark-paid for a collect webhook.",
    ],
    weaknesses: [
      "Still below 7.2 freeze — human confirms settlement.",
      "Two artefacts to maintain if the invoice total and UPI amount drift.",
    ],
  },
];

function scorePath(path) {
  const qualification = qualifyCandidate(normalizeCandidate({ metrics: path.metrics }), PROFILE);
  return {
    ...path,
    qualification,
    decision: qualification.passes
      ? "SURVIVES"
      : qualification.hardGateFailures.length
        ? "BLOCKED"
        : "BELOW_THRESHOLD",
  };
}

export function compareCollectVsInvoice() {
  const paths = PATHS.map(scorePath).sort((a, b) => b.qualification.score - a.qualification.score);
  const best = paths[0];
  return {
    question: "For unbilled-work capture, is the submission path an invoice or a UPI collect?",
    profile: PROFILE,
    threshold: paths[0].qualification.threshold,
    verdict:
      "UPI collect is the money event. An invoice is a claim. Unbilled rupees do not become collected because a PDF exists. Default is invoice + UPI on one tap; if you must ship only one, ship collect first.",
    winner: best.id,
    paths,
    rules: [
      "Count collected only on UPI/cash confirmation — never on invoice created.",
      "Home number stays unbilled paise, not invoice count.",
      "GST tax invoice is a later overlay for registered dealers, not the MVP.",
      "A collect without amount-locked invoice is fine for unregistered workshops; lock amount so they cannot 'pay something'.",
      "If the client is a GST-claiming company, send the tax invoice in the same WhatsApp as the collect, or they will not pay.",
    ],
    matrix: [
      { axis: "Time to money", invoice: "Days to weeks", upi: "Minutes if accepted", both: "Minutes, with a bill attached" },
      { axis: "Payout certainty", invoice: "Receivable risk", upi: "Reject/expiry risk", both: "Reject risk, but a legal bill remains" },
      { axis: "GST / ITC", invoice: "Required for registered B2B", upi: "Not a tax document", both: "Invoice carries GST; UPI settles" },
      { axis: "Setup", invoice: "GSTIN, HSN, series", upi: "VPA only", both: "VPA + optional GST fields" },
      { axis: "Autonomy", invoice: "Chase on WhatsApp", upi: "Client taps Pay", both: "Tap Pay; human still marks paid" },
      { axis: "Competes with", invoice: "Vyapar, Busy, Zoho", upi: "GPay chat, Razorpay links", both: "WhatsApp + chit, if the home number is unbilled" },
    ],
  };
}
