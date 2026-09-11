# Distribution Push Plan: Live Payout Fee Reconciliation Audit

*Actionable Distribution Blueprint for Taskman Issue #207 (`★3`)*

---

## 1. Context & Channel Selection
The instant payout-reconciliation audit tool (`src/instant-audit.js` / `src/payout-csv.js`) is stateless, runs without a signup wall, and matches platform earnings to bank deposits within 2 cents / 45-day windows.

The bottleneck has been distribution, not code. We execute ONE honest, non-spam community placement in an exact forum where digital agencies and marketplace sellers discuss payout leakage (e.g., Fiverr / Upwork / Stripe seller subreddits or Facebook agency groups).

---

## 2. Drafted Community Post (Operator-Ready)

**Title:** Free script/tool to check if your platform payouts actually match your bank deposits (no signup, runs locally/in-browser)

**Post Body:**
> Hey everyone,
>
> If you're doing high order volume on marketplaces (Fiverr, Upwork, Stripe marketplaces), you know reconciling platform statements against actual bank deposits is a headache. Platforms batch payouts, deduct dispute fees or commissions, and bank lines don't always clearly label which orders cleared.
>
> We wrote a lightweight, stateless reconciliation tool that matches orders against bank credits:
> - Tolerance: Within 2¢ (handles micro fee splits).
> - Match Window: Up to 45 days between order date and bank deposit.
> - Zero storage & zero signup: We don't save your financial data or require an account.
>
> **Example of what it outputs:**
> ```
> Orders analyzed: 120 ($12,450.00 gross)
> Matched bank deposits: 118 ($9,820.00 net received)
> Platform fees identified: $2,490.00 (Itemized for tax deductions)
> Unmatched items: 2 orders ($140.00) with no matching bank deposit in 45 days
> ```
>
> If you have CSV exports from your platform and your bank statement, you can run the instant audit here: [Link / repo].
>
> If anyone wants a free discrepancy report run on their sample CSV exports, drop a comment or DM your anonymized headers and I'll run the matcher for you.

---

## 3. Success Metrics
- Measure real inbound visits / CSV submissions.
- If 0 interest after 7 days, this conclusively settles whether sellers actively seek fee audits, allowing us to pivot to the security scan lane.
