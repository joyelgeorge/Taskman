import { getRailState, setRailEnabled } from '../money-ledger.js';

/**
 * Rails measured against a market that does not pay.
 *
 * As of the September 2026 measurement in docs/TARGET_DESIGN.md §2: Algora settled
 * 2 bounty payouts across 30 days against 1,470 in all of 2025, with 0 of 529 open
 * bounties passing eligibility and freshness checks; MoltJobs listed 7 jobs at $5
 * each and paid the tester $0. The summary from whoever actually tested these
 * venues was "completion is solved, settlement is not."
 *
 * Both rails registered in this codebase — TaskForceRail and the MoltJobs client —
 * target exactly that category. The code is kept: the adapter shape (discover,
 * verify, claim, deliver, checkPayment, execution-gated) is sound and will be
 * reused for whatever rail replaces these. What changes is that neither rail may
 * spend a single ledger attempt until a human looks at fresh evidence and
 * re-enables it — see docs/TARGET_DESIGN.md §2 and §6.
 */
export const DEAD_RAILS = Object.freeze([
  {
    rail: 'taskforce',
    reason: 'Agent-work marketplaces measured at ~2 settled payouts / 30d industry-wide '
      + '(Sept 2026); 0/529 open bounties passed eligibility+freshness on the comparable '
      + 'Algora market. Disabled pending fresh settlement evidence for this specific venue. '
      + 'See docs/TARGET_DESIGN.md §2.'
  },
  {
    rail: 'moltjobs',
    reason: 'Measured Sept 2026: 7 open jobs at $5 each, $0 paid to the tester. '
      + 'Disabled pending fresh settlement evidence. See docs/TARGET_DESIGN.md §2.'
  }
]);

/**
 * Seeds rail_state so both rails read as disabled before anything tries to use
 * them. Idempotent, and never overwrites a state a human already set: if a rail
 * has been manually re-enabled with new evidence, this must not silently disable
 * it again on the next process start.
 */
export async function seedDeadRails() {
  const seeded = [];
  for (const { rail, reason } of DEAD_RAILS) {
    const existing = await getRailState(rail);
    if (existing) continue;
    await setRailEnabled(rail, false, reason);
    seeded.push(rail);
  }
  return seeded;
}
