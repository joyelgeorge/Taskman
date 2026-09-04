# Taskman Commercial Wedge Specification (#104)

## One-Sentence Product Promise
Taskman automatically reconciles Fiverr freelance payouts, platform fees, currency deductions, and bank deposits into audit-ready financial records so agency owners stop overpaying taxes and leaking revenue.

## Core Wedge Architecture
```text
ONE Customer Type:
  → Digital freelance agency owners & high-volume Fiverr sellers (>$3,000/mo volume)
ONE Recurring Trigger:
  → Payout withdrawal notification or month-end bank settlement reconciliation
ONE Taskman Intervention:
  → Automated ingestion & cross-matching of Fiverr transaction ledger with bank/Stripe deposits
ONE Measurable Financial Outcome:
  → Exact dollar fee & withholding reconciliation ($300-$800/yr recovered from tax overpayment / leakage)
ONE Payment Mechanism:
  → Billed via Taskman usage metering (#83) / Stripe settlement sync ($19/mo or $2/batch)
```

## Success & Kill Criteria
- **Success Milestone**: 10 active recurring customers reconciled with verified cleared Stripe settlements.
- **Kill Criteria**: Trailing 30-day ROI drops below 1.5x after 50 attempts with zero converted customers.
- **Scope Freezing**: All unrelated speculative rails (prediction markets, autonomous social posting) are frozen until this proof milestone is met.
