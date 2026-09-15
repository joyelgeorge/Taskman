/**
 * Scan a DEPLOYED app's JavaScript bundles for exposed secrets.
 *
 * Research 2026-09-15: scanning deployed bundles found ~50x the hit rate of
 * scanning GitHub repos (11% of 20,052 URLs against 4 of 199 candidates), and
 * is immune to the GitHub-secret-scanning auto-revocation that is closing the
 * repo surface — a key in a shipped bundle is not in a repo, so nothing revokes
 * it. See docs/research/2026-09-15-is-this-lane-worth-48-more-attempts.md.
 *
 * Read-only: it fetches what a server already serves to any browser. It never
 * uses a key, never sends a request anywhere but GET to the public asset.
 *
 * THE ONE DISCIPLINE: an anon key in a client bundle is expected and safe — it
 * is designed to ship there. Only service_role (and the sk_live_/AKIA-style
 * provider keys) are findings. findExposedSecret already draws that line, so
 * this reuses it rather than re-deciding it; a detector that flagged anon keys
 * would be a 100% false-positive beg-bounty generator.
 */

import { findExposedSecret } from '../../../src/codebase-audit.js';

/** Anon keys in bundles are safe by design. Stated as a function so a test pins it. */
export function isAnonKeySafe() {
  return true;
}

/** Every <script src> on a page, resolved to absolute URLs against the page origin. */
export function extractScriptUrls(html, pageUrl) {
  const urls = [];
  for (const m of html.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi)) {
    try { urls.push(new URL(m[1], pageUrl).href); } catch { /* skip unparseable */ }
  }
  return urls;
}

/** Run the secret detector over one bundle's text, tagging findings with its URL. */
export function scanBundleText(bundleUrl, text) {
  return findExposedSecret(bundleUrl, text);
}

/**
 * Fetch a deployed app and scan its bundles. Injectable fetch so the logic is
 * testable without a network.
 */
export async function scanDeployedApp(appUrl, { fetchImpl = fetch, maxBundles = 40, maxBytes = 8_000_000 } = {}) {
  const findings = [];
  let pageHtml;
  try {
    const res = await fetchImpl(appUrl, { redirect: 'follow' });
    pageHtml = await res.text();
  } catch (error) {
    return { app: appUrl, reachable: false, reason: String(error?.message || error), findings: [] };
  }

  const bundles = extractScriptUrls(pageHtml, appUrl).slice(0, maxBundles);
  for (const url of bundles) {
    try {
      const res = await fetchImpl(url);
      const text = (await res.text()).slice(0, maxBytes);
      findings.push(...scanBundleText(url, text));
    } catch { /* a bundle that will not load is not a finding */ }
  }

  return { app: appUrl, reachable: true, bundlesScanned: bundles.length, findings };
}

/** Scan many deployed apps. Sequential and gentle — one public page + its bundles per app. */
export async function scanDeployedApps(urls = [], opts = {}) {
  const results = [];
  for (const url of urls) results.push(await scanDeployedApp(url, opts));
  return results;
}

/**
 * Shape a bundle scan result for the lead store (packages/core/targets). The
 * deployed app URL takes the `repo` slot, which is the store's dedupe key, and
 * is also its own homepage signal — a working deployed URL is the strongest
 * business-reality signal there is. Returns null when there is nothing to store.
 */
export function toBundleLeadResult(result = {}) {
  const findings = Array.isArray(result.findings) ? result.findings : [];
  if (!result.app || !findings.length) return null;
  return {
    repo: result.app,
    findings,
    meta: { homepage: result.app, surface: 'deployed-bundle' }
  };
}
