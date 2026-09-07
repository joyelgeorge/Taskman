---
name: taskman-audit-lane
description: >-
  Workflows for the payout reconciliation audit lane: client report generation,
  site deployment, PayPal settlement reconciliation, and order fulfillment.
  Use whenever modifying packages/web/public/audit, syncing audit assets,
  deploying to Firebase Hosting, or booking audit orders into the money ledger.
metadata:
  purpose: Operational guide for Taskman's first live commercial revenue stream.
---

# Taskman Live Audit Lane & Settlement Guide

## Overview
The live payout reconciliation tool is deployed on Firebase Hosting at **https://taskman-operator.web.app**.
It runs client-side payout audits against CSV/ledger exports and offers a full recovery report on **contingency: 20% of what the customer confirms they recovered, nothing if nothing comes back**. Collected via PayPal (`https://paypal.me/joyelgt`). The flat $20 model it originally shipped with was replaced — see packages/core/income/pricing.js for why, and for the market rates it is anchored to.

## Build & Deployment Workflow

1. **Building the audit bundle**:
   ```bash
   npm run build:audit-site
   ```
   This compiles `packages/web/public/audit/index.html` and assets into `dist/audit-site/` with the live payment link.

2. **Deploying to Firebase Hosting**:
   ```bash
   firebase deploy --only hosting
   ```
   (Target project: `taskman-operator`).

## Settlement & Order Booking

When a client confirms a recovery and pays the contingency fee via PayPal:
1. **Fulfill & Book Order into Money Ledger**:
   ```bash
   npm run fulfil -- --order-id=<PAYPAL_TXN_ID> --gross-cents=2000
   ```
2. **Ledger Invariant**:
   - Settlements require an external reference (`externalRef`) issued by the processor (PayPal transaction ID).
   - Source must be `paypal` or `stripe`.
   - Never book revenue from an unverified claim.
