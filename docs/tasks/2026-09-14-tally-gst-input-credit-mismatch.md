---
status: open
priority: P1
level: 1
opened: 2026-09-14
---

# GST input-credit mismatch detector (Tally, second variant)

**Priority: P1, not P0.** Raised 2026-09-14 (`taskman-repo-tasks.pdf`, Task 2,
where it is listed P0 parallel to Task 1). Demoted here, with reasons.

## Scope as proposed

DETECT unclaimed input credit → INTERVENE with a corrected filing draft →
VERIFY the credit was claimed → CHARGE a percentage of credit recovered.

Same data source as the duplicate-invoice detector, same retailer, same
contingency model.

## Why it is demoted from P0

The discussion put this parallel to Task 1 because it shares a data source. That
is a build-cost argument, not a distribution argument, and the whole point of
the new ranking principle is that distribution decides. Two reasons to sequence
it behind:

**1. The category is mature and crowded.** GSTR-2B versus purchase-register
reconciliation is a solved, commercially served problem — ClearTax and Zoho
Books sell it, and Tally itself ships reconciliation features. A duplicate
invoice found in a retailer's own books is a surprise; unclaimed input credit is
something their accountant is already supposed to be checking. **We would be
competing. In Task 1 we are not.**

**2. It carries liability that Task 1 does not.** A duplicate-invoice report is
an observation the retailer can accept or ignore. A *corrected filing draft* is
tax advice. If it is wrong, the retailer files a wrong return and the harm is
theirs and legal. The operator is not a chartered accountant.

## If it is built anyway

- Keep it strictly draft-only and route it through the retailer's own CA for
  review. Do not let it become the filing.
- **HYPOTHESIS to test first, cheaply:** does this particular retailer actually
  have unclaimed credit? One look at one month's 2B against their purchases
  answers it. If the answer is no, the detector has nothing to detect and the
  task dies for free.

## Done looks like

Same as Task 1: a real charge, recorded through `recordSettlement`, for credit
the retailer confirms they recovered. Not a working detector.
