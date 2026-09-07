---
name: territory-scout
description: Use on a schedule (or on demand) to discover NEW money-making territories for Taskman, scored against the operator's real constraints and deduped against everything already tried.
---

# Territory Scout

The money machine keeps narrowing to a few lanes (bounty hunt, the audit tool).
This skill's job is the opposite: each run must surface territories we have NOT
tried, and refuse to dress up ones we have.

## Procedure

1. **Load the memory.** Read `packages/core/territory/registry.js`. Everything in
   `EXPLORED_TERRITORIES` is off the table as-is; a KILLED entry is off the table
   even in disguise. You must be able to say why each new idea is not one of these.

2. **Widen deliberately — do not self-restrict.** Draw candidates from
   directions the fleet does not already cover, and do not narrow by geography,
   by the operator's current setup, or by the handful of lanes already running.
   Assume the money can land (PayPal is near-global); assume the operator can be
   anywhere. The only real limits are novelty, feasibility with what exists, and
   whether buyers are actually there. Examples of *directions*, not answers: data/signal products
   built from what the drones already collect; a fixed-scope productised service
   the scanner or reconciliation edge-case expertise can deliver; a niche
   marketplace or platform with an underserved segment; a developer asset sold
   once and resold; an affiliate/referral bridge on tools we already use; an
   emerging AI-work venue that pays per validated output. Do not filter for
   feasibility yet — breadth first (this is the `revenue-discovery` discipline).

3. **Score each** with `packages/core/territory/scoring.js` by choosing the
   honest label for each dimension:
   - `timeToFirstDollar`: days | weeks | months | unclear
   - `payoutReach`: paypal_or_bank | card_processor | crypto | closed  (only closed is fatal). Not a geography question — PayPal spans ~200 countries and bank/wire is universal, so treat reach as broad and reserve `closed` for a rail with genuinely no path in.
   - `feasibilityWithAssets`: direct | small_build | large_build | none
   - `saturation`: underserved | moderate | crowded | swarmed
   - `distribution`: buyers_already_searching | findable | must_create_demand

4. **Dedupe** with `isNovel` from the registry, passing `aliases` for any killed
   lane the idea resembles. A candidate that is not novel is dropped, not softened.

5. **Rank** with `rankTerritories` and keep the top few above the floor. For each
   survivor write: the mechanism, the buyer and their urgent pain, the payment
   rail, and the single cheapest experiment that would prove or kill demand in
   under a day.

## Honesty rules

- A number you cannot source is not a score. Prefer `unclear` to a flattering guess.
- If a run finds nothing genuinely new, say so. An empty, honest result beats a
  recycled lane presented as fresh — the whole point is to escape the few routes,
  not to pad a list.
- Nothing here submits, sends, or spends. The output is a scored shortlist for a
  human to choose from.
