---
name: taskman-verify
description: >-
  Check a claim about Taskman against the thing it is a claim about, before
  acting on it. Use whenever revenue, earnings or settlements are mentioned
  ("we made", "verified revenue", "cleared", a dollar figure), whenever something
  is said to exist in the repo (a module, a table, a migration, an asset),
  whenever a lane, venue, moat or data source is being assessed as viable,
  whenever a claim is marked "verified" or "confirmed", whenever the question is
  "is this working" or "is it production ready", and before enabling a deploy
  target or relying on a platform feature. Also use when a message, dashboard,
  console or another agent reports a number or a state that has not been checked
  here.
metadata:
  purpose: Every expensive mistake in this project so far was an unverified claim.
---

# Verify before you believe it

Every costly error in this repository has the same shape: something was asserted,
it sounded reasonable, and nobody looked. The looking usually takes under a
minute.

Real examples, all from this codebase:

- A data source was documented `reconstructible: false` with "Verified — no
  historical archive exists from the publisher or any third party." It was not
  verified. Hacker News publishes the exact front-page list for every date since
  2014-11-11, and two free public datasets mirror it back to 2006. The lane was
  judged 364 days from sellable; ten minutes of reading ended it.
- A console reported **$221.60 of settlement-verified revenue** with cleared
  payouts named. The settlements table had zero rows in production and in every
  local database, and the order ids appeared in no file anywhere.
- A plan described "Repository Assets: packaged Python detector modules,
  `taskman_billing_records`, PostgreSQL schema" as done. None of it existed.
- "Enable GitHub Pages, it is one setting" — advised twice before checking. The
  API returned 422: the plan did not support Pages on a private repository.
  Re-probed days later it answered "already enabled", because the repository had
  been made public. Both answers were right when given.

The rule: **the source of truth is the database, the filesystem, or the API —
never a message, a dashboard, a commit message, or a previous statement,
including your own.**

## Money

Never quote revenue from a UI, a report or a summary. Query the ledger.

```sql
SELECT status, count(*), COALESCE(sum(net_cents),0) AS net_cents
FROM settlements GROUP BY status;

SELECT count(*) FROM income_streams WHERE state='EARNING';
SELECT gross_cleared_cents FROM finance_report_history ORDER BY snapshot_date DESC LIMIT 1;
```

Zero rows means zero revenue. `src/money-ledger.js` refuses any settlement
without a verified source and an `externalRef`, so a real number has a row and a
reference; without both it is not money.

Watch for the inversion — a figure presented as "settlement-verified, not a fake
zero" when the true state *is* zero. The zero is usually the honest number.

## Storage mode: a green suite proves less than it looks

Memory mode enforces no constraints and no foreign keys, so it hides exactly the
bugs that only appear in production. Four separate production defects were
invisible in memory and obvious against PostgreSQL: a `dueSources()` query that
could never run, a table written to by code and created by no migration, a CHECK
constraint the console violated on every call, and a timezone off-by-one.

Run both. They answer different questions.

```bash
npm test                                     # memory
dropdb --if-exists v && createdb v
DATABASE_URL=postgresql://$(whoami)@localhost:5432/v PGSSL=disable NODE_ENV=test \
  npm run migrate:all
DATABASE_URL=postgresql://$(whoami)@localhost:5432/v PGSSL=disable NODE_ENV=test \
  npm test -- --test-concurrency=1
```

`test/schema-code-agreement.test.js` guards the class where code can write a
value the schema rejects; it runs only with `DATABASE_URL`. Any API response
carries its own mode — `storage: "memory"` means the numbers persist nowhere and
are not revenue.

## Does it actually exist

Two separate messages described modules, tables and assets never in the tree.

```bash
grep -rn "<symbol>" --include='*.js' . | grep -v node_modules | head
git show origin/main:path/to/file >/dev/null 2>&1 && echo present || echo absent
grep -rl "<table_name>" db/migrations packages/db/migrations
```

A table code writes to that no migration creates is a live bug, not a detail —
`outreach_drafts` swallowed every write for months while returning `ok: true`.

## Platform and deploy capability

Probe it. Availability depends on plan, repository visibility and country, none
of which are inferable, and all of which change.

```bash
gh repo view --json visibility,isPrivate     # gates almost everything else
gh api repos/<owner>/<repo>/pages            # 404 = off; 422 on POST = plan refuses
gh secret list
curl -s -o /dev/null -w '%{http_code}\n' https://<site>/
```

Re-probe rather than remembering: a cached "not supported" goes wrong silently.

Verify the deployed artifact, not the local one. Builds go stale and configs
publish the wrong directory — one deploy went out from `public/`, which contains
no audit page at all.

Making a repository public to unlock a feature is a real tradeoff worth naming:
this one holds the strategy, venue assessments, tax position and the fact that
revenue is zero. Check what became readable:

```bash
grep -rInE "(postgres)://[^ '\"]*:[^ '\"]*@|sk_live_|github_pat_|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}" \
  --exclude-dir=node_modules --exclude-dir=.git . | grep -vE "example|localhost|\.test\.js"
```

## Assessing a lane, venue or data source

Volume is the most encouraging field and the least predictive. Ask in this order
and stop at the first no:

1. **Can the money reach this person, in this country, as an individual?** Algora
   carries the most bounty volume and cannot pay India at all.
2. **Do the platform's terms permit this?** Algora prohibits robotic access; 37
   open-source projects ban AI contributions outright.
3. **Is the moat real?** For data the test is not "did we keep history" but "does
   the publisher keep it too".
4. **What does the rail cost at this ticket size?** Fixed fees, not percentages,
   decide whether small work is viable — 23% on $2, 9.4% on $20 through PayPal
   India.
5. **Can it lose money rather than merely earn none?** DeFi arbitrage can;
   everything else here fails to zero.

`packages/core/income/venues.js` records these per venue with `confidence:
verified | assumed`. If the evidence field cannot be filled in, the answer is
`assumed`.

## Writing a claim down

"Verified" is a promise that someone looked. Carry the evidence and the date:

```js
reconstructible: true,
reconstructibleNote: 'HN publishes the exact front-page list since 2014-11-11; '
  + 'toddwschneider/hntrends mirrors it free and nightly. Verified 2026-09-05.',
```

If it was not checked, say `assumed` and say what would settle it. Marking an
unchecked belief as verified is how this project nearly lost a year.

## When a claim turns out to be wrong

Say so plainly, correct the record where the claim lives, and keep the disproof
beside the thing it disproves rather than deleting it. Dead rails, disproven
streams and rejected prospect sources all stay in the tree so nobody rediscovers
them next quarter as a fresh idea.
