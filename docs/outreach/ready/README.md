# Ready to send

**Both were sent on 2026-09-15 and logged.** `vibe-app-security`: 2 attempts,
0 replies, 48 before the kill criterion. Left here as the template for the next
batch — see `handle-the-reply` when one answers.

Two emails, extracted from their disclosure drafts as plain text so they can be
pasted into a mail client without markdown artefacts.

**Claude does not send these.** The operator does.

| # | File | To | Why this one |
|---|---|---|---|
| 1 | `2-chalmers007.txt` | connectentinc@gmail.com | **Send first.** Strongest finding, live commercial product, pushed two days ago |
| 2 | `1-flyrpro.txt` | daniel.phillippe27@gmail.com | Real finding, drafted first, slightly weaker |

Copy one to the clipboard:

```bash
pbcopy < docs/outreach/ready/2-chalmers007.txt
```

## After sending each one

```bash
npm run outreach -- log --lane vibe-app-security --channel email --prospect Chalmers007/ordering-platform
npm run outreach -- log --lane vibe-app-security --channel email --prospect danielphillippe27-netizen/flyrpro
```

Both `--lane=x` and `--lane x` work (the space form used to fail with "lane is
required", which was fixed the first time it was used for real).
`DATABASE_URL` must be set or the log refuses rather than pretending. An
unlogged send is worse than no send: it spends the prospect and leaves the lane
looking untried, so the next session builds more supply instead of following up.

## Two judgement calls that are yours, not mine

- Both addresses come from **commit metadata**. Using them is standard practice
  for security disclosure, and they are still someone's personal address.
- flyrpro's deployed product is branded **WolfGrid**, not FLYR PRO. Worth a
  glance that you are writing to the right person.

## Then

One follow-up if there is no reply, then mark `NO_RESPONSE`. Never two.
If someone replies, the `handle-the-reply` skill covers what happens next.
