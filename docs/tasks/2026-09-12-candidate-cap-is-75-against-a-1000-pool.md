# The sweep can only ever see 75 repos, however large the pool

**Priority: MEDIUM.** Found 2026-09-12.

`generateCandidates()` requests `per_page=25` for each of three queries and does
not paginate. The ceiling is 75 candidates per run regardless of how many exist
— and with one query returning zero, the practical ceiling is ~46 before dedupe.

With the filters loosened (see the star-filter task) the pool is ~1,000. Without
pagination the sweep would still look at 75 of them, and because it sorts by
stars it would look at the *same* 75 every week — which is what the new
`scanned_repos` memory now partly mitigates, but only by moving to the next 75.

At one clone per candidate this is also a real time budget, so the fix is not
simply "raise the number": it is to decide how many clones a weekly run should
spend, and spend them on the most promising candidates rather than the most
starred.

## Done looks like

Paginate to a configured candidate budget, order by a commerce signal rather
than stars, and record how many of the pool were reached. Then the ceiling is a
decision with a number attached rather than an unexamined default.
