# Decision Record: Minimal Hosted Front Door vs Operator CLI

*Authoritative Decision for Taskman Issue #216 (`◆5`)*

---

## 1. Context & Gating History
Issue #216 asked: Should Taskman build and host a web scan-request front door, or should it operate the validated wedge via the current operator CLI (`scripts/fulfil-scan.mjs`) and warm lead replies?

This decision follows the completion of:
- **#212**: Validated demand (10 live high-intent signals on Upwork, Reddit, Fiverr).
- **#213**: Packaged offer (`docs/OFFER-ONE-PAGE.md`).
- **#214**: Verified CLI fulfilment (`scripts/fulfil-scan.mjs`).

---

## 2. Decision & Rationale

### **Decision: Supersede hosted form build with Operator-Driven CLI Fulfilment**
As instructed by Issue #216 acceptance criteria:
> *"Close this issue as superseded if the validated wedge is intentionally operated through the current CLI and no hosted surface is required."*

### Key Strategic Reasons:
1. **The Inactive Signup Wall Anti-Pattern** (`docs/BRAIN-TRANSFER.md` §4):
   Building another web front door before real customers exist repeats the exact mistake of `customer-workflow.js`:
   *"the only people who could ever see a finding were people who had already signed up. Nobody signs up to find out whether there is anything to find."*
2. **Warm Inbound Outclasses Form Submissions**:
   Founders asking for help on Reddit/Upwork/IndieHackers do not want to be redirected to an unknown third-party website form. They respond to a direct, human, helpful reply offering:
   *"I ran a free read-only scan on your public repo — here is the 1-page report and how to fix your RLS."*
3. **Frictionless Fulfilment Already Exists**:
   `node scripts/fulfil-scan.mjs prepare <github_repo>` already takes an `owner/repo` or GitHub URL, clones shallowly, runs the 8 vulnerability detectors, prints the report, and generates the PayPal link.
4. **No Revenue Attribution Leaks**:
   Keeping fulfilment operator-authorized guarantees that no fictitious settlement or unverified revenue is booked without an external PayPal/bank transaction reference.

---

## 3. Operational Protocol
1. **Intake**: Operator locates warm lead via `.claude/skills/warm-lead-scout/SKILL.md`.
2. **Execution**: Run `node scripts/fulfil-scan.mjs prepare <repo> --for "<Name>"`.
3. **Handoff**: Provide the free scan report to the builder.
4. **Settlement**: If the builder chooses the $249 fix, deliver via `deliver` with verified PayPal transaction reference.
