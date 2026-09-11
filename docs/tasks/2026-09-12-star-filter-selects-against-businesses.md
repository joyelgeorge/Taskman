# The lead search filters out 97.6% of its pool, and selects against businesses

**Priority: CRITICAL.** Measured against the live GitHub API, 2026-09-12.

## The measurement

| Query | Repos |
|---|---|
| `supabase stripe stars:0..4 pushed:>2026-06-01` | **1,009** |
| `supabase stripe stars:5..400 pushed:>2026-06-01` | **25** |

`generateCandidates()` in `scripts/hunt-vibe-leads.mjs` uses `stars:5..400` and
`stars:3..300`. It is looking at **2.4%** of the addressable pool.

## Why the filter is backwards

Stars are an **open-source popularity** signal. Nobody stars a real company's
product repository — stars accumulate on libraries, templates, starter kits,
demos and tutorials.

Which is to say: the star floor selects *toward* hobby and OSS projects, and the
`genuine` business qualifier in `packages/core/targets/lead-qualifier.js` then
rejects those same repos for not being businesses. **The two filters fight each
other.** The search is narrowed to the slice least likely to contain what it is
looking for, and the qualifier throws away most of what survives.

`qualifyLead` compounds it: `+0.2` score for `stargazers_count >= 5` and `+0.1`
for `forks_count >= 2`. The same wrong proxy is used twice — once to find
candidates, once to score them.

This is the failure mode named in `.claude/skills/verifying-guard-tests`: the
indicator is not the thing. Stars proxy for popularity; the target is commerce.

## Done looks like

1. Drop the star floor from the queries. Consider `stars:<20` instead — as an
   *exclusion* of popular OSS, the opposite of the current rule.
2. Remove or invert the star/fork scoring in `qualifyLead`.
3. Replace them with signals that actually indicate commerce. Some already exist
   in `BUSINESS_CODE_SIGNALS`: a payments integration, a privacy policy or terms
   route, a custom domain in `homepage`, auth with real user tables, a pricing
   page. A repo with Stripe live keys and a custom domain is a business at zero
   stars.
4. Re-measure the qualified-lead yield before and after, and record both numbers
   here. If yield does not improve, this reasoning was wrong and that belongs in
   the disproof registry.
