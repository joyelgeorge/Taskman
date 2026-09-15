# Test the numbers our own documents assert

**Priority: P2. Phase 5 of the accumulating-architecture spec. Progress level 4.**
Raised 2026-09-15.

## What

`test/schema-code-agreement.test.js` already proves the database schema matches
what the code writes to it. Generalise the idea to documents.

Numbers asserted in `docs/READ-FIRST.md` and `README.md` get checked by a test:

- *"Six code paths can record a settlement"* — a grep with a count.
- *"`settlements` is empty"* — a query, and **a test that fails when it stops
  being true.** That is the happiest failure this repository could have, and it
  is the one failure nobody would otherwise notice quickly.
- Test-count and migration-count claims — read, not recalled.

## Why

This is the anti-drift mechanism, and `READ-FIRST.md` already argues for it
against itself:

> a read-first document that has drifted is worse than none, because it is
> trusted.

A document nobody checks decays into a document that lies. The "71 critical
findings" headline that turned out to be one systemic issue counted seventy
times was caught by hand, once, by luck. This makes catching it structural.

## The trap to avoid

A test asserting a number that the test itself computes from the same source the
doc copied proves nothing. Each assertion must reach the **primary** store — the
database, the filesystem, the git history — not a cached summary of it.

Verify by breaking: change the number in the document and confirm the test goes
red.

## Done looks like

`README.md` and `READ-FIRST.md` cannot silently drift, and every number in them
names the store that would prove it wrong.
