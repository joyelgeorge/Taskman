# One of the three lead-search queries returns zero results

**Priority: HIGH, effort: minutes.** Measured 2026-09-12.

`scripts/hunt-vibe-leads.mjs`, `generateCandidates()`:

```
supabase stripe subscription language:JavaScript stars:3..300 pushed:>2026-06-01
```

`total_count: 0`. It has been contributing nothing to every run.

The other two return 21 and 157, so the real candidate pool is ~178 before
dedupe — against 1,036 for the same search without the `language` and `stars`
filters.

## Why it returns nothing

Four stacked constraints, most likely `language:JavaScript` combined with the
`subscription` keyword: GitHub classifies most of this ecosystem as TypeScript,
so a JS-only filter removes nearly everything, and `subscription` narrows what
little remains to nothing.

The `language:` filter is worth questioning generally: it also means a JS app is
unreachable by query 1 and 3 both.

## Done looks like

Delete or repair the query, and add a guard: if a query returns zero results,
log it loudly rather than silently contributing nothing. A search that quietly
returns nothing is indistinguishable from a search that found nothing, which is
the same class of bug as a test that cannot fail.
