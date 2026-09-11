---
name: verifying-guard-tests
description: >-
  Check that a test can actually fail, before trusting it. Use whenever writing
  or reviewing a test whose job is to guard something — a security property, an
  invariant, a regression, a safety interlock, a "must never happen" rule.
  Also use whenever a status flag, a health check, a lint, or a CI step is being
  written to certify that something is true, and whenever a claim of the form
  "tests pass", "verified", "this is guarded", or "we check for that" is being
  believed or acted on. Use before marking such work complete.
metadata:
  purpose: A guard that cannot fail is worse than no guard, because it is trusted.
---

# A guard you have not broken is not a guard

A test that cannot fail still passes. A check that reads the wrong signal still
reports green. Both then get trusted precisely because they exist — which is
what makes them more dangerous than having nothing there.

The only way to know a guard works is to **break the thing it guards and watch
it catch the break.**

## The four shapes this takes

Learn to recognise them by name; they are separate bugs that reinforce each
other.

**1. The indicator is not the thing** (Goodhart's law; in AI-safety terms,
specification gaming). A proxy stands in for the property, and the code
optimises the proxy.

> Real case: `_executeDeliverableTrial` set `testsPassed: true` when
> `existsSync()` found a test file on disk. A test file that existed and FAILED
> still staged as `TESTED_AND_READY`. File presence was a proxy for passing.
> The fix was to run `node --test` and read the exit code — the thing itself.

**2. The vacuous test.** The assertion has no discriminating power: it passes
identically whether the code is right or wrong.

> Real case: a fail-closed test fed `getRedactionReplacement` inputs with no
> `=` in them. Both branches return the same string for such input, so the test
> proved nothing about which branch ran, and passed against the broken code.
> The fix was inputs where the two branches genuinely differ.

**3. Confabulation.** A confident claim with no underlying check — usually in a
document, a comment, or a report that has drifted from the code.

> Real case: a hand-off document stated `_executeDeliverableTrial` "runs
> `node --test <testFile>` for real". It did not. The sentence was written as a
> description of an intended fix and then read as a description of reality.

**4. Surrogation.** Enforcing a rule's letter in a way that inverts its intent.

> Real case: an anti-fabrication rule requiring a verifiable external reference
> before pursuing an opportunity would have confined the engine to opportunities
> already listed on public boards — which the territory registry records as
> picked clean. The rule against inventing counterparties would have become a
> rule against discovering real ones. Fixed by gating assertion and spend
> rather than exploration.

## The procedure

Four steps. Do not skip step 2; it is the whole skill.

1. **Write the guard and the test.** Get it green.
2. **Break the guarded property deliberately.** Invert the condition, delete the
   check, swap `>` for `>=`, return the wrong constant. One small, surgical edit
   to the *implementation*, never to the test.
3. **Run the test and confirm it FAILS** — and read the failure. It must fail
   for the reason you expect. `assert.throws()` passes just as happily on a
   `TypeError` from a typo as on the security failure you meant to catch.
4. **Restore the implementation, confirm green, and record both outputs** in
   your report or commit message. The failing output is the evidence; without
   it "I tested it" is itself an unverified claim.

Confirm the implementation is restored before committing — `git diff` on the
file you broke must be empty.

## Signs a guard is not discriminating

Check these before trusting any guard test:

- Would it pass if the implementation were deleted entirely?
- Do the inputs exercise a case where the right and wrong paths produce
  *different* outputs? If both produce the same thing, the test is decorative.
- Does an async test `await` everything it sets up? A helper that cleans up in
  `finally` without awaiting the body will delete the fixture mid-run, and the
  test may pass for that reason instead of the real one.
- Does a spawned child process inherit environment that changes its exit
  semantics? `NODE_TEST_CONTEXT` is set by a parent `node --test` run and makes
  a failing child suite report success.
- Does the assertion pin the *value*, or only the shape? `assert.ok(result)` is
  true for almost everything.
- For a boundary, is there a case exactly AT the limit, not only past it?

## When it is a status flag rather than a test

The same rule applies to anything that certifies truth — a health check, a
`verified: true` field, a CI step, a lint rule.

Ask: **what did this observe?** If the answer is the existence of a file, the
shape of a name, or another flag, it is a proxy, and it will eventually be true
when the thing it stands for is false. Make it observe the property: an exit
code, a returned value, a row that exists, a byte that is unreadable.

Never set a flag asserting an outcome in the same breath as describing the
intention to achieve it.

## Why a rule is not enough

This repository already carried `taskman-verify`, a `CLAUDE.md` rule to verify
before asserting, and a hand-off document whose whole thesis was that marking
something verified without checking nearly cost a year. Every one of the cases
above happened anyway, and two of them happened *while fixing another one*.

The reason is structural: a rule you must remember to apply does not fire in the
state where you are confident, and confidence is the state in which these are
written. So prefer, in this order:

1. **An executable check** that fails the build whether or not anyone remembered
   — a schema-agreement test, a CI scan, a real test run behind a status flag.
2. **A broken-then-restored demonstration** recorded in the commit.
3. **A written rule**, last, because it is the weakest of the three.

If you find yourself thinking "the change is small, the test obviously works" —
that thought is the one that preceded every case listed above.
