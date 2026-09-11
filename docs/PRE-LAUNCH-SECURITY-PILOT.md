# Pre-Launch Security Scan Pilot: Operator Execution Blueprint

*First-Dollar Pilot Plan for Taskman Issue #205 (`★1`)*

---

## 1. Pilot Objective
Deliver **3 free pre-launch security scans** to high-reputation founders launching on Product Hunt / Show HN / X within the next 14 days, in exchange for:
1. An honest, public testimonial / quote.
2. Direct conversion path to the **$249 Scan + Fix PR** tier or paid peer referrals.

---

## 2. Target Profile & Wedge
- **Target Builders**: Solopreneurs and small teams building full-stack SaaS with AI tools (Cursor, Lovable, Bolt, v0) and Supabase/PostgreSQL.
- **Why they convert**: High anxiety 48 hours before launch. They want to be sure their anon key doesn't leak customer data or expose unprotected admin routes.

---

## 3. Outreach Protocol (Help-First, Zero-Spam)

**Direct Message / Email Template:**
> Hi [Founder Name],
>
> Saw you're gearing up to launch [Product Name] on Product Hunt next week — congrats!
>
> We built an automated static security scanner for modern AI-generated stacks (Supabase, Next.js, Express) that catches the 5 most common launch-day vulnerabilities (unprotected RLS tables, leaked service_role keys, unauthenticated admin routes, open CORS).
>
> We're offering 3 free pre-launch audit reports this week to founders in exchange for an honest testimonial if it's helpful.
>
> It's completely read-only and offline (we clone shallowly and run static analysis on public files — zero probing of your live app).
>
> Would you like us to run a free report on your repo before launch day?

---

## 4. Delivery & Fulfilment Workflow
1. Operator runs:
   ```bash
   node scripts/fulfil-scan.mjs prepare <github_repo> --for "<Founder Name> / <App>"
   ```
2. Operator inspects output and verifies top finding.
3. Hand off the Markdown report.
4. If findings exist: Offer to prepare the verified PR fixing all issues for $249 via `https://paypal.me/joyelgt/249`.
