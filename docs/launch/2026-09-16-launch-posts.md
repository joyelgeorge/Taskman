# Launch posts — self-serve key-exposure scanner

**You post these, not the software.** All honest, all lead with the finding not
the pitch, all disclose it's yours and that the fix is paid. Tuned per community.

**Before posting:** redeploy the honest copy (`firebase deploy --only hosting`),
and buy your own report once to confirm the PayPal→unlock flow. Post nothing
until you've seen a real purchase unlock a real report.

---

## Show HN

> **Show HN: I scanned my own Lovable app and found my Supabase admin key in the JS bundle**
>
> I built an app with an AI coding tool, shipped it, and later opened the deployed
> JavaScript in my browser's dev tools. My Supabase `service_role` key — the one
> that bypasses row-level security and can read/write every table — was sitting
> right there in the bundle. Anyone who opened the page could have taken it.
>
> Turns out this is common: a scan of ~20k indie-launch URLs found ~11% leaking
> Supabase credentials this way. AI tools scaffold the key into client code and
> it ships.
>
> So I made a scanner: paste your deployed URL, it fetches the same JavaScript
> your browser already downloads and checks whether a real secret (service_role,
> or sk_live/AKIA-style keys) is in there. It ignores the anon/publishable key,
> which is *supposed* to be public — flagging that would just be noise.
>
> The scan is free and read-only; I don't store anything or touch your backend. If
> it finds something, there's a $5 report with the exact fix (rotate first — the
> key stays in your git history and old bundles forever, so deleting the line
> isn't enough — then move it server-side). But the free scan tells you if you
> have the problem, which is the part that matters.
>
> Link: https://taskman-operator.web.app/scan.html
>
> Would genuinely like feedback on the detection — happy to explain how it tells a
> real service_role key from the safe anon one.

---

## r/Supabase

> **PSA: check your deployed app's JS bundle for your service_role key — mine was in there**
>
> If you built with Lovable / Bolt / v0 / Cursor and deployed, do this right now:
> open your live site, F12 → Sources, and search the bundled JS for "service_role"
> or "eyJ". If your service_role key is there, anyone can read it and bypass RLS
> on every table.
>
> It's more common than you'd think — one scan of ~20k launched apps found ~11%
> leaking Supabase keys in the client. The AI tools sometimes drop the admin key
> into client code.
>
> I got bitten by this and built a quick scanner so I could check my other
> projects: paste the URL, it reads the public bundle and tells you if a real
> secret is exposed (it skips the anon key — that one's meant to be public).
> Free and read-only: https://taskman-operator.web.app/scan.html
>
> Full disclosure: there's a paid $5 fix report if you want the exact safe-rotation
> steps, but the free scan answers the only urgent question — are you exposed. And
> if you are: rotate the key in the dashboard (don't just delete the line, it's in
> your git history), then keep it server-side.

---

## r/vibecoding

> **I checked my vibe-coded app's deployed code and my database admin key was public. Made a scanner so you can check yours.**
>
> Shipped an app I built with AI, felt great, then found out later that my Supabase
> `service_role` key — basically the master key to my whole database — was sitting
> in the JavaScript anyone could view. The AI put it in the client code and I
> didn't know to look.
>
> Apparently ~11% of launched vibe-coded apps have this. So I made a dead-simple
> checker: paste your app's URL, it looks at the same code your browser loads, and
> tells you if a real secret key is exposed. Free, read-only, nothing stored.
>
> https://taskman-operator.web.app/scan.html
>
> (There's a $5 report with the exact fix if you find something and want the safe
> way to rotate it, but the check itself is free — just go run it on your app.)

---

## Lovable / Bolt / v0 Discords (casual, short)

> heads up for anyone who's shipped — AI tools sometimes put your Supabase
> service_role key straight in the client bundle, where it's public. ~11% of
> launched apps have this. quick free check if you want to make sure yours is
> clean: https://taskman-operator.web.app/scan.html (read-only, reads the same JS
> your browser does, doesn't store anything)

---

## Why these convert instead of getting flagged

- **The finding is the hook, not the product** — a true, scary, checkable fact.
- **Your own mistake, told plainly** — you're a peer who got bitten, not a vendor.
- **The paid part is disclosed up front** — hiding it is what gets posts removed.
- **The free scan is genuinely enough** — it answers "am I exposed," which is the
  real value; the fix is a convenience.
- **Read-only, nothing stored** — pre-empts the "is this a scam / are you
  harvesting URLs" reaction every one of these gets.
- **No urgency, no hype** — these communities downvote both on sight.

## After it's posted

- Reply to comments as yourself, technically and honestly — the "how does it tell
  service_role from anon" question will come up; answer it, that's the trust win.
- When a $5 sale lands, record it: `close-to-settlement`, rail paypal, keyed on
  the PayPal order id.
- Post to ONE community first, watch what breaks or confuses, fix it, then the
  next. Don't blast all four at once.
