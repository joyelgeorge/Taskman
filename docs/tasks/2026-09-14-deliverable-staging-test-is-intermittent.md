# The deliverable-staging test fails intermittently

**Priority: MEDIUM.** Found 2026-09-14, while closing out parked tasks.

## What

`test/autonomous-engine.test.js:128`

```
✖ AutonomousEngine: stages ground truth deliverables and accurately
  distinguishes tested code from pending items (3055ms)
  assert.ok(staged.length >= 5)   // staged.length was < 5
```

Observed once. Measured immediately afterwards on an unchanged tree:

- full `npm test`, second run: **829 tests, 0 fail**
- `node --test test/autonomous-engine.test.js` standalone: **3/3 runs pass**

So it fails only under the full suite, and not every time.

**Second observation, 2026-09-15** (while building Phase 0): failed once more,
same test, same assertion, same ~3s runtime. Measured immediately after on the
same tree: **5 of 6 full-suite runs green**, and a stashed baseline without that
session's changes also green. Two sessions, two failures, no correlation with any
change — it is the test, not the code under it.

## Why it matters more than an ordinary flake

This test guards `verifyDeliverableTests()` — the function added specifically
because the engine used to treat `existsSync` as "tests passed". A guard that
reports failure at random is on its way to being a guard that gets muted, and
the next person to see red here will be tempted to re-run until green. That is
how the original bug survived.

The 3-second runtime is the clue: the assertion depends on work that takes real
time (it spawns `node --test` in a temp directory), so under full-suite load the
staging step is most likely racing a timeout or a shared temp path rather than
being wrong.

## Done looks like

Reproduce it deliberately — run the full suite in a loop, or run this file
concurrently with the heaviest sibling suite — then remove the race rather than
raising a timeout. If the cause is a shared temp directory, give each run its
own. Then delete this file in the same commit.

**Do not** relax `staged.length >= 5` to make it green.
