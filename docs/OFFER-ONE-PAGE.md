# AI App Security Scan & Hardening — Commercial Offer

*Authoritative Offer Packaging for Taskman Issue #213 (`◆2`)*

---

## 1. Executive Summary: What We Do

> **"I find the exposed database keys, missing Row-Level Security (RLS), unauthenticated admin routes, and command injection bugs in your AI-generated app before your users or attackers do."**

AI tools (Cursor, Lovable, Bolt, v0, Windsurf) build functional web apps in hours, but consistently leave behind dangerous vulnerabilities:
1. **Hardcoded Supabase `service_role` keys** (bypasses all security rules; full DB read/write).
2. **Missing Row-Level Security (RLS)** (every table is world-readable via the public anon key).
3. **Unauthenticated Admin & Mutating API Routes** (endpoints exposed without session verification).
4. **Permissive / Reflective CORS** (attacker sites can issue authenticated requests with victim cookies).
5. **SSRF & Command Injection** (unfiltered server-side fetches or shell interpolations).

We audit your codebase with a specialized, precision-first scanner, manually verify every finding, and provide a verified remediation Pull Request.

---

## 2. The Packages & Pricing

### Package A: Pre-Launch Security Scan
- **Price**: **$99 USD** (Fixed price)
- **Turnaround**: 12–24 hours
- **Deliverable**:
  - Full **Executive & Technical Markdown Audit Report** itemizing confirmed vulnerabilities.
  - Exact file locations (`src/path:line`) and code evidence snippets.
  - Step-by-step verification commands so your team can reproduce and confirm each finding.
  - Remediation instructions for each item.
- **Payment Link**: `https://paypal.me/joyelgt/99`

### Package B: Security Scan + Verified Fix PR
- **Price**: **$249 USD** (Fixed price)
- **Turnaround**: 24–48 hours
- **Deliverable**:
  - Everything in Package A (Full Audit Report).
  - **Ready-to-merge GitHub Pull Request** fixing all confirmed issues:
    - Supabase RLS migrations (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` + policy definitions).
    - Session/auth guards on admin and privileged route handlers.
    - Safe secret extraction to server environment variables.
    - CORS origin allowlists.
  - **Automated Regression Unit Tests** verifying the fixes pass without breaking user workflows.
- **Payment Link**: `https://paypal.me/joyelgt/249`

---

## 3. Sample Report Format

```markdown
# AI App Security Scan Report
Prepared for: [Client / App Name]

**3 confirmed issues — 1 critical, 2 high.**

## 1. [CRITICAL] missing-rls
- **Where:** supabase/migrations/20260901_init.sql:14
- **Evidence:** create table public.customer_orders (no ENABLE ROW LEVEL SECURITY)
- **Why it matters:** Supabase table "customer_orders" is created without Row-Level Security. With RLS off, anyone holding the public anon key can read and write every row via the REST API.
- **Confirm / fix:** Call /rest/v1/customer_orders with anon key. Fix: ALTER TABLE customer_orders ENABLE ROW LEVEL SECURITY;

## 2. [HIGH] unauthenticated-admin-route
- **Where:** app/api/admin/users/route.ts:1
- **Evidence:** Admin API route handler with no auth/session verification
- **Why it matters:** Privileged route allows unauthenticated POST/DELETE actions.
- **Confirm / fix:** Add getServerSession or requireAuth guard.

## 3. [HIGH] open-cors
- **Where:** server.js:42
- **Evidence:** cors({ origin: req.headers.origin, credentials: true })
- **Why it matters:** Reflects arbitrary origin while permitting credentials.
- **Confirm / fix:** Restrict origin to explicit whitelist of frontend domains.
```

---

## 4. How It Works (Client Workflow)

1. **Step 1 (Share Access)**: Share a public GitHub repo link (or invite read-only to a private repo).
2. **Step 2 (The Scan)**: We run our offline, read-only audit engine and review the findings.
3. **Step 3 (Report & Fix)**: You receive the report and payment link. Upon confirmation, the remediation PR and test suite are delivered.
