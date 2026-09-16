# Parking lot

Ideas and lanes held until the commitment review on the date in
`data/operator-commitment.json`. One line each. Adding a line here is the whole
action: no research, no repo, no tasks, no rows until review.

At review, each line either goes through `npm run guard -- lane <file>` or is
deleted. A line that has sat through two reviews without being chosen should be
deleted; keeping it is sunk cost, not optionality.

## Decision needed now

- **Tally shrinkage / duplicate-invoice detector** (`docs/tasks/2026-09-14-tally-duplicate-invoice-detector.md`, P0).
  The task board ranks it first because the retailer relationship may already
  exist; the commitment names the self-serve scanner because it is live. Only
  one can be primary. Verify the access claim (one question), then either swap
  `primary` in the commitment file with a written reason or leave it parked.

## Parked on 2026-09-16

- DePIN bandwidth sharing — machine lane; background slot is taken.
- DeFi flashloan and liquidation hunting — capital at risk; parked for the commitment.
- Decentralized GPU inference worker — machine lane; background slot is taken.
- Small-amount bitcoin trading — capital at risk; needs a cap and kill criteria before review.
- Section 8 company and CSR partnerships — runs on recurring relationships; needs an explicit solo-fit override.
- India–Bhutan trade and glove export — manual trade outside this repo's loop; needs paying-demand evidence.
- Silent Renegotiation agent — no paying-demand evidence yet.
- Fiverr bookkeeping gigs — human lane outside the commitment.
- Payout reconciliation audits (direct and contingency) — human lane outside the commitment.
- Algora and GitHub bounties — human lane outside the commitment; `CLAUDE.md` already says OSS bounties do not pay cash.

## Never parked

Replies owed to anyone who has already asked for something — a question, a quote,
materials — in this repo or outside it. That is band 2 work already in motion, and
the commitment's if-then plan covers it: reply within 24 hours.
