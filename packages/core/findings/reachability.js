/**
 * Can untrusted input actually get here?
 *
 * The measured case: one repository produced four `command-injection` findings.
 * All four were real string interpolation into a shell call, and all four
 * interpolated `process.env` values inside a local script no HTTP request
 * touches. Reported as criticals, they were the loudest thing in the report and
 * the least true. That is F4 in the requirements spec and requirement R4.2.
 *
 * Two independent signals, deliberately not merged into a score:
 *
 *   1. **Location** — is this file on a request path, or is it tooling?
 *   2. **Taint** — does the interpolated value come from a request, or from the
 *      environment the developer controls?
 *
 * They are kept separate because **disagreement is the useful state.** A shell
 * call in `scripts/` that interpolates `req.body` is not safe just because of
 * where it lives, and averaging the two signals into a confidence number is
 * exactly how the 6-of-6 admin-route mistake would have shipped. When they
 * disagree the finding is `contested` and goes to a human, which costs one
 * minute and is the cheapest check available.
 *
 * `scripts/hunt-vibe-leads.mjs` carried a cruder version of the location half
 * inline. This is that idea made reusable, given the taint signal it was
 * missing, and made honest about the case it cannot call.
 */

/** Paths no inbound request reaches. */
const TOOLING = /(^|\/)(scripts?|bin|tools?|tests?|__tests__|__mocks__|examples?|fixtures?|dist|build|coverage|migrations?|seeds?)\//i;
const CONFIG_FILE = /(^|\/)(vite|webpack|rollup|esbuild|next|svelte|astro|tailwind|jest|vitest|playwright)\.config\./i;

/** Paths an inbound request plausibly reaches. */
const REQUEST_PATH = /(^|\/)(api|routes?|controllers?|handlers?|middleware|server|pages\/api|app\/api|functions|netlify\/functions|supabase\/functions)\//i;
/** Or a file that defines a route inline, wherever it lives. */
const DEFINES_ROUTE = /\b(?:app|router|server)\.(?:get|post|put|patch|delete|all|use)\s*\(|\bexport\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\b|\bexport\s+const\s+(?:GET|POST|PUT|PATCH|DELETE)\b/;

/** Values an attacker can set. */
const REQUEST_TAINT = /\b(?:req|request|ctx|event)\s*\.\s*(?:query|params|body|headers|url|cookies)|\bsearchParams\b|\bqueryStringParameters\b|\bformData\b|\bawait\s+params\b/;
/** Values the developer sets. */
const ENV_TAINT = /\bprocess\s*\.\s*env\b|\bimport\s*\.\s*meta\s*\.\s*env\b|\bDeno\s*\.\s*env\b/;

export const LOCATION = Object.freeze({ REQUEST: 'request-path', TOOLING: 'tooling', UNKNOWN: 'unknown' });
export const TAINT = Object.freeze({ REQUEST: 'request', ENVIRONMENT: 'environment', UNKNOWN: 'unknown' });

/** Where the finding lives. `text` is the file body when available. */
export function classifyLocation(file = '', text = '') {
  const path = String(file);
  // A route definition beats the folder: a handler in src/ is still a handler.
  if (text && DEFINES_ROUTE.test(text)) return LOCATION.REQUEST;
  if (REQUEST_PATH.test(path)) return LOCATION.REQUEST;
  if (TOOLING.test(path) || CONFIG_FILE.test(path) || /\.(config|test|spec)\.[cm]?[jt]sx?$/i.test(path)) {
    return LOCATION.TOOLING;
  }
  return LOCATION.UNKNOWN;
}

/** Where the interpolated value came from, read off the finding's evidence. */
export function classifyTaint(evidence = '') {
  const e = String(evidence);
  const req = REQUEST_TAINT.test(e);
  const env = ENV_TAINT.test(e);
  // Both present: an attacker-settable value is in there somewhere. Treat as
  // request-tainted. Under-calling this is the expensive direction.
  if (req) return TAINT.REQUEST;
  if (env) return TAINT.ENVIRONMENT;
  return TAINT.UNKNOWN;
}

/** Kinds that only matter if an untrusted request can reach them. */
export const NEEDS_REACHABILITY = Object.freeze(['command-injection', 'ssrf', 'path-prefix-guard']);

/**
 * Refute a finding, or decline to.
 *
 * Returns `{ verdict, location, taint, reason }` where verdict is:
 *   - `refuted`   — nothing untrusted reaches this; do not report it
 *   - `stands`    — reachable, or a kind reachability does not apply to
 *   - `contested` — the two signals disagree; a human decides (R4.4)
 *
 * Never returns a score. A deterministic signal that refutes a claim kills it
 * outright (R4.3); a threshold where a fact is available is a defect.
 */
export function assessReachability(finding = {}, { text = '' } = {}) {
  const kind = finding.kind;
  if (!NEEDS_REACHABILITY.includes(kind)) {
    return {
      verdict: 'stands', location: null, taint: null,
      reason: `${kind ?? 'finding'} does not depend on request reachability`
    };
  }

  const location = classifyLocation(finding.file, text);
  const taint = classifyTaint(finding.evidence);

  // Both signals agree it is unreachable. This is the flyrpro case.
  if (location === LOCATION.TOOLING && taint === TAINT.ENVIRONMENT) {
    return {
      verdict: 'refuted', location, taint,
      reason: 'interpolates a developer-controlled environment value inside tooling no request reaches'
    };
  }

  // Either signal says an attacker can reach it.
  if (taint === TAINT.REQUEST && location === LOCATION.REQUEST) {
    return { verdict: 'stands', location, taint, reason: 'request-tainted value on a request path' };
  }

  // Disagreement, or one signal silent. Surfaced, never averaged.
  if (taint === TAINT.REQUEST && location === LOCATION.TOOLING) {
    return {
      verdict: 'contested', location, taint,
      reason: 'request-tainted value in a file that looks like tooling — read it before believing either signal'
    };
  }
  if (taint === TAINT.ENVIRONMENT && location === LOCATION.REQUEST) {
    return {
      verdict: 'contested', location, taint,
      reason: 'environment value on a request path — check whether a request can influence it'
    };
  }

  return {
    verdict: 'contested', location, taint,
    reason: 'reachability could not be established from path or evidence alone'
  };
}

/**
 * Split a finding set by what survived refutation.
 *
 * `reportable` is what may be counted and shown. `contested` is what a human
 * looks at. `refuted` is kept rather than dropped, because a disclosure that
 * quietly lost a finding is as hard to audit as one that invented it.
 */
export function refuteUnreachable(findings = [], { textByFile = {} } = {}) {
  const reportable = [];
  const contested = [];
  const refuted = [];

  for (const f of findings) {
    if (!f?.kind) continue;
    const assessment = assessReachability(f, { text: textByFile[f.file] ?? '' });
    const tagged = { ...f, reachability: assessment };
    if (assessment.verdict === 'refuted') refuted.push(tagged);
    else if (assessment.verdict === 'contested') contested.push(tagged);
    else reportable.push(tagged);
  }

  return { reportable, contested, refuted };
}
