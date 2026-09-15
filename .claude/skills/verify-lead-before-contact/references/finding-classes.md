# Finding classes: what each one is worth in a message

Reference for `verify-lead-before-contact`. Load when deciding whether a class
belongs in a disclosure at all.

Every row below was established by hand-checking real repositories, not by
reading the detector.

## Compels action — lead with these

### `exposed-secret`
A live credential in a public repository. The strongest finding there is.

**Verify:** hash each occurrence rather than reading the value. Multiple hits are
usually **one key in N files** — say it that way, it is both truer and worse,
because removing it from one file fixes nothing.
**Fix is rotation, not editing.** The value stays in git history forever.

Measured: `Chalmers007/ordering-platform` reported 9; one distinct key across 9
scripts. `flyrpro` reported 1; genuinely 1.

### `command-injection`
**Check the taint source before believing this one.**

Measured: all 4 in `flyrpro` interpolated **environment variables** into a local
data-loading script. No request data, no server route, not exploitable without
already controlling the environment. Stood down.

Real only when the interpolated value can come from a request. If it is
`process.env` in a script, the honest finding is usually different and smaller —
in flyrpro's case, AWS keys passed on a shell command line where `ps` can see
them.

### `unauthenticated-admin-route`
**Assume this is wrong until a file is read.**

Measured: 6 of 6 false positives on `Chalmers007/ordering-platform`. Every route
called `requireSuperAdmin()`. The detector greps the route file for auth words;
any codebase that delegates to a named guard helper trips it, which is most of
them.

Open the file. Look for an imported `require*`/`assert*`/`guard*` called before
the handler's work.

## Real, but secondary — mention after, never as an emergency

### `missing-rls`
Emitted **once per table**, so one architectural gap becomes dozens of
"criticals". Report the number of *tables*, and check whether the project
enables RLS elsewhere — if it does, these are omissions that slipped through,
not ignorance, and saying so is both accurate and disarming.

Subtle case worth finding: a `create policy` with no `enable row level
security`. **The policy does nothing.** It reads as protected and is not.

Measured: `flyrpro` 70 findings across 12 files. `Chalmers007` 4 real tables
against 30 correctly enabled.

### `open-cors`, `ssrf`
`ssrf` requires tracing the taint by hand. Do not raise either without doing so.

## Not a disclosure

`date-shift`, `storage-divergence`, `silent-fallback`, `missing-table` — code
smells. Real observations, not security findings. Including them makes the whole
message read as automated noise.

## The arithmetic that matters

```
headline findings ÷ distinct compelling problems = how wrong you are about to be
```

Measured across 22 leads on 2026-09-15: the sweep called 19 leads critical.
**Seven carried a compelling finding. Four had an exposed secret.**
