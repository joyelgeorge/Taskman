/**
 * Every way this system could plausibly earn, including the ones already
 * disproven — recorded so they are not rediscovered and retried.
 *
 * The pattern this list exists to break: the machine has a settlement-verified
 * ledger, a rail governor, a drone fleet and zero settlements, because every
 * lane tried so far needed a person to open an account, and there was only ever
 * one lane in play at a time. Splitting `unblockedBy` is the point — it shows at
 * a glance which of these the machine can move tonight and which are waiting on
 * a human, and stops the second kind from masquerading as progress.
 */
export const DEFAULT_STREAMS = [
  {
    streamKey: 'agent-task-boards',
    title: 'Agent-native task boards (TaskForce, MoltJobs)',
    mechanism: 'Board escrows a bounty, the agent completes a task, the board pays out to a wallet.',
    requires: 'That real money is actually flowing through these boards.',
    nextAction: 'Do not retry without new evidence that volume exists.',
    unblockedBy: 'machine',
    state: 'DISPROVEN',
    stateReason: 'Measured September 2026: effectively zero settled volume. Both rails ship DISABLED '
      + 'in src/rails/dead-rails.js with the measurement recorded as the disable reason.',
    testCostHours: 0,
    evidence: [{ kind: 'measurement', at: '2026-09-02', note: 'near-zero settled volume across both boards' }]
  },
  {
    streamKey: 'fiverr-bookkeeping',
    title: 'Fiverr bookkeeping and reconciliation gigs',
    mechanism: 'Buyer pays Fiverr, Fiverr clears the payout to a bank account after delivery.',
    requires: 'A human-owned seller account, because Fiverr requires identity verification and '
      + 'forbids fully automated account operation. The work itself is AI-doable.',
    nextAction: 'A person creates the seller account and publishes the first gig (docs/FIVERR_LANE.md).',
    unblockedBy: 'human',
    state: 'BLOCKED',
    stateReason: 'Cannot be started by the machine: account creation and identity verification are '
      + 'human-only, by the platform\'s own terms.',
    testCostHours: 3,
    proofCents: 500
  },
  {
    streamKey: 'payout-leakage-audit',
    title: 'Payout reconciliation audits for small operators',
    mechanism: 'Client pays directly (bank transfer or Stripe invoice) for a reconciliation that '
      + 'finds unclaimed or misposted funds in their own payout records.',
    requires: 'One client willing to hand over a payout ledger. The parsing and reconciliation is '
      + 'already built (src/payout-leakage-platform.js).',
    nextAction: 'A person finds the first client. The machine cannot originate a trusted relationship.',
    unblockedBy: 'human',
    state: 'BLOCKED',
    stateReason: 'Software is ready; the missing input is one counterparty who trusts the operator '
      + 'with financial records.',
    testCostHours: 2,
    proofCents: 2000
  },
  {
    /**
     * The strongest lane on this list, and the newest.
     *
     * It is the only one where the capability, the surface and the delivery are
     * all already built and machine-executable: the audit reads any platform's
     * export, the page runs it client-side, and producing the full report is
     * work this system does rather than work a person does.
     *
     * It also asks less of a human than anything else here. No marketplace
     * approval, no gig review, no competing on a listing page — a Stripe account
     * and a payment link. And a Stripe settlement is already a verified source in
     * the money ledger with a sync job that reconciles it, so the first payment
     * would land in the ledger and move this stream to EARNING on its own.
     */
    streamKey: 'payout-audit-direct',
    title: 'Payout reconciliation, sold directly from the free audit',
    mechanism: 'Buyer runs the free check, sees a named missing payout, pays by PayPal or Stripe payment '
      + 'link for the full period. Processor clears funds and revenue-check reconciles it.',
    requires: 'A PayPal or Stripe payment link (live on https://taskman-operator.web.app) and someone '
      + 'who has run the free check and wants the rest. The delivery itself needs no human.',
    nextAction: 'Market the live audit tool to potential audit clients to drive first paid settlement.',
    unblockedBy: 'human',
    state: 'TESTING',
    stateReason: 'Deployed live with PayPal (paypal.me/joyelgt/20USD). Testing traffic and settlement acquisition.',
    testCostHours: 1,
    proofCents: 2000
  },
  {
    streamKey: 'github-paid-bounties',
    title: 'Algora & GitHub Open-Source Bounties',
    mechanism: 'Platform (Algora) escrows bounty funds; human reviews candidate, posts /claim or /attempt, '
      + 'and submits PR. Maintainer merges, and Algora releases payout via Stripe Express (KYC required) in 1-3 days.',
    requires: 'Stripe Express account with KYC on Algora platform, and human-in-the-loop review/submission (#194). '
      + 'Note: PayPal does NOT unlock Algora; each bounty platform requires its own payout rail and identity verification.',
    nextAction: 'Complete Algora GitHub OAuth and Stripe Express KYC setup; run bounty triage (#195) to produce reviewable candidates.',
    unblockedBy: 'human',
    state: 'BLOCKED',
    stateReason: 'Awaiting human-owned Algora Stripe Express setup with KYC. Payouts clear 1-3 days post-merge.',
    testCostHours: 2,
    proofCents: 5000
  },
  {

    streamKey: 'ephemeral-attention-dataset',
    title: 'Longitudinal dataset of attention that is never archived',
    mechanism: 'Licence the accumulated series — one-off extract or a recurring feed — to teams who '
      + 'need history that cannot be bought anywhere because nobody kept it.',
    requires: 'Series that the publisher does NOT archive, so elapsed time is the moat. Ranking and '
      + 'position data qualifies; a published statistical series does not.',
    nextAction: 'Do not restart without a series whose history the publisher genuinely does not keep.',
    unblockedBy: 'machine',
    state: 'DISPROVEN',
    stateReason: 'Checked 2026-09-05. The premise was that ordering is never archived, so elapsed '
      + 'time was the whole moat. It is archived: Hacker News publishes the exact front-page list '
      + 'for every date since 2014-11-11, toddwschneider/hntrends mirrors it free and nightly back '
      + 'to 2006, and sangaline holds 2007-2017 snapshots carrying position, score and age — the '
      + 'same three fields collected here. A buyer gets two decades for nothing. Ten minutes of '
      + 'checking published sources ended a lane that was 364 days from a payday it would never '
      + 'have had.',
    testCostHours: 4,
    proofCents: 5000
  },
  {
    streamKey: 'venue-reachability-record',
    title: 'Which venues are automatable, measured over time',
    mechanism: 'Licence the scan history, or use it to price and target the audit lane.',
    requires: 'That someone else cares whether a venue was bot-defended six months ago. Weaker than '
      + 'the attention dataset: real but small.',
    nextAction: 'Keep satellite-scan running; it already accumulates this at no extra cost.',
    unblockedBy: 'machine',
    state: 'HYPOTHESIS',
    stateReason: 'Accrues for free as a side effect of work already being done.',
    testCostHours: 0
  }
];
